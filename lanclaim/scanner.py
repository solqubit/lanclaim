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

from .db import Invalid, now

log = logging.getLogger(__name__)

PING_PERMISSION_ERROR = 'El servicio no tiene permisos para usar ping. Actualiza LanClaim para reparar los permisos del servicio.'
PING_TIMEOUT_ERROR = 'Ping no terminó a tiempo. Revisa la carga y la red del servidor.'
PING_NETWORK_ERROR = 'El servidor no tiene una ruta hacia esa red. Revisa su interfaz, gateway o red virtual.'
GENERIC_ERROR = 'No se pudo completar el escaneo. Revisa el registro del servicio.'
BATCH = 16


def ping(address):
    # Defense in depth: only a canonical numeric address ever reaches a process.
    address = str(ipaddress.IPv4Address(address))
    executable = shutil.which('ping')
    if not executable:
        raise Invalid('No se encontró ping. Instala iputils-ping o iputils en el servidor.')
    windows = sys.platform == 'win32'
    args = [executable, '-4', '-n', '1', '-w', '1000', address] if windows else [
        executable, '-n', '-c', '1', '-W', '1', address]
    try:
        result = subprocess.run(args, capture_output=True, timeout=4,
                                env=None if windows else {**os.environ, 'LC_ALL': 'C'},
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) if windows else 0)
    except PermissionError as exc:
        raise Invalid(PING_PERMISSION_ERROR) from exc
    except FileNotFoundError as exc:
        raise Invalid('No se encontró ping. Instala iputils-ping o iputils en el servidor.') from exc
    except subprocess.TimeoutExpired as exc:
        raise Invalid(PING_TIMEOUT_ERROR) from exc
    except OSError as exc:
        raise Invalid('No se pudo ejecutar ping. Revisa los permisos y la red del servidor.') from exc
    if not windows and result.returncode not in (0, 1):
        # Keep diagnostics in the service log; only actionable, translated errors
        # are exposed in the UI. A local failure is never a no-response result.
        detail = result.stderr.decode('utf-8', errors='replace')[:1000]
        logging.getLogger(__name__).warning('ping exited with status %s: %s', result.returncode, detail.strip())
        detail = detail.lower()
        if any(message in detail for message in ('operation not permitted', 'permission denied', 'cap_net_raw')):
            raise Invalid(PING_PERMISSION_ERROR)
        if any(message in detail for message in ('network is unreachable', 'no route to host')):
            raise Invalid(PING_NETWORK_ERROR)
        raise Invalid('No se pudo ejecutar ping. Revisa los permisos y la red del servidor.')
    # Windows can return success for an ICMP destination-unreachable message.
    responds = result.returncode == 0 and (not windows or re.search(rb'TTL[= ]+\d+', result.stdout, re.I) is not None)
    return 'responding' if responds else 'no_response'


class Scanner:
    def __init__(self, store, probe=ping, interval=300, workers=32):
        self.store, self.probe = store, probe
        self.interval, self.workers = interval, workers
        self.lock = threading.Lock()
        self.stopping = threading.Event()
        self.loop = None
        self.worker = None
        self.job = {'running': False, 'total': 0, 'done': 0, 'finished_at': None, 'error': ''}

    def status(self):
        with self.lock:
            return dict(self.job)

    def start(self):
        if self.interval > 0 and self.loop is None:
            self.loop = threading.Thread(target=self._loop, name='lanclaim-scan-loop', daemon=True)
            self.loop.start()

    def scan_now(self):
        with self.lock:
            if not self.job['running'] and not self.stopping.is_set():
                self._begin()
                self.worker = threading.Thread(target=self._cycle, name='lanclaim-scan', daemon=True)
                self.worker.start()
            return dict(self.job)

    def close(self):
        self.stopping.set()
        for thread in (self.loop, self.worker):
            if thread is not None:
                thread.join(timeout=6)

    def _begin(self):
        self.job.update(running=True, total=0, done=0)

    def _loop(self):
        while not self.stopping.is_set():
            with self.lock:
                idle = not self.job['running']
                if idle:
                    self._begin()
            if idle:
                self._cycle()
            self.stopping.wait(self.interval)

    def _cycle(self):
        error = ''
        try:
            targets = self.store.watched_addresses()
            with self.lock:
                self.job['total'] = len(targets)
            failed = threading.Event()
            pending, pending_lock = iter(targets), threading.Lock()

            def work():
                batch = {}
                while not failed.is_set() and not self.stopping.is_set():
                    with pending_lock:
                        address = next(pending, None)
                    if address is None:
                        break
                    batch[address] = self.probe(address) == 'responding'
                    with self.lock:
                        self.job['done'] += 1
                    if len(batch) >= BATCH:
                        self._save(batch)
                        batch = {}
                if batch:
                    self._save(batch)

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
        with self.lock:
            if error and error != self.job['error']:
                log.warning('%s', error)
            self.job.update(running=False, finished_at=now(), error=error)

    def _save(self, batch):
        self.store.record_observations(batch, now())
