"""Servidor HTTP para un espacio personal en una red de confianza."""
import argparse
import hmac
import ipaddress
import json
import os
import secrets
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from . import __version__
from .backup import backup_database
from .db import Conflict, Invalid, Store
from .networks import local_networks
from .scanner import Scanner

STATIC = (Path(__file__).parent / 'static').resolve()
MIME = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml'}


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, store, scanner=None):
        self.store = store
        self.scanner = scanner or Scanner(store)
        self.csrf = secrets.token_urlsafe(32)
        self.allowed_hosts = {'localhost', socket.gethostname().lower(), socket.getfqdn().lower()}
        self.allowed_hosts.update(h.strip().lower() for h in os.getenv('LANCLAIM_ALLOWED_HOSTS', '').split(',') if h.strip())
        super().__init__(address, Handler)
        store, scanner = self.store, self.scanner
        self.actions = {
            'networks/add': lambda d: (store.add_network(d.get('cidr'), d.get('name', '')), scanner.scan_now()),
            'networks/rename': lambda d: store.rename_network(d.get('id'), d.get('name', ''),
                expected_created_at=d.get('created_at'), expected_revision=d.get('revision')),
            'networks/update': lambda d: (store.update_network(d.get('id'), d.get('cidr'), d.get('name', ''),
                expected_created_at=d.get('created_at'), expected_revision=d.get('revision')), scanner.scan_now()),
            'networks/remove': lambda d: store.remove_network(d.get('id'),
                expected_created_at=d.get('created_at'), expected_revision=d.get('revision')),
            'ips/claim': lambda d: store.claim(d.get('addresses'), d.get('device')),
            'ips/release': lambda d: store.release(d.get('addresses')),
            'ips/unassign': lambda d: store.unassign(d.get('addresses')),
            'ips/note': lambda d: store.set_note(d.get('address'), d.get('note', ''),
                expected_note=d.get('expected_note'), expected_claimed_at=d.get('claimed_at')),
            'devices/create': lambda d: store.create_device(d, d.get('addresses')),
            'devices/update': lambda d: store.update_device(d.get('id'), d, d.get('add'), d.get('remove'),
                expected_created_at=d.get('created_at'), expected_revision=d.get('revision')),
            'devices/delete': lambda d: store.delete_device(d.get('id'), expected_created_at=d.get('created_at'),
                expected_revision=d.get('revision')),
            'os/forget': lambda d: store.forget_os(d.get('name')),
            'platforms/forget': lambda d: store.forget_platform(d.get('name')),
            'platforms/rename': lambda d: store.rename_platform(d.get('name'), d.get('new')),
            'os/rename': lambda d: store.rename_os(d.get('name'), d.get('new')),
            'scan/now': lambda d: scanner.scan_now(),
            'scan/settings': lambda d: scanner.configure(d.get('interval')),
        }

    def state(self):
        return {**self.store.state(), 'scan': self.scanner.status(), 'csrf': self.csrf, 'version': __version__}

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(15)
        return connection, address

    def server_close(self):
        self.scanner.close()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    server_version = 'LanClaim/' + __version__

    def send(self, status, body, content_type='application/json; charset=utf-8'):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(body)

    def trusted_request(self):
        host = self.headers.get('Host', '')
        try:
            parsed = urlsplit('http://' + host)
            hostname = (parsed.hostname or '').lower()
            if not hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
                return False
            parsed.port  # Validate port syntax.
            if hostname not in self.server.allowed_hosts:
                ipaddress.ip_address(hostname)
            origin = self.headers.get('Origin')
            if origin and origin not in ('http://' + host, 'https://' + host):
                return False
            return self.headers.get('Sec-Fetch-Site') not in ('cross-site', 'same-site')
        except ValueError:
            return False

    def static_file(self, path):
        if path == '/':
            path = '/index.html'
        if not (path == '/index.html' or path == '/favicon.svg' or path.startswith(('/css/', '/js/'))):
            return None
        try:
            candidate = (STATIC / path.lstrip('/')).resolve()
            candidate.relative_to(STATIC)
        except (ValueError, OSError):
            return None
        return candidate if candidate.suffix in MIME and candidate.is_file() else None

    def do_GET(self):
        if not self.trusted_request():
            return self.send(403, {'error': 'Origen o Host no permitido.'})
        route = urlsplit(self.path)
        try:
            if route.path == '/api/health':
                return self.send(200, {'ok': True, 'version': __version__})
            if route.path == '/api/state':
                return self.send(200, self.server.state())
            if route.path == '/api/suggestions':
                return self.send(200, {'networks': local_networks()})
            static = self.static_file(route.path)
            if static:
                return self.send(200, static.read_bytes(), MIME[static.suffix])
            return self.send(404, {'error': 'No encontrado.'})
        except (Invalid, ValueError) as exc:
            return self.send(400, {'error': str(exc)})
        except Exception as exc:
            self.log_error('Error al consultar datos: %s', type(exc).__name__)
            return self.send(500, {'error': 'No se pudieron consultar los datos del servidor.'})

    def do_POST(self):
        if not self.trusted_request() or not hmac.compare_digest(self.headers.get('X-CSRF-Token', '').encode(), self.server.csrf.encode()):
            return self.send(403, {'error': 'Sesión de página caducada u origen no permitido. Recarga la página.'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send(415, {'error': 'Se requiere application/json.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > 262144:
                return self.send(413, {'error': 'Petición vacía o demasiado grande.'})
            self.connection.settimeout(15)
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise Invalid('Se esperaba un objeto JSON.')
            path = urlsplit(self.path).path
            action = self.server.actions.get(path.removeprefix('/api/')) if path.startswith('/api/') else None
            if action is None:
                return self.send(404, {'error': 'No encontrado.'})
            action(data)
            return self.send(200, self.server.state())
        except Conflict as exc:
            return self.send(409, {'error': str(exc), 'code': 'conflict'})
        except (Invalid, ValueError, TypeError) as exc:
            return self.send(400, {'error': str(exc)})
        except Exception as exc:
            self.log_error('Operación fallida: %s', type(exc).__name__)
            return self.send(500, {'error': 'La operación no pudo guardarse. No se aplicaron cambios parciales.'})


def main():
    parser = argparse.ArgumentParser(description='LanClaim — Mi espacio de IPs')
    parser.add_argument('--host', default=os.getenv('LANCLAIM_HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.getenv('LANCLAIM_PORT', '8080')))
    parser.add_argument('--data-dir', default=os.getenv('LANCLAIM_DATA_DIR', str(Path.cwd() / 'data')))
    parser.add_argument('--scan-interval', type=int, default=int(os.getenv('LANCLAIM_SCAN_INTERVAL', '300')),
                        help='Segundos entre pings automáticos (0 los desactiva)')
    parser.add_argument('--backup', help='Crear una copia consistente y salir')
    args = parser.parse_args()
    if args.backup:
        backup_database(Path(args.data_dir) / 'lanclaim.sqlite3', args.backup)
        return
    store = Store(Path(args.data_dir) / 'lanclaim.sqlite3')
    server = Server((args.host, args.port), store, Scanner(store, interval=max(0, args.scan_interval)))
    server.scanner.start()
    print(f'LanClaim {__version__} — http://{args.host}:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
