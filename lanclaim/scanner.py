"""Manual, bounded ICMP checks. Observations never change IP ownership."""
import ipaddress
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

from .db import Invalid, addresses, now


PING_PERMISSION_ERROR = 'El servicio no tiene permisos para usar ping. Actualiza LanClaim para reparar los permisos del servicio.'
PING_TIMEOUT_ERROR = 'Ping no terminó a tiempo. Revisa la carga y la red del servidor.'
PING_NETWORK_ERROR = 'El servidor no tiene una ruta hacia esa red. Revisa su interfaz, gateway o red virtual.'


def scan_addresses(raw):
    targets = addresses(raw)
    if any(ipaddress.ip_address(a).version != 4 for a in targets):
        raise Invalid('El escaneo admite solamente IPv4.')
    if len(targets) > 1024:
        raise Invalid('Escanea hasta 1024 direcciones por operación.')
    excluded = set()
    for token in re.split(r'[,;\s]+', re.sub(r'\s*-\s*', '-', raw.strip())):
        if '/' in token:
            network = ipaddress.ip_network(token, strict=False)
            if network.prefixlen < 31:
                excluded.update((str(network.network_address), str(network.broadcast_address)))
    targets = [a for a in targets if a not in excluded]
    if not targets or any(ipaddress.ip_address(a).is_multicast or
                          ipaddress.ip_address(a).is_unspecified or a == '255.255.255.255'
                          for a in targets):
        raise Invalid('Selecciona direcciones IPv4 de equipos, sin multicast ni broadcast.')
    return targets


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
    def __init__(self, store, probe=ping):
        self.store, self.probe = store, probe
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.thread = None
        self.job = {'status': 'idle', 'total': 0, 'completed': 0, 'responding': 0, 'error': ''}

    def snapshot(self):
        with self.lock:
            return {'scan': dict(self.job), 'observations': self.store.observations()}

    def start(self, raw):
        targets = scan_addresses(raw)
        with self.lock:
            if self.job['status'] in ('running', 'cancelling'):
                raise Invalid('Ya hay un escaneo en curso.')
            self.cancelled.clear()
            self.job = {'status': 'running', 'range': raw, 'total': len(targets),
                        'completed': 0, 'responding': 0, 'started_at': now(), 'error': ''}
            self.thread = threading.Thread(target=self._run, args=(targets,), daemon=True)
            self.thread.start()
            return dict(self.job)

    def cancel(self):
        with self.lock:
            if self.job['status'] == 'running':
                self.job['status'] = 'cancelling'
                self.cancelled.set()
            return dict(self.job)

    def close(self):
        self.cancel()
        if self.thread:
            self.thread.join(timeout=6)

    def _run(self, targets):
        pending = iter(targets)

        def worker():
            while True:
                with self.lock:
                    if self.cancelled.is_set():
                        return
                    address = next(pending, None)
                if address is None:
                    return
                status = self.probe(address)
                with self.lock:
                    self.store.observe(address, status)
                    self.job['completed'] += 1
                    self.job['responding'] += status == 'responding'

        def guarded_worker():
            try:
                worker()
            except Exception as exc:
                with self.lock:
                    self.job['error'] = str(exc) if isinstance(exc, Invalid) else 'No se pudo guardar el resultado del escaneo.'
                    self.cancelled.set()

        with ThreadPoolExecutor(max_workers=16) as pool:
            futures = [pool.submit(guarded_worker) for _ in range(min(16, len(targets)))]
            for future in futures:
                future.result()
        with self.lock:
            self.job['status'] = 'failed' if self.job['error'] else 'cancelled' if self.cancelled.is_set() else 'completed'
            self.job['finished_at'] = now()
