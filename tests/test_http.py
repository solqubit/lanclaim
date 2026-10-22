import http.client
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from lanclaim.db import Store
from lanclaim.scanner import Scanner
from lanclaim.server import Server


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        store = Store(Path(cls.temp.name) / 'db.sqlite3')
        scanner = Scanner(store, probe=lambda address: 'responding', interval=0)
        cls.server = Server(('127.0.0.1', 0), store, scanner)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, path, method='GET', data=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        body = json.dumps(data) if data is not None else None
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def post(self, path, data):
        headers = {'X-CSRF-Token': self.server.csrf, 'Content-Type': 'application/json'}
        code, _, body = self.request(path, 'POST', data, headers)
        return code, json.loads(body)

    def test_serves_shell_and_modules(self):
        code, headers, body = self.request('/')
        self.assertEqual(code, 200)
        self.assertIn(b'<script type="module" src="/js/main.js">', body)
        self.assertTrue(headers['Content-Type'].startswith('text/html'))
        code, headers, _ = self.request('/js/model.js')
        self.assertEqual(code, 200)
        self.assertTrue(headers['Content-Type'].startswith('text/javascript'))
        self.assertEqual(self.request('/css/app.css')[0], 200)
        self.assertEqual(self.request('/favicon.svg')[0], 200)
        for path in ('/js/package.json', '/../db.py', '/js/%2e%2e/%2e%2e/db.py', '/js/../../server.py',
                     '/js/', '/data/lanclaim.sqlite3', '/app.js', '/unknown'):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_security_headers_and_csrf(self):
        _, headers, _ = self.request('/')
        self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(self.request('/api/ips/claim', 'POST', {'addresses': '10.0.0.1'},
                                      {'Content-Type': 'application/json'})[0], 403)
        self.assertEqual(self.request('/api/ips/claim', 'POST', {'addresses': '10.0.0.1'},
                                      {'X-CSRF-Token': self.server.csrf})[0], 415)
        for headers in ({'Host': 'evil.example'}, {'Origin': 'https://evil.example'}, {'Sec-Fetch-Site': 'cross-site'}):
            self.assertEqual(self.request('/api/state', headers=headers)[0], 403)

    def test_state_shape(self):
        code, _, body = self.request('/api/state')
        state = json.loads(body)
        self.assertEqual(code, 200)
        for key in ('networks', 'ips', 'devices', 'observations', 'os_choices', 'platform_choices', 'scan', 'csrf', 'version'):
            self.assertIn(key, state)
        self.assertEqual(state['version'], '2.0.0')

    def test_mutation_returns_state(self):
        code, state = self.post('/api/ips/claim', {'addresses': '192.168.50.10',
                                                   'device': {'name': 'glpi', 'type': 'vm'}})
        self.assertEqual(code, 200)
        ip = next(i for i in state['ips'] if i['address'] == '192.168.50.10')
        device = next(d for d in state['devices'] if d['name'] == 'glpi')
        self.assertEqual(ip['device_id'], device['id'])
        self.assertIn('csrf', state)
        code, state = self.post('/api/devices/update', {'id': device['id'], 'name': 'glpi', 'type': 'vm', 'os': 'Debian 12',
                                                        'note': '', 'add': ['192.168.50.11'], 'remove': []})
        self.assertEqual(code, 200)
        self.assertEqual(len([i for i in state['ips'] if i['device_id'] == device['id']]), 2)
        code, state = self.post('/api/ips/note', {'address': '192.168.50.11', 'note': 'hola'})
        self.assertEqual(code, 200)
        code, state = self.post('/api/ips/unassign', {'addresses': ['192.168.50.11']})
        code, state = self.post('/api/ips/release', {'addresses': ['192.168.50.11']})
        self.assertNotIn('192.168.50.11', [i['address'] for i in state['ips']])
        code, state = self.post('/api/devices/delete', {'id': device['id']})
        self.assertEqual((code, state['devices']), (200, []))

    def test_forget_os_route(self):
        self.post('/api/devices/create', {'name': 'os-test', 'type': 'vm', 'os': 'FreeBSD 14'})
        code, state = self.post('/api/os/forget', {'name': 'FreeBSD 14'})
        self.assertEqual(code, 200)
        self.assertNotIn('FreeBSD 14', state['os_choices'])
        self.post('/api/devices/delete', {'id': next(d['id'] for d in state['devices'] if d['name'] == 'os-test')})
        code, state = self.post('/api/platforms/forget', {'name': 'Nutanix AHV'})
        self.assertEqual(code, 200)
        self.assertNotIn('Nutanix AHV', state['platform_choices'])

    def test_network_routes(self):
        code, state = self.post('/api/networks/add', {'cidr': '172.20.0.0/28', 'name': 'Lab'})
        self.assertEqual(code, 200)
        net = next(n for n in state['networks'] if n['cidr'] == '172.20.0.0/28')
        code, state = self.post('/api/networks/rename', {'id': net['id'], 'name': 'Lab 2'})
        self.assertEqual(next(n for n in state['networks'] if n['id'] == net['id'])['name'], 'Lab 2')
        code, state = self.post('/api/networks/remove', {'id': net['id']})
        self.assertNotIn(net['id'], [n['id'] for n in state['networks']])
        code, _, body = self.request('/api/suggestions')
        self.assertEqual(code, 200)
        self.assertIsInstance(json.loads(body)['networks'], list)

    def test_adding_network_scans_it_right_away(self):
        self.post('/api/networks/add', {'cidr': '172.22.0.0/30'})
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            state = json.loads(self.request('/api/state')[2])
            if '172.22.0.1' in state['observations'] and not state['scan']['running']:
                break
            time.sleep(0.02)
        self.assertTrue(state['observations']['172.22.0.1']['up'])

    def test_scan_now(self):
        self.post('/api/networks/add', {'cidr': '172.21.0.0/30'})
        code, state = self.post('/api/scan/now', {})
        self.assertEqual(code, 200)
        deadline = time.monotonic() + 5
        while self.server.scanner.status()['running'] and time.monotonic() < deadline:
            time.sleep(0.02)
        state = json.loads(self.request('/api/state')[2])
        self.assertTrue(state['observations']['172.21.0.1']['up'])

    def test_invalid_is_400(self):
        code, body = self.post('/api/networks/add', {'cidr': '10.0.0.0/8'})
        self.assertEqual(code, 400)
        self.assertIn('/22', body['error'])
        self.assertEqual(self.post('/api/ips/claim', {'addresses': 'nope'})[0], 400)
        self.assertEqual(self.post('/api/devices/delete', {'id': 'x'})[0], 400)
        headers = {'X-CSRF-Token': self.server.csrf, 'Content-Type': 'application/json'}
        self.assertEqual(self.request('/api/ips/claim', 'POST', [], headers)[0], 400)

    def test_unknown_route_404(self):
        self.assertEqual(self.post('/api/ips/explode', {})[0], 404)
        self.assertEqual(self.post('/api/commands/claim', {})[0], 404)
        self.assertEqual(self.request('/api/nothing')[0], 404)


if __name__ == '__main__':
    unittest.main()
