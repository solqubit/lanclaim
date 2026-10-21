import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from lanclaim.db import Store
from lanclaim.server import Server


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = Server(('127.0.0.1', 0), Store(Path(cls.temp.name) / 'db.sqlite3'))
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

    def test_serves_app_with_security_headers(self):
        code, headers, body = self.request('/')
        self.assertEqual(code, 200)
        self.assertIn('Mi espacio de IPs'.encode(), body)
        self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
        for asset in ('app.js', 'i18n.js', 'style.css', 'favicon.svg'):
            self.assertEqual(self.request('/' + asset)[0], 200)

    def test_denies_cross_site_and_unknown_host(self):
        for headers in ({'Host': 'evil.example'}, {'Origin': 'https://evil.example'}, {'Sec-Fetch-Site': 'cross-site'}):
            self.assertEqual(self.request('/api/state', headers=headers)[0], 403)

    def test_post_requires_csrf_and_json(self):
        self.assertEqual(self.request('/api/commands/claim', 'POST', {'addresses': '10.0.0.1'})[0], 403)
        headers = {'X-CSRF-Token': self.server.csrf}
        self.assertEqual(self.request('/api/commands/claim', 'POST', {}, headers)[0], 415)

    def test_json_commands_and_history(self):
        headers = {'X-CSRF-Token': self.server.csrf, 'Content-Type': 'application/json'}
        result = self.request('/api/commands/claim', 'POST', {'addresses': '10.2.3.4'}, headers)
        self.assertEqual(result[0], 200)
        state = json.loads(self.request('/api/state')[2])
        self.assertEqual(state['counts']['claimed'], 1)
        events = json.loads(self.request('/api/history?ip_id=1')[2])['events']
        self.assertEqual(events[0]['kind'], 'claimed')

    def test_invalid_body_and_path_do_not_mutate(self):
        headers = {'X-CSRF-Token': self.server.csrf, 'Content-Type': 'application/json'}
        self.assertEqual(self.request('/api/commands/claim', 'POST', [], headers)[0], 400)
        self.assertEqual(self.request('/api/history?ip_id=nope')[0], 400)
        for path in ('/../lanclaim/db.py', '/data/lanclaim.sqlite3', '/unknown'):
            self.assertEqual(self.request(path)[0], 404)

    def test_scan_api_auth_validation_and_results(self):
        headers = {'X-CSRF-Token': self.server.csrf, 'Content-Type': 'application/json'}
        self.assertEqual(self.request('/api/scans/start', 'POST', {'addresses': '127.0.0.1'})[0], 403)
        self.assertEqual(self.request('/api/scans/cancel', 'POST', {})[0], 403)
        self.assertEqual(self.request('/api/scans/start', 'POST', [], headers)[0], 400)
        self.assertEqual(self.request('/api/scans/start', 'POST', {'addresses': '::1'}, headers)[0], 400)
        before = self.server.store.snapshot()
        self.server.scanner.probe = lambda address: 'responding'
        self.assertEqual(self.request('/api/scans/start', 'POST', {'addresses': '127.0.0.1'}, headers)[0], 200)
        self.server.scanner.thread.join(3)
        result = json.loads(self.request('/api/scans')[2])
        self.assertEqual(result['scan']['status'], 'completed')
        self.assertEqual(result['observations'][0]['status'], 'responding')
        self.assertEqual(before, self.server.store.snapshot())


if __name__ == '__main__':
    unittest.main()
