import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from lanclaim.db import Invalid, SCHEMA, Store


class MachineDeletionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'inventory.sqlite3'
        self.store = Store(self.path)
        self.store.command('claim', {'addresses': '192.0.2.1-192.0.2.3'})
        self.ident = self.store.command('create_machine', {'name': 'Remove VM', 'notes': 'Private device notes'})['id']
        self.store.command('assign', {'ip_id': 1, 'machine_id': self.ident, 'reason': 'Private assignment notes'})

    def payload(self):
        device = next(m for m in self.store.snapshot()['machines'] if m['id'] == self.ident)
        return {'id': self.ident, 'created_at': device['created_at'], 'confirmation': device['name']}

    def retire(self):
        self.store.command('retire', {'id': self.ident, 'reason': 'Private retirement notes'})

    def test_delete_preserves_ips_reuse_other_devices_plans_and_reviews(self):
        self.retire()
        other = self.store.command('create_machine', {'name': 'Keep VM'})['id']
        self.store.command('assign', {'ip_id': 2, 'machine_id': other})
        self.store.command('ip_notes', {'ip_id': 1, 'notes': 'Keep IP notes'})
        self.store.command('plan', {'ip_id': 3, 'target': 'Future VM'})
        self.store.command('review', {'ip_id': 2, 'reason': 'Keep review'})
        before = self.store.snapshot()
        self.store.command('delete_machine', self.payload())
        after = Store(self.path).snapshot()
        self.assertEqual(after['ips'], before['ips'])
        self.assertEqual(after['plans'], before['plans'])
        self.assertEqual(after['reviews'], before['reviews'])
        self.assertEqual([m['name'] for m in after['machines']], ['Keep VM'])
        self.assertTrue(after['ips'][0]['reusable'])
        closed = next(a for a in after['assignments'] if a['ip_id'] == 1)
        self.assertIsNone(closed['machine_id'])
        self.assertEqual((closed['reason'], closed['end_reason']), ('', ''))
        self.assertEqual(closed['ended_at'], before['assignments'][0]['ended_at'])
        history = self.store.history()
        self.assertNotIn('Private', json.dumps(history))
        self.assertNotIn('Remove VM', json.dumps(history))
        self.assertEqual(self.store.history(machine_id=self.ident), [])
        self.assertEqual(self.store.history(ip_id=1)[0]['kind'], 'ip_edited')
        with self.store.connect() as db:
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_active_reinstalling_and_reactivated_devices_cannot_be_deleted(self):
        for action in (None, 'reinstall', 'retire', 'restore_machine'):
            if action:
                self.store.command(action, {'id': self.ident, 'reason': 'State transition'})
            if action == 'retire':
                continue
            before, history = self.store.snapshot(), self.store.history()
            with self.assertRaisesRegex(Invalid, 'retirada'):
                self.store.command('delete_machine', self.payload())
            self.assertEqual(self.store.snapshot(), before)
            self.assertEqual(self.store.history(), history)

    def test_confirmation_and_identity_are_mandatory(self):
        self.retire()
        payload = self.payload()
        for invalid in ({'confirmation': ''}, {'confirmation': 'Another VM'}, {'created_at': 'old'}, {'created_at': None}):
            before, history = self.store.snapshot(), self.store.history()
            with self.assertRaises(Invalid):
                self.store.command('delete_machine', {**payload, **invalid})
            self.assertEqual(self.store.snapshot(), before)
            self.assertEqual(self.store.history(), history)

    def test_inconsistent_retired_device_with_live_assignment_is_blocked(self):
        with self.store.transaction() as db:
            db.execute("UPDATE machines SET lifecycle='retired' WHERE id=?", (self.ident,))
        before = self.store.snapshot()
        with self.assertRaisesRegex(Invalid, 'sin IPs asignadas'):
            self.store.command('delete_machine', self.payload())
        self.assertEqual(self.store.snapshot(), before)

    def test_failure_rolls_back_deletion_and_anonymization(self):
        self.retire()
        payload = self.payload()
        before, history = self.store.snapshot(), self.store.history()
        with patch.object(self.store, 'event', side_effect=RuntimeError('Storage failure')):
            with self.assertRaises(RuntimeError):
                self.store.command('delete_machine', payload)
        self.assertEqual(self.store.snapshot(), before)
        self.assertEqual(self.store.history(), history)

    def test_deleted_ids_are_not_reused_by_new_devices(self):
        self.retire()
        payload = self.payload()
        self.store.command('delete_machine', payload)
        self.ident = self.store.command('create_machine', {'name': payload['confirmation']})['id']
        self.retire()
        self.assertGreater(self.ident, payload['id'])
        with self.assertRaisesRegex(Invalid, 'ya no existe'):
            self.store.command('delete_machine', payload)
        self.assertEqual(len(self.store.snapshot()['machines']), 1)

    def test_version_three_migration_preserves_live_and_closed_usage_and_guards(self):
        legacy = Path(self.temp.name) / 'v3.sqlite3'
        with sqlite3.connect(legacy) as db:
            db.executescript(SCHEMA + """
                CREATE TABLE observations(address TEXT PRIMARY KEY,status TEXT,checked_at TEXT);
                CREATE TABLE machine_choices(field TEXT,value TEXT,PRIMARY KEY(field,value));
                INSERT INTO machine_choices VALUES('os','Debian');
                INSERT INTO ips(id,address,family,claimed_at) VALUES(1,'192.0.2.1',4,'before'),(2,'192.0.2.2',4,'before');
                INSERT INTO machines(id,name,created_at) VALUES(1,'Legacy','before');
                INSERT INTO assignments(id,ip_id,machine_id,started_at,ended_at) VALUES(1,1,1,'before','closed');
                INSERT INTO assignments(id,ip_id,machine_id,started_at) VALUES(2,2,1,'before');
                PRAGMA user_version=3;
            """)
        db.close()
        upgraded = Store(legacy)
        state = upgraded.snapshot()
        self.assertEqual(state['ips'][1]['assignment']['id'], 2)
        self.assertTrue(state['ips'][0]['reusable'])
        self.assertEqual(state['machine_choices']['os'], ['Debian'])
        with upgraded.transaction() as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 4)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("INSERT INTO assignments(ip_id,started_at) VALUES(1,'now')")
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("INSERT INTO plans(ip_id,target,created_at) VALUES(2,'Blocked','now')")
        self.assertEqual(Store(legacy).snapshot(), state)
