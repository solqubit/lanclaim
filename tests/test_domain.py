import concurrent.futures
import sqlite3
import tempfile
import unittest
from pathlib import Path

from lanclaim.db import Invalid, Store, addresses


class DomainTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'inventory.sqlite3'
        self.store = Store(self.path)
        self.store.command('claim', {'addresses': '192.168.1.10-192.168.1.14'})
        self.machine_id = self.store.command('create_machine', {'name': 'VM-A', 'os': 'Debian'})['id']

    def tearDown(self):
        self.temp.cleanup()

    def assign(self, ip_id=1, machine_id=None, **extra):
        return self.store.command('assign', {'ip_id': ip_id, 'machine_id': machine_id or self.machine_id, **extra})

    def ip(self, ident=1):
        return next(i for i in self.store.snapshot()['ips'] if i['id'] == ident)

    def test_claim_does_not_assign_and_survives_restart(self):
        state = Store(self.path).snapshot()
        self.assertEqual(state['counts']['claimed'], 5)
        self.assertEqual(state['counts']['available'], 5)
        self.assertEqual(state['assignments'], [])

    def test_claim_preview_and_overlap_preserve_existing(self):
        self.assign()
        result = self.store.command('preview_claim', {'addresses': '192.168.1.12-192.168.1.16'})
        self.assertEqual((result['added'], result['existing']), (2, 3))
        self.assertEqual(len(self.store.snapshot()['ips']), 5)
        self.store.command('claim', {'addresses': '192.168.1.10-192.168.1.16'})
        self.assertEqual(len(self.store.snapshot()['ips']), 7)
        self.assertEqual(self.ip()['assignment']['machine_id'], self.machine_id)

    def test_invalid_batch_is_atomic(self):
        with self.assertRaises(Invalid):
            self.store.command('claim', {'addresses': '10.0.0.1 nope'})
        self.assertEqual(len(self.store.snapshot()['ips']), 5)

    def test_address_normalization_families_and_limits(self):
        self.assertEqual(addresses('2001:db8::1,2001:0db8:0:0:0:0:0:1'), ['2001:db8::1'])
        self.assertEqual(addresses('::/126'), ['::', '::1', '::2', '::3'])
        self.assertEqual(addresses('10.0.0.1 - 10.0.0.2'), ['10.0.0.1', '10.0.0.2'])
        self.assertEqual(len(addresses('10.0.0.0/20')), 4096)
        for invalid in ('10.0.0.0/8', '::/64', '10.0.0.3-10.0.0.1', '10.0.0.1-::1', 'fe80::1%eth0'):
            with self.subTest(invalid=invalid), self.assertRaises(Invalid):
                addresses(invalid)

    def test_plan_execute_and_history(self):
        self.store.command('plan', {'ip_id': 1, 'target': 'Nuevo servidor'})
        plan = self.ip()['plan']
        with self.assertRaises(Invalid):
            self.assign()
        self.assign(plan_id=plan['id'])
        self.assertIsNone(self.ip()['plan'])
        self.assertEqual(self.ip()['status'], 'assigned')
        self.assertEqual(self.store.snapshot()['plans'][0]['status'], 'executed')
        self.assertIn('plan_executed', [e['kind'] for e in self.store.history(ip_id=1)])

    def test_stale_plan_cannot_assign(self):
        self.store.command('plan', {'ip_id': 1, 'target': 'Future'})
        plan_id = self.ip()['plan']['id']
        self.store.command('cancel_plan', {'id': plan_id, 'reason': 'Cambio de proyecto'})
        with self.assertRaises(Invalid):
            self.assign(plan_id=plan_id)
        self.assertEqual(self.ip()['status'], 'available')

    def test_release_reuse_and_machine_history(self):
        self.assign()
        assignment = self.ip()['assignment']
        self.store.command('release', {'ip_id': 1, 'assignment_id': assignment['id'], 'reason': 'Equipo sustituido'})
        self.assertTrue(self.ip()['reusable'])
        other = self.store.command('create_machine', {'name': 'VM-B'})['id']
        self.assign(machine_id=other)
        assignments = self.store.snapshot()['assignments']
        self.assertEqual(len(assignments), 2)
        self.assertIsNotNone(assignments[0]['ended_at'])
        self.assertIsNone(assignments[1]['ended_at'])
        self.assertEqual(self.store.snapshot()['counts']['claimed'], 5)
        with self.assertRaises(Invalid):
            self.store.command('release', {'ip_id': 1, 'assignment_id': assignment['id'], 'reason': 'Petición antigua'})
        self.assertEqual(self.ip()['assignment']['machine_id'], other)

    def test_retirement_releases_all_preserves_reviews(self):
        self.assign(1)
        self.assign(2)
        self.store.command('review', {'ip_id': 2, 'reason': 'Posible uso externo'})
        self.store.command('retire', {'id': self.machine_id, 'reason': 'VM eliminada'})
        self.assertEqual(self.ip(1)['status'], 'available')
        self.assertEqual(self.ip(2)['status'], 'review')
        self.assertIsNone(self.ip(2)['assignment'])
        self.assertEqual(self.store.snapshot()['counts']['retired'], 1)
        with self.assertRaises(Invalid):
            self.assign(3)
        self.store.command('restore_machine', {'id': self.machine_id, 'reason': 'Recuperada'})
        self.assertEqual(self.store.snapshot()['counts']['assigned'], 0)

    def test_retirement_failure_rolls_back_assignments_and_history(self):
        self.assign(1)
        self.assign(2)
        before = self.store.snapshot()
        history = self.store.history()
        original = self.store.event

        def fail(db, kind, detail, ip_id=None, machine_id=None):
            if kind == 'retire':
                raise RuntimeError('Simulated disk error')
            original(db, kind, detail, ip_id, machine_id)

        self.store.event = fail
        with self.assertRaises(RuntimeError):
            self.store.command('retire', {'id': self.machine_id, 'reason': 'Retirar'})
        self.assertEqual(before, self.store.snapshot())
        self.assertEqual(history, self.store.history())

    def test_stale_retirement_preview_cannot_release_new_assignment(self):
        self.assign(1)
        assignment_id = self.ip()['assignment']['id']
        self.assign(2)
        with self.assertRaises(Invalid):
            self.store.command('retire', {'id': self.machine_id, 'reason': 'Retirar', 'assignment_ids': [assignment_id]})
        self.assertEqual(self.store.snapshot()['counts']['assigned'], 2)

    def test_reinstall_preserves_identity_and_assignments(self):
        self.assign(1)
        self.assign(2)
        before = self.store.snapshot()['assignments']
        self.store.command('reinstall', {'id': self.machine_id, 'reason': 'Formatear Debian'})
        self.assertEqual(self.store.snapshot()['machines'][0]['lifecycle'], 'reinstalling')
        self.assertEqual(self.store.snapshot()['assignments'], before)
        self.assertEqual(self.store.snapshot()['counts']['assigned'], 2)
        self.store.command('edit_machine', {'id': self.machine_id, 'name': 'VM-A nueva', 'os': 'Ubuntu', 'hostname': 'vm-a'})
        self.store.command('finish_reinstall', {'id': self.machine_id, 'reason': 'Instalación completada'})
        self.assertEqual(self.store.snapshot()['assignments'], before)
        self.assertEqual(self.store.snapshot()['machines'][0]['lifecycle'], 'active')
        self.assertEqual(self.store.snapshot()['machines'][0]['id'], self.machine_id)
        kinds = [e['kind'] for e in self.store.history(machine_id=self.machine_id)]
        self.assertIn('reinstall', kinds)
        self.assertIn('finish_reinstall', kinds)

    def test_review_does_not_lose_assignment_and_counts_overlap_explicitly(self):
        self.assign()
        self.store.command('review', {'ip_id': 1, 'reason': 'MAC diferente'})
        self.store.command('review', {'ip_id': 1, 'reason': 'Hostname diferente'})
        counts = self.store.snapshot()['counts']
        self.assertEqual((counts['assigned'], counts['review'], counts['available']), (1, 1, 4))
        reviews = self.store.snapshot()['reviews']
        self.store.command('resolve_review', {'id': reviews[0]['id'], 'reason': 'Confirmado'})
        self.assertEqual(self.ip()['status'], 'review')
        self.store.command('resolve_review', {'id': reviews[1]['id'], 'reason': 'Cambio legítimo'})
        self.assertEqual(self.ip()['status'], 'assigned')

    def test_review_blocks_plan_execution_without_closing_plan(self):
        self.store.command('plan', {'ip_id': 1, 'target': 'VM futura'})
        plan = self.ip()['plan']
        self.store.command('review', {'ip_id': 1, 'reason': 'Validar destino'})
        with self.assertRaises(Invalid):
            self.assign(plan_id=plan['id'])
        self.assertEqual(self.ip()['plan']['id'], plan['id'])

    def test_concurrent_assignment_has_one_winner(self):
        def attempt(_):
            try:
                self.assign()
                return True
            except Invalid:
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(sum(results), 1)
        self.assertEqual(len(self.store.snapshot()['assignments']), 1)

    def test_database_guards_against_double_or_planned_assignment(self):
        self.assign()
        with self.assertRaises(sqlite3.IntegrityError), self.store.transaction() as db:
            db.execute("INSERT INTO assignments(ip_id,machine_id,started_at) VALUES(1,?,'now')", (self.machine_id,))
        self.store.command('plan', {'ip_id': 2, 'target': 'Planned'})
        with self.assertRaises(sqlite3.IntegrityError), self.store.transaction() as db:
            db.execute("INSERT INTO assignments(ip_id,machine_id,started_at) VALUES(2,?,'now')", (self.machine_id,))

    def test_history_paginates_and_filters(self):
        for number in range(105):
            self.store.command('ip_notes', {'ip_id': 1, 'notes': str(number)})
        first = self.store.history(ip_id=1)
        rest = self.store.history(ip_id=1, before=first[-1]['id'])
        self.assertEqual(len(first), 100)
        self.assertEqual(len(rest), 6)
        self.assertEqual(len({e['id'] for e in first + rest}), 106)

    def test_backup_is_consistent_and_reopenable(self):
        self.assign()
        target = Path(self.temp.name) / 'backup.sqlite3'
        self.store.backup(target)
        self.assertEqual(Store(target).snapshot(), self.store.snapshot())

    def test_unknown_future_schema_rejected(self):
        with self.store.connect() as db:
            db.execute('PRAGMA user_version=99')
        with self.assertRaises(RuntimeError):
            Store(self.path)

    def test_no_observation_command_can_release_ips(self):
        self.assign()
        for action in ('offline', 'scan', 'ping', 'expire'):
            with self.assertRaises(Invalid):
                self.store.command(action, {'ip_id': 1})
        self.assertIsNotNone(Store(self.path).snapshot()['ips'][0]['assignment'])

    def test_required_and_malformed_fields(self):
        for payload in ({}, {'name': ''}, {'name': 'x', 'mac': 'invalid'}, {'name': 12}, {'name': 'x'*201}):
            with self.assertRaises(Invalid):
                self.store.command('create_machine', payload)
        with self.assertRaises(Invalid):
            self.store.command('retire', {'id': self.machine_id, 'reason': ''})


if __name__ == '__main__':
    unittest.main()
