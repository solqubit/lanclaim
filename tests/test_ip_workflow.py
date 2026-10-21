import concurrent.futures
import tempfile
import unittest
from pathlib import Path

from lanclaim.db import Invalid, Store


class IpWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / 'db.sqlite3')

    def tearDown(self):
        self.temp.cleanup()

    def save(self, **overrides):
        return self.store.command('save_ip_machine', {
            'address': '192.0.2.10', 'mode': 'create', 'assignment_id': None,
            'machine': {'name': 'NAS', 'os': 'Debian'}, **overrides,
        })

    def test_new_ip_and_machine_saved_together(self):
        result = self.save()
        state = Store(self.store.path).snapshot()
        self.assertEqual(state['counts']['claimed'], 1)
        self.assertEqual(state['counts']['assigned'], 1)
        self.assertEqual(state['ips'][0]['assignment']['machine_id'], result['machine_id'])
        self.assertEqual(state['machines'][0]['name'], 'NAS')
        self.assertEqual({r['kind'] for r in self.store.history()}, {'claimed', 'machine_created', 'assigned'})

    def test_invalid_machine_rolls_back_claim_and_events(self):
        with self.assertRaises(Invalid):
            self.save(machine={'name': 'NAS', 'mac': 'bad'})
        self.assertEqual(self.store.snapshot()['ips'], [])
        self.assertEqual(self.store.snapshot()['machines'], [])
        self.assertEqual(self.store.history(), [])

    def test_conflict_does_not_leave_orphan_machine(self):
        self.store.command('claim', {'addresses': '192.0.2.10'})
        self.store.command('review', {'ip_id': 1, 'reason': 'Check identity'})
        before, events = self.store.snapshot(), self.store.history()
        with self.assertRaises(Invalid):
            self.save()
        self.assertEqual(self.store.snapshot(), before)
        self.assertEqual(self.store.history(), events)

    def test_existing_machine_and_plan(self):
        ident = self.store.command('create_machine', {'name': 'Existing'})['id']
        self.store.command('claim', {'addresses': '192.0.2.10'})
        self.store.command('plan', {'ip_id': 1, 'target': 'Future server'})
        with self.assertRaises(Invalid):
            self.save(mode='existing', machine_id=ident)
        result = self.save(mode='existing', machine_id=ident, plan_id=1)
        self.assertEqual(result['machine_id'], ident)
        state = self.store.snapshot()
        self.assertEqual(len(state['machines']), 1)
        self.assertEqual(state['plans'][0]['status'], 'executed')

    def test_replace_only_this_ip_and_keep_history(self):
        first = self.save()
        self.save(address='192.0.2.11', mode='existing', machine_id=first['machine_id'])
        active = self.store.snapshot()['ips'][0]['assignment']['id']
        second = self.save(assignment_id=active, machine={'name': 'Replacement'}, reason='Repurpose address')
        state = self.store.snapshot()
        self.assertEqual(state['ips'][0]['assignment']['machine_id'], second['machine_id'])
        self.assertEqual(state['ips'][1]['assignment']['machine_id'], first['machine_id'])
        self.assertEqual(state['machines'][0]['lifecycle'], 'active')
        ended = [a for a in state['assignments'] if a['ended_at']]
        self.assertEqual(len(ended), 1)
        self.assertEqual(ended[0]['end_reason'], 'Repurpose address')

    def test_stale_or_missing_assignment_and_failed_replacement_are_atomic(self):
        self.save()
        before = self.store.snapshot()
        for payload in ({}, {'assignment_id': 999}, {'assignment_id': 1},
                        {'assignment_id': 1, 'mode': 'existing', 'machine_id': 999, 'reason': 'Change'}):
            with self.assertRaises(Invalid):
                self.save(**payload)
            self.assertEqual(before, self.store.snapshot())
        with self.assertRaises(Invalid):
            self.store.command('save_ip_machine', {'address': '192.0.2.10', 'mode': 'create'})

    def test_edit_during_reinstall_preserves_identity_and_assignment(self):
        result = self.save()
        self.store.command('reinstall', {'id': result['machine_id'], 'reason': 'Fresh OS'})
        before = self.store.snapshot()['assignments']
        self.save(mode='edit', assignment_id=1, machine={'name': 'NAS', 'os': 'Ubuntu'})
        state = self.store.snapshot()
        self.assertEqual(state['machines'][0]['id'], result['machine_id'])
        self.assertEqual(state['machines'][0]['os'], 'Ubuntu')
        self.assertEqual(state['machines'][0]['lifecycle'], 'reinstalling')
        self.assertEqual(state['assignments'], before)

    def test_concurrent_save_creates_exactly_one_machine(self):
        def attempt(number):
            try:
                self.save(machine={'name': str(number)})
                return True
            except Invalid:
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            self.assertEqual(sum(pool.map(attempt, range(6))), 1)
        self.assertEqual(len(self.store.snapshot()['machines']), 1)
