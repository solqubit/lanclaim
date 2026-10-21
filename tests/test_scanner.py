import sqlite3
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from lanclaim.db import Invalid, SCHEMA, Store
from lanclaim.scanner import Scanner, ping, scan_addresses


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'db.sqlite3'
        self.store = Store(self.path)
        self.scanner = Scanner(self.store)

    def tearDown(self):
        self.scanner.close()
        self.temp.cleanup()

    def finish(self):
        self.scanner.thread.join(5)
        self.assertFalse(self.scanner.thread.is_alive())
        return self.scanner.snapshot()

    def test_bounded_targets_and_cidr_endpoints(self):
        self.assertEqual(scan_addresses('192.168.1.0/30'), ['192.168.1.1', '192.168.1.2'])
        self.assertEqual(scan_addresses('192.168.1.0/31'), ['192.168.1.0', '192.168.1.1'])
        for raw in ('10.0.0.0/16', '10.0.0.0/21', '::1', '--help', '224.0.0.1', '0.0.0.0', '255.255.255.255'):
            with self.assertRaises(Invalid):
                self.scanner.start(raw)
        self.assertEqual(self.store.observations(), [])

    def test_scan_persists_observations_without_changing_inventory(self):
        self.store.command('claim', {'addresses': '10.0.0.1-10.0.0.2'})
        machine = self.store.command('create_machine', {'name': 'Keep this assignment'})
        self.store.command('assign', {'ip_id': 1, 'machine_id': machine['id']})
        before, history = self.store.snapshot(), self.store.history()
        self.scanner.probe = lambda address: 'no_response' if address.endswith('.1') else 'responding'
        self.scanner.start('10.0.0.1-10.0.0.3')
        result = self.finish()
        self.assertEqual(result['scan']['status'], 'completed')
        self.assertEqual(result['scan']['responding'], 2)
        self.assertEqual(before, self.store.snapshot())
        self.assertEqual(history, self.store.history())
        self.assertEqual(len(Store(self.path).observations()), 3)
        self.assertEqual(self.store.observations()[0]['status'], 'no_response')

    def test_cancel_and_single_concurrent_job(self):
        entered, release = threading.Event(), threading.Event()

        def probe(address):
            entered.set()
            release.wait(3)
            return 'responding'

        self.scanner.probe = probe
        self.scanner.start('10.0.0.0/24')
        self.assertTrue(entered.wait(3))
        try:
            with self.assertRaises(Invalid):
                self.scanner.start('127.0.0.1')
            self.assertEqual(self.scanner.cancel()['status'], 'cancelling')
        finally:
            release.set()
        result = self.finish()
        self.assertEqual(result['scan']['status'], 'cancelled')
        self.assertLessEqual(result['scan']['completed'], 16)
        self.assertEqual(len(result['observations']), result['scan']['completed'])

    def test_local_error_is_not_a_no_response_observation(self):
        self.store.observe('127.0.0.1', 'responding')
        before = self.store.observations()
        def fail(address):
            raise Invalid('No se encontró ping. Instala iputils-ping o iputils en el servidor.')
        self.scanner.probe = fail
        self.scanner.start('127.0.0.1')
        result = self.finish()
        self.assertEqual(result['scan']['status'], 'failed')
        self.assertTrue(result['scan']['error'])
        self.assertEqual(before, result['observations'])

    def test_schema_one_upgrade_preserves_records(self):
        old = Path(self.temp.name) / 'old.sqlite3'
        with sqlite3.connect(old) as db:
            db.executescript(SCHEMA)
            db.execute("INSERT INTO ips(address,family,claimed_at) VALUES('10.0.0.1',4,'before')")
        db.close()
        upgraded = Store(old)
        self.assertEqual(upgraded.snapshot()['ips'][0]['address'], '10.0.0.1')
        upgraded.observe('10.0.0.1', 'responding')
        self.assertEqual(len(Store(old).observations()), 1)

    @patch('lanclaim.scanner.shutil.which', return_value='/usr/bin/ping')
    @patch('lanclaim.scanner.subprocess.run')
    def test_platform_ping_results_and_arguments(self, run, which):
        with patch('lanclaim.scanner.sys.platform', 'linux'):
            run.return_value = subprocess.CompletedProcess([], 0, b'', b'')
            self.assertEqual(ping('127.0.0.1'), 'responding')
            self.assertEqual(run.call_args.args[0][-1], '127.0.0.1')
            self.assertNotIn('shell', run.call_args.kwargs)
            run.return_value.returncode = 1
            self.assertEqual(ping('127.0.0.1'), 'no_response')
            run.return_value.returncode = 2
            with self.assertRaises(Invalid):
                ping('127.0.0.1')
        with patch('lanclaim.scanner.sys.platform', 'win32'):
            run.return_value = subprocess.CompletedProcess([], 0, b'Destination host unreachable.', b'')
            self.assertEqual(ping('127.0.0.1'), 'no_response')
            run.return_value.stdout = b'Reply from 127.0.0.1: bytes=32 time<1ms TTL=128'
            self.assertEqual(ping('127.0.0.1'), 'responding')
        with self.assertRaises(ValueError):
            ping('127.0.0.1 & other-command')

    @patch('lanclaim.scanner.shutil.which', return_value=None)
    def test_missing_ping_is_explicit(self, which):
        with self.assertRaisesRegex(Invalid, 'No se encontró ping'):
            ping('127.0.0.1')

    @patch('lanclaim.scanner.shutil.which', return_value='ping')
    @patch('lanclaim.scanner.subprocess.run', side_effect=subprocess.TimeoutExpired('ping', 4))
    def test_process_timeout_is_explicit(self, run, which):
        with self.assertRaises(Invalid):
            ping('127.0.0.1')
