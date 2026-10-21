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
from urllib.parse import parse_qs, urlsplit

from . import __version__
from .db import Invalid, Store
from .networks import local_networks

STATIC = Path(__file__).parent / 'static'


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, store):
        self.store = store
        self.csrf = secrets.token_urlsafe(32)
        self.allowed_hosts = {'localhost', socket.gethostname().lower(), socket.getfqdn().lower()}
        self.allowed_hosts.update(h.strip().lower() for h in os.getenv('LANCLAIM_ALLOWED_HOSTS', '').split(',') if h.strip())
        super().__init__(address, Handler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(15)
        return connection, address


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

    def do_GET(self):
        if not self.trusted_request():
            return self.send(403, {'error': 'Origen o Host no permitido.'})
        route = urlsplit(self.path)
        try:
            if route.path == '/api/health':
                return self.send(200, {'ok': True, 'version': __version__})
            if route.path == '/api/state':
                return self.send(200, {**self.server.store.snapshot(), 'csrf': self.server.csrf, 'version': __version__})
            if route.path == '/api/networks':
                return self.send(200, {'networks': local_networks()})
            if route.path == '/api/history':
                query = parse_qs(route.query)
                args = {key: int(query[key][0]) for key in ('ip_id', 'machine_id', 'before') if key in query}
                return self.send(200, {'events': self.server.store.history(**args)})
            files = {'/': ('index.html', 'text/html; charset=utf-8'),
                     '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                     '/i18n.js': ('i18n.js', 'text/javascript; charset=utf-8'),
                     '/style.css': ('style.css', 'text/css; charset=utf-8'),
                     '/favicon.svg': ('favicon.svg', 'image/svg+xml')}
            if route.path in files:
                name, mime = files[route.path]
                return self.send(200, (STATIC / name).read_bytes(), mime)
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
            path = urlsplit(self.path).path
            if not path.startswith('/api/commands/'):
                return self.send(404, {'error': 'No encontrado.'})
            action = path.removeprefix('/api/commands/')
            return self.send(200, self.server.store.command(action, data))
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
    parser.add_argument('--backup', help='Crear una copia consistente y salir')
    args = parser.parse_args()
    store = Store(Path(args.data_dir) / 'lanclaim.sqlite3')
    if args.backup:
        store.backup(args.backup)
        return
    server = Server((args.host, args.port), store)
    print(f'LanClaim {__version__} — http://{args.host}:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
