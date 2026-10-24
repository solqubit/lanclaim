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
        code, state = self.post('/api/devices/update', {'id': device['id'], 'created_at': device['created_at'], 'revision': device['revision'], 'name': 'glpi', 'type': 'vm', 'os': 'Debian 12',
                                                        'note': '', 'add': ['192.168.50.11'], 'remove': []})
        self.assertEqual(code, 200)
        self.assertEqual(len([i for i in state['ips'] if i['device_id'] == device['id']]), 2)
        ip = next(i for i in state['ips'] if i['address'] == '192.168.50.11')
        code, state = self.post('/api/ips/note', {'address': ip['address'], 'note': 'hola', 'expected_note': ip['note'], 'claimed_at': ip['claimed_at']})
        self.assertEqual(code, 200)
        code, state = self.post('/api/ips/unassign', {'addresses': ['192.168.50.11']})
        code, state = self.post('/api/ips/release', {'addresses': ['192.168.50.11']})
        self.assertNotIn('192.168.50.11', [i['address'] for i in state['ips']])
        device = next(d for d in state['devices'] if d['id'] == device['id'])
        code, state = self.post('/api/devices/delete', {'id': device['id'], 'created_at': device['created_at'], 'revision': device['revision']})
        self.assertEqual((code, state['devices']), (200, []))

    def test_forget_os_route(self):
        self.post('/api/devices/create', {'name': 'os-test', 'type': 'vm', 'os': 'FreeBSD 14'})
        code, state = self.post('/api/os/forget', {'name': 'FreeBSD 14'})
        self.assertEqual(code, 200)
        self.assertNotIn('FreeBSD 14', state['os_choices'])
        device = next(d for d in state['devices'] if d['name'] == 'os-test')
        self.post('/api/devices/delete', {'id': device['id'], 'created_at': device['created_at'], 'revision': device['revision']})
        code, state = self.post('/api/platforms/rename', {'name': 'KVM', 'new': 'KVM / libvirt'})
        self.assertIn('KVM / libvirt', state['platform_choices'])
        code, state = self.post('/api/os/rename', {'name': 'nada', 'new': 'Nada 2'})
        self.assertEqual(code, 200)
        code, state = self.post('/api/platforms/forget', {'name': 'Nutanix AHV'})
        self.assertEqual(code, 200)
        self.assertNotIn('Nutanix AHV', state['platform_choices'])

    def test_network_routes(self):
        code, state = self.post('/api/networks/add', {'cidr': '172.20.0.0/28', 'name': 'Lab'})
        self.assertEqual(code, 200)
        net = next(n for n in state['networks'] if n['cidr'] == '172.20.0.0/28')
        code, state = self.post('/api/networks/rename', {**net, 'name': 'Lab 2'})
        self.assertEqual(next(n for n in state['networks'] if n['id'] == net['id'])['name'], 'Lab 2')
        net = next(n for n in state['networks'] if n['id'] == net['id'])
        code, state = self.post('/api/networks/remove', net)
        self.assertNotIn(net['id'], [n['id'] for n in state['networks']])
        code, _, body = self.request('/api/suggestions')
        self.assertEqual(code, 200)
        self.assertIsInstance(json.loads(body)['networks'], list)

    def test_device_identity_is_required_for_update_and_delete(self):
        code, state = self.post('/api/devices/create', {'name': 'identity-test', 'type': 'vm'})
        self.assertEqual(code, 200)
        device = next(d for d in state['devices'] if d['name'] == 'identity-test')
        self.assertEqual(self.post('/api/devices/update', {'id': device['id'], 'name': 'Wrong device'})[0], 400)
        self.assertEqual(self.post('/api/devices/delete', {'id': device['id'], 'created_at': 'stale'})[0], 400)
        self.assertEqual(self.server.store.state()['devices'], state['devices'])
        self.assertEqual(self.post('/api/devices/delete', {'id': device['id'], 'created_at': device['created_at'], 'revision': device['revision']})[0], 200)

    def test_adding_network_scans_it_right_away(self):
        self.post('/api/networks/add', {'cidr': '172.22.0.0/30'})
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            state = json.loads(self.request('/api/state')[2])
            if '172.22.0.1' in state['observations'] and not state['scan']['running']:
                break
            time.sleep(0.02)
        self.assertTrue(state['observations']['172.22.0.1']['up'])

    def test_stale_device_edit_returns_conflict_and_preserves_latest_fields(self):
        code, state = self.post('/api/devices/create', {'name': 'two-tabs', 'type': 'vm'})
        original = next(d for d in state['devices'] if d['name'] == 'two-tabs')
        code, state = self.post('/api/devices/update', {**original, 'name': 'two-tabs-new'})
        self.assertEqual(code, 200)
        self.assertEqual(self.post('/api/devices/update', {**original, 'note': 'old form'})[0], 409)
        self.assertEqual(self.post('/api/devices/delete', original)[0], 409)
        current = next(d for d in self.server.store.state()['devices'] if d['id'] == original['id'])
        self.assertEqual(current['name'], 'two-tabs-new')
        self.assertEqual(self.post('/api/devices/delete', current)[0], 200)

    def test_network_cidr_edit_and_stale_delete(self):
        code, state = self.post('/api/networks/add', {'cidr': '198.51.100.0/28', 'name': 'Editable'})
        original = next(n for n in state['networks'] if n['name'] == 'Editable')
        self.post('/api/ips/claim', {'addresses': '198.51.100.10'})
        code, state = self.post('/api/networks/update', {**original, 'cidr': '198.51.100.0/29', 'name': 'Edited'})
        self.assertEqual(code, 200)
        self.assertIn('198.51.100.10', [i['address'] for i in state['ips']])
        self.assertEqual(self.post('/api/networks/remove', original)[0], 409)
        current = next(n for n in state['networks'] if n['id'] == original['id'])
        code, state = self.post('/api/networks/remove', current)
        self.assertEqual(code, 200)
        self.assertIn('198.51.100.10', [i['address'] for i in state['ips']])

    def test_note_edit_conflict(self):
        code, state = self.post('/api/ips/claim', {'addresses': '203.0.113.10'})
        ip = next(i for i in state['ips'] if i['address'] == '203.0.113.10')
        body = {'address': ip['address'], 'claimed_at': ip['claimed_at'], 'expected_note': ''}
        self.assertEqual(self.post('/api/ips/note', {**body, 'note': 'Keep'})[0], 200)
        self.assertEqual(self.post('/api/ips/note', {**body, 'note': 'Stale'})[0], 409)
        self.assertEqual(next(i for i in self.server.store.state()['ips'] if i['address'] == ip['address'])['note'], 'Keep')

    def test_scan_settings_route(self):
        code, state = self.post('/api/scan/settings', {'interval': 900})
        self.assertEqual((code, state['scan']['interval']), (200, 900))
        code, body = self.post('/api/scan/settings', {'interval': 10})
        self.assertEqual(code, 400)
        code, state = self.post('/api/scan/settings', {'interval': 0})
        self.assertEqual(state['scan']['interval'], 0)

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
