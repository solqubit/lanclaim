"""Ping periódico de las direcciones vigiladas. Las observaciones nunca cambian el inventario."""
import ipaddress
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

from datetime import datetime, timezone

from .db import Invalid, now

log = logging.getLogger(__name__)

PING_PERMISSION_ERROR = 'El servicio no tiene permisos para usar ping. Actualiza LanClaim para reparar los permisos del servicio.'
PING_TIMEOUT_ERROR = 'Ping no terminó a tiempo. Revisa la carga y la red del servidor.'
PING_NETWORK_ERROR = 'El servidor no tiene una ruta hacia esa red. Revisa su interfaz, gateway o red virtual.'
GENERIC_ERROR = 'No se pudo completar el escaneo. Revisa el registro del servicio.'
MISSING_PING = 'No se encontró ping. Instala iputils-ping o iputils en el servidor.'
BATCH = 16


class PingUnavailable(Invalid):
    """Ping no puede funcionar en este servidor (permisos, binario): no tiene sentido seguir el ciclo."""


def ping(address):
    # Defense in depth: only a canonical numeric address ever reaches a process.
    address = str(ipaddress.IPv4Address(address))
    executable = shutil.which('ping')
    if not executable:
        raise PingUnavailable(MISSING_PING)
    windows = sys.platform == 'win32'
    args = [executable, '-4', '-n', '1', '-w', '1000', address] if windows else [
        executable, '-n', '-c', '1', '-W', '1', address]
    try:
        result = subprocess.run(args, capture_output=True, timeout=4,
                                env=None if windows else {**os.environ, 'LC_ALL': 'C'},
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) if windows else 0)
    except PermissionError as exc:
        raise PingUnavailable(PING_PERMISSION_ERROR) from exc
    except FileNotFoundError as exc:
        raise PingUnavailable(MISSING_PING) from exc
    except subprocess.TimeoutExpired as exc:
        raise Invalid(PING_TIMEOUT_ERROR) from exc
    except OSError as exc:
        raise Invalid('No se pudo ejecutar ping. Revisa los permisos y la red del servidor.') from exc
    if not windows and result.returncode not in (0, 1):
        # Keep diagnostics in the service log; only actionable, translated errors
        # are exposed in the UI. A local failure is never a no-response result.
        detail = result.stderr.decode('utf-8', errors='replace')[:1000]
        # Debug only: one failing wave would otherwise write a warning per address and per cycle.
        log.debug('ping %s exited with status %s: %s', address, result.returncode, detail.strip())
        detail = detail.lower()
        if any(message in detail for message in ('operation not permitted', 'permission denied', 'cap_net_raw')):
            raise PingUnavailable(PING_PERMISSION_ERROR)
        if any(message in detail for message in ('network is unreachable', 'no route to host')):
            raise Invalid(PING_NETWORK_ERROR)
        raise Invalid('No se pudo ejecutar ping. Revisa los permisos y la red del servidor.')
    # Windows can return success for an ICMP destination-unreachable message.
    responds = result.returncode == 0 and (not windows or re.search(rb'TTL[= ]+\d+', result.stdout, re.I) is not None)
    return 'responding' if responds else 'no_response'


MIN_INTERVAL, MAX_INTERVAL = 60, 86400  # entre 1 minuto y 1 día; 0 = desactivado


class Scanner:
    def __init__(self, store, probe=ping, interval=300, workers=32):
        self.store, self.probe = store, probe
        # El ciclo elegido en la interfaz se guarda y manda sobre el valor de arranque (variable de entorno).
        saved = store.get_setting('scan_interval')
        self.interval = int(saved) if saved is not None and saved.isdigit() else interval
        self.workers = workers
        self.lock = threading.Lock()
        self.stopping = threading.Event()
        self.wake = threading.Event()  # despierta el bucle cuando cambia el ciclo
        self.loop = None
        self.worker = None
        self.job = {'running': False, 'total': 0, 'done': 0, 'checked': 0, 'failed': 0,
                    'responding': 0, 'no_response': 0, 'finished_at': None, 'error': ''}
        self.again = False  # alguien pidió escanear mientras otro ciclo estaba en curso

    def status(self):
        with self.lock:
            return {**self.job, 'interval': self.interval}

    def start(self):
        # El bucle siempre existe; con el ciclo a 0 simplemente espera a que lo activen.
        if self.loop is None:
            self.loop = threading.Thread(target=self._loop, name='lanclaim-scan-loop', daemon=True)
            self.loop.start()

    def configure(self, interval):
        """Cambia el ciclo del ping automático (segundos; 0 lo desactiva), lo guarda y lo aplica al momento."""
        if isinstance(interval, bool) or not isinstance(interval, int) or not (
                interval == 0 or MIN_INTERVAL <= interval <= MAX_INTERVAL):
            raise Invalid('El ciclo del ping debe estar entre 1 minuto y 1 día, o desactivado.')
        self.store.set_setting('scan_interval', interval)
        with self.lock:
            self.interval = interval
        self.wake.set()
        return self.status()

    def scan_now(self):
        with self.lock:
            if self.job['running']:
                self.again = True
            elif not self.stopping.is_set():
                self._begin()
                self.worker = threading.Thread(target=self._cycle, name='lanclaim-scan', daemon=True)
                self.worker.start()
            return dict(self.job)

    def close(self):
        self.stopping.set()
        self.wake.set()
        for thread in (self.loop, self.worker):
            if thread is not None:
                thread.join(timeout=6)

    def _begin(self):
        self.job.update(running=True, total=0, done=0, checked=0, failed=0, responding=0, no_response=0, error='')

    def _seconds_since_last(self):
        finished = self.job['finished_at']
        if not finished:
            return None
        return (datetime.now(timezone.utc) - datetime.fromisoformat(finished)).total_seconds()

    def _loop(self):
        while not self.stopping.is_set():
            with self.lock:
                interval = self.interval
                elapsed = self._seconds_since_last()
                due = interval > 0 and not self.job['running'] and (elapsed is None or elapsed >= interval)
                if due:
                    self._begin()
            if due:
                self._cycle()
                elapsed = 0
            # Espera hasta el próximo ciclo (o indefinidamente si está desactivado); configure() lo despierta antes.
            timeout = None if interval <= 0 else max(1.0, interval - (elapsed or 0))
            self.wake.wait(timeout)
            self.wake.clear()

    def _cycle(self):
        # Una petición recibida durante el ciclo (p. ej. una red recién añadida) provoca otra pasada enseguida.
        while True:
            self._run_once()
            with self.lock:
                if self.again and not self.stopping.is_set():
                    self.again = False
                    self._begin()
                    continue
                self.job['running'] = False
                return

    def _run_once(self):
        error = ''
        skipped = []
        try:
            targets = self.store.watched_addresses()
            with self.lock:
                self.job['total'] = len(targets)
            failed = threading.Event()
            pending, pending_lock = iter(targets), threading.Lock()

            def work():
                batch = {}
                errors = {}
                while not failed.is_set() and not self.stopping.is_set():
                    with pending_lock:
                        address = next(pending, None)
                    if address is None:
                        break
                    try:
                        batch[address] = self.probe(address) == 'responding'
                    except Invalid as exc:
                        errors[address] = str(exc)
                        with self.lock:
                            skipped.append((address, str(exc)))
                        if isinstance(exc, PingUnavailable):
                            failed.set()
                    with self.lock:
                        self.job['done'] += 1
                        if address in errors:
                            self.job['failed'] += 1
                        else:
                            self.job['checked'] += 1
                            self.job['responding' if batch[address] else 'no_response'] += 1
                    if len(batch) + len(errors) >= BATCH:
                        self._save(batch)
                        self.store.record_probe_errors(errors, now())
                        batch = {}
                        errors = {}
                if batch:
                    self._save(batch)
                if errors:
                    self.store.record_probe_errors(errors, now())

            def guarded():
                try:
                    work()
                except Exception:
                    failed.set()
                    raise

            with ThreadPoolExecutor(max_workers=max(1, min(self.workers, len(targets)))) as pool:
                futures = [pool.submit(guarded) for _ in range(min(self.workers, len(targets)))]
                for future in futures:
                    exc = future.exception()
                    if exc is not None and not error:
                        error = str(exc) if isinstance(exc, Invalid) else GENERIC_ERROR
                        if not isinstance(exc, Invalid):
                            log.error('Escaneo fallido: %s', type(exc).__name__, exc_info=exc)
        except Exception as exc:
            error = GENERIC_ERROR
            log.error('Escaneo fallido: %s', type(exc).__name__, exc_info=exc)
        if skipped:
            error = error or skipped[0][1]
            log.warning('%d direcciones sin resultado de ping (p. ej. %s: %s)', len(skipped), *skipped[0])
        with self.lock:
            if error and error != self.job['error']:
                log.warning('%s', error)
            self.job.update(finished_at=now(), error=error)

    def _save(self, batch):
        self.store.record_observations(batch, now())
