import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path

from lanclaim.db import Conflict, Invalid, MIGRATIONS, SCHEMA, Store
from lanclaim.scanner import PING_NETWORK_ERROR, Scanner


class ReviewChangesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'inventory.sqlite3'
        self.store = Store(self.path)

    def test_edit_and_remove_network_preserves_claims_devices_and_notes(self):
        ident = self.store.add_network('192.0.2.0/24', 'Old')
        self.store.create_device({'name': 'VM', 'type': 'vm'}, ['192.0.2.10'])
        self.store.claim('192.0.2.200')
        self.store.set_note('192.0.2.200', 'Keep this note')
        before = self.store.state()
        net = before['networks'][0]
        self.store.update_network(ident, '192.0.2.0/25', 'Smaller',
                                  expected_created_at=net['created_at'], expected_revision=net['revision'])
        after = self.store.state()
        self.assertEqual(after['ips'], before['ips'])
        self.assertEqual(after['devices'], before['devices'])
        self.assertIn('192.0.2.200', self.store.watched_addresses())
        self.store.remove_network(ident)
        self.assertEqual(self.store.state()['ips'], before['ips'])
        self.assertEqual(self.store.state()['devices'], before['devices'])

    def test_bad_network_edit_rolls_back_all_fields(self):
        ident = self.store.add_network('192.0.2.0/24', 'Keep')
        self.store.add_network('198.51.100.0/24')
        self.store.claim('192.0.2.127')
        before = self.store.state()
        for cidr in ('192.0.2.0/25', '198.51.100.0/24', '192.0.0.0/16', 'not a network'):
            with self.subTest(cidr=cidr), self.assertRaises(Invalid):
                self.store.update_network(ident, cidr, 'Must not be saved')
            self.assertEqual(self.store.state(), before)

    def test_network_versions_and_non_reused_ids(self):
        ident = self.store.add_network('192.0.2.0/24')
        original = self.store.state()['networks'][0]
        self.store.update_network(ident, '192.0.2.0/25', 'New')
        with self.assertRaises(Conflict):
            self.store.remove_network(ident, expected_revision=original['revision'])
        with self.assertRaises(Conflict):
            self.store.update_network(ident, '192.0.2.0/24', 'Stale', expected_revision=original['revision'])
        self.store.remove_network(ident)
        self.store = Store(self.path)
        self.assertGreater(self.store.add_network('192.0.2.0/24'), ident)

    def test_concurrent_edit_only_one_version_is_accepted(self):
        ident = self.store.create_device({'name': 'Original', 'type': 'vm'})
        original = self.store.state()['devices'][0]
        barrier = threading.Barrier(2)
        results = []

        def edit(name):
            barrier.wait(timeout=3)
            try:
                self.store.update_device(ident, {**original, 'name': name},
                                         expected_created_at=original['created_at'], expected_revision=original['revision'])
                results.append('saved')
            except Conflict:
                results.append('conflict')

        threads = [threading.Thread(target=edit, args=(name,)) for name in ('First', 'Second')]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive())
        self.assertCountEqual(results, ['saved', 'conflict'])
        self.assertEqual(self.store.state()['devices'][0]['revision'], original['revision'] + 1)

    def test_assignment_changes_also_invalidate_old_device_forms(self):
        ident = self.store.create_device({'name': 'VM', 'type': 'vm'})
        revision = self.store.state()['devices'][0]['revision']
        self.store.claim('192.0.2.10', {'id': ident})
        with self.assertRaises(Conflict):
            self.store.update_device(ident, {'name': 'Stale', 'type': 'vm'}, expected_revision=revision)
        self.assertEqual(self.store.state()['devices'][0]['name'], 'VM')
        self.assertEqual(self.store.state()['ips'][0]['device_id'], ident)

    def test_note_conflict_and_reclaimed_identity_preserve_new_data(self):
        self.store.claim('192.0.2.10')
        ip = self.store.state()['ips'][0]
        self.store.set_note(ip['address'], 'First', expected_note=ip['note'], expected_claimed_at=ip['claimed_at'])
        with self.assertRaises(Conflict):
            self.store.set_note(ip['address'], 'Stale', expected_note=ip['note'], expected_claimed_at=ip['claimed_at'])
        self.store.release(ip['address'])
        self.store.claim(ip['address'])
        with self.assertRaises(Conflict):
            self.store.set_note(ip['address'], 'Old identity', expected_note='', expected_claimed_at=ip['claimed_at'])
        self.assertEqual(self.store.state()['ips'][0]['note'], '')

    def test_error_preserves_last_success_and_success_clears_error(self):
        self.store.claim('192.0.2.10')
        self.store.record_observations({'192.0.2.10': True}, '2026-10-23T10:00:00+00:00')
        self.store.record_probe_errors({'192.0.2.10': PING_NETWORK_ERROR}, '2026-10-23T10:01:00+00:00')
        obs = self.store.state()['observations']['192.0.2.10']
        self.assertEqual(obs['last_up_at'], '2026-10-23T10:00:00+00:00')
        self.assertEqual(obs['error'], PING_NETWORK_ERROR)
        self.store.record_observations({'192.0.2.10': False}, '2026-10-23T10:02:00+00:00')
        obs = self.store.state()['observations']['192.0.2.10']
        self.assertEqual(obs['error'], '')
        self.assertFalse(obs['up'])
        self.assertEqual(obs['last_up_at'], '2026-10-23T10:00:00+00:00')

    def test_all_routes_fail_exposes_errors_and_never_changes_inventory(self):
        self.store.add_network('192.0.2.0/30')
        self.store.claim('192.0.2.1', {'name': 'Keep'})
        before = self.store.state()

        def no_route(address):
            raise Invalid(PING_NETWORK_ERROR)

        scanner = Scanner(self.store, probe=no_route, interval=0)
        self.addCleanup(scanner.close)
        scanner.scan_now()
        deadline = time.monotonic() + 3
        while scanner.status()['running'] and time.monotonic() < deadline:
            time.sleep(0.01)
        status = scanner.status()
        self.assertFalse(status['running'])
        self.assertEqual((status['done'], status['failed'], status['checked']), (2, 2, 0))
        self.assertEqual(status['error'], PING_NETWORK_ERROR)
        after = self.store.state()
        self.assertEqual(after['ips'], before['ips'])
        self.assertEqual(after['devices'], before['devices'])
        self.assertTrue(all(o['error'] for o in after['observations'].values()))

    def test_v11_migration_preserves_inventory_and_seeds_network_counter(self):
        legacy = Path(self.temp.name) / 'v11.sqlite3'
        db = sqlite3.connect(legacy)
        db.executescript(SCHEMA + ''.join(MIGRATIONS[v] for v in range(6, 12)) + """
          INSERT INTO networks VALUES(7,'192.0.2.0/24',3221225984,'Keep','created');
          INSERT INTO devices(id,name,name_key,type,os,note,created_at) VALUES(8,'VM','vm','vm','Debian','Notes','created');
          INSERT INTO ips(address,sort_key,device_id,note,claimed_at) VALUES('192.0.2.10',3221225994,8,'IP note','created');
          UPDATE identity_counters SET value=8 WHERE name='device_id';
          PRAGMA user_version=11;
        """)
        db.close()
        migrated = Store(legacy)
        state = migrated.state()
        self.assertEqual(state['networks'][0]['name'], 'Keep')
        self.assertEqual(state['networks'][0]['revision'], 1)
        self.assertEqual(state['devices'][0]['note'], 'Notes')
        self.assertEqual(state['ips'][0]['device_id'], 8)
        self.assertGreater(migrated.add_network('198.51.100.0/24'), 7)
        with migrated.connect() as db:
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
