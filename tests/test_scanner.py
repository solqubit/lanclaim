import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from lanclaim.db import Invalid, Store
from lanclaim.scanner import PING_NETWORK_ERROR, PING_PERMISSION_ERROR, PingUnavailable, Scanner, ping


def wait_idle(scanner, timeout=5):
    deadline = time.monotonic() + timeout
    while scanner.status()['running']:
        if time.monotonic() > deadline:
            raise AssertionError('scan did not finish')
        time.sleep(0.01)
    return scanner.status()


class ScannerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / 'db.sqlite3')
        self.store.add_network('10.0.0.0/29')
        self.store.claim(['10.0.0.2'], {'name': 'keep', 'type': 'vm'})
        self.probed = []
        self.scanner = Scanner(self.store, probe=self.fake, interval=0)

    def tearDown(self):
        self.scanner.close()
        self.temp.cleanup()

    def fake(self, address):
        self.probed.append(address)
        return 'responding' if address.endswith(('.1', '.2')) else 'no_response'

    def test_cycle_records_all_watched(self):
        before = self.store.state()
        self.scanner.scan_now()
        status = wait_idle(self.scanner)
        self.assertEqual(sorted(self.probed), [f'10.0.0.{n}' for n in range(1, 7)])
        self.assertEqual((status['total'], status['done'], status['error']), (6, 6, ''))
        self.assertTrue(status['finished_at'])
        obs = self.store.state()['observations']
        self.assertTrue(obs['10.0.0.1']['up'])
        self.assertFalse(obs['10.0.0.3']['up'])
        self.assertEqual(before['ips'], self.store.state()['ips'])
        self.assertEqual(before['devices'], self.store.state()['devices'])

    def test_scan_now_does_not_overlap(self):
        entered, release = threading.Event(), threading.Event()

        def blocking(address):
            entered.set()
            release.wait(3)
            return 'responding'

        self.scanner.probe = blocking
        self.scanner.scan_now()
        self.assertTrue(entered.wait(3))
        self.assertTrue(self.scanner.status()['running'])
        threads = threading.active_count()
        self.scanner.scan_now()
        self.assertEqual(threading.active_count(), threads)
        release.set()
        self.assertEqual(wait_idle(self.scanner)['done'], 6)

    def test_probe_error_is_reported_and_loop_survives(self):
        def broken(address):
            raise PingUnavailable(PING_PERMISSION_ERROR)

        self.scanner.probe = broken
        self.scanner.scan_now()
        status = wait_idle(self.scanner)
        self.assertEqual(status['error'], PING_PERMISSION_ERROR)
        self.assertEqual(self.store.state()['observations'], {})
        self.scanner.probe = self.fake
        self.scanner.scan_now()
        self.assertEqual(wait_idle(self.scanner)['error'], '')

    def test_per_address_error_does_not_stop_cycle(self):
        def flaky(address):
            if address == '10.0.0.3':
                raise Invalid(PING_NETWORK_ERROR)
            return 'responding'

        self.scanner.probe = flaky
        self.scanner.scan_now()
        status = wait_idle(self.scanner)
        self.assertEqual((status['done'], status['error']), (6, ''))
        obs = self.store.state()['observations']
        self.assertNotIn('10.0.0.3', obs)
        self.assertEqual(len(obs), 5)

    def test_unexpected_error_is_generic(self):
        def crash(address):
            raise RuntimeError('boom')

        self.scanner.probe = crash
        self.scanner.scan_now()
        self.assertTrue(wait_idle(self.scanner)['error'])

    def test_interval_zero_disables_loop(self):
        self.scanner.start()
        time.sleep(0.1)
        self.assertEqual(self.probed, [])
        self.assertIsNone(self.scanner.status()['finished_at'])

    def test_periodic_loop_runs_first_cycle_immediately(self):
        scanner = Scanner(self.store, probe=self.fake, interval=3600)
        try:
            scanner.start()
            deadline = time.monotonic() + 5
            while scanner.status()['finished_at'] is None and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(scanner.status()['done'], 6)
        finally:
            scanner.close()

    def test_empty_inventory_completes(self):
        empty = Store(Path(self.temp.name) / 'empty.sqlite3')
        scanner = Scanner(empty, probe=self.fake, interval=0)
        scanner.scan_now()
        status = wait_idle(scanner)
        self.assertEqual((status['total'], status['done'], status['error']), (0, 0, ''))
        scanner.close()


class PingTests(unittest.TestCase):
    @patch('lanclaim.scanner.shutil.which', return_value='/usr/bin/ping')
    @patch('lanclaim.scanner.subprocess.run')
    def test_platform_ping_results_and_arguments(self, run, which):
        with patch('lanclaim.scanner.sys.platform', 'linux'):
            run.return_value = subprocess.CompletedProcess([], 0, b'', b'')
            self.assertEqual(ping('127.0.0.1'), 'responding')
            self.assertEqual(run.call_args.args[0][-1], '127.0.0.1')
            self.assertNotIn('shell', run.call_args.kwargs)
            self.assertEqual(run.call_args.kwargs['env']['LC_ALL'], 'C')
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
            self.assertIsNone(run.call_args.kwargs['env'])
        with self.assertRaises(ValueError):
            ping('127.0.0.1 & other-command')

    @patch('lanclaim.scanner.shutil.which', return_value=None)
    def test_missing_ping_is_explicit(self, which):
        with self.assertRaisesRegex(Invalid, 'No se encontró ping'):
            ping('127.0.0.1')

    @patch('lanclaim.scanner.shutil.which', return_value='ping')
    @patch('lanclaim.scanner.subprocess.run', side_effect=subprocess.TimeoutExpired('ping', 4))
    def test_process_timeout_is_explicit(self, run, which):
        with self.assertRaisesRegex(Invalid, 'Ping no terminó a tiempo'):
            ping('127.0.0.1')

    @patch('lanclaim.scanner.shutil.which', return_value='/usr/bin/ping')
    @patch('lanclaim.scanner.sys.platform', 'linux')
    @patch('lanclaim.scanner.subprocess.run')
    def test_missing_route_is_distinct_from_no_response(self, run, which):
        run.return_value = subprocess.CompletedProcess([], 2, b'', b'ping: connect: Network is unreachable')
        with self.assertRaisesRegex(Invalid, 'no tiene una ruta'):
            ping('192.0.2.1')

    @patch('lanclaim.scanner.shutil.which', return_value='/usr/bin/ping')
    @patch('lanclaim.scanner.sys.platform', 'linux')
    @patch('lanclaim.scanner.subprocess.run')
    def test_ping_failures_do_not_log_warnings_per_call(self, run, which):
        run.return_value = subprocess.CompletedProcess([], 2, b'', b'ping: socket: Operation not permitted')
        with self.assertNoLogs('lanclaim.scanner', level='WARNING'):
            with self.assertRaises(PingUnavailable):
                ping('127.0.0.1')
        run.return_value = subprocess.CompletedProcess([], 2, b'', b'Do you want to ping broadcast? Then -b.')
        with self.assertNoLogs('lanclaim.scanner', level='WARNING'):
            with self.assertRaises(Invalid) as ctx:
                ping('192.168.1.255')
        self.assertNotIsInstance(ctx.exception, PingUnavailable)
