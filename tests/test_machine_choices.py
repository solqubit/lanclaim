import tempfile
import unittest
from pathlib import Path

from lanclaim.db import Invalid, Store


class MachineChoicesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / 'test.sqlite3')

    def test_choices_survive_edit_restart_and_ignore_case_duplicates(self):
        m = self.store.command('create_machine', {'name': 'NAS', 'os': 'Debian', 'platform': 'Proxmox'})
        self.store.command('edit_machine', {'id': m['id'], 'os': 'Ubuntu', 'platform': 'proxmox'})
        choices = Store(self.store.path).snapshot()['machine_choices']
        self.assertEqual(choices['os'], ['Debian', 'Ubuntu'])
        self.assertEqual(choices['platform'], ['Proxmox'])

    def test_partial_edit_preserves_fields_removed_from_form(self):
        m = self.store.command('create_machine', {'name': 'NAS', 'hostname': 'nas.local', 'vm_id': '101', 'os': 'Debian'})
        self.store.command('claim', {'addresses': '192.0.2.10'})
        self.store.command('assign', {'ip_id': 1, 'machine_id': m['id']})
        assignment = self.store.snapshot()['ips'][0]['assignment']['id']
        self.store.command('save_ip_machine', {'address': '192.0.2.10', 'assignment_id': assignment,
                           'mode': 'edit', 'machine': {'name': 'NAS 2', 'os': 'Ubuntu', 'platform': 'KVM', 'notes': 'Storage'}})
        saved = self.store.snapshot()['machines'][0]
        self.assertEqual((saved['hostname'], saved['vm_id']), ('nas.local', '101'))
        self.assertEqual(saved['name'], 'NAS 2')

    def test_failed_assignment_rolls_back_new_choices(self):
        self.store.command('claim', {'addresses': '192.0.2.10'})
        self.store.command('review', {'ip_id': 1, 'reason': 'Check owner'})
        with self.assertRaises(Invalid):
            self.store.command('save_ip_machine', {'address': '192.0.2.10', 'assignment_id': None,
                               'mode': 'create', 'machine': {'name': 'Blocked', 'os': 'New OS', 'platform': 'New platform'}})
        self.assertEqual(self.store.snapshot()['machine_choices'], {'os': [], 'platform': []})

    def test_schema_two_migration_seeds_existing_values(self):
        self.store.command('create_machine', {'name': 'Legacy', 'os': 'Debian', 'platform': 'KVM'})
        with self.store.transaction() as db:
            db.execute('DROP TABLE machine_choices')
            db.execute('PRAGMA user_version=2')
        reopened = Store(self.store.path)
        self.assertEqual(reopened.snapshot()['machine_choices'], {'os': ['Debian'], 'platform': ['KVM']})
        self.assertEqual(Store(self.store.path).snapshot()['machines'][0]['name'], 'Legacy')
