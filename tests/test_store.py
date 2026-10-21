import sqlite3
import tempfile
import unittest
from pathlib import Path

from lanclaim.db import Invalid, Store, parse_addresses

T1 = '2026-10-21T10:00:00.000000+00:00'
T2 = '2026-10-21T10:05:00.000000+00:00'


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'lanclaim.sqlite3'
        self.store = Store(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def ip(self, address):
        return next((i for i in self.store.state()['ips'] if i['address'] == address), None)

    def device_named(self, name):
        return next(d for d in self.store.state()['devices'] if d['name'] == name)

    def test_discards_old_schema(self):
        old = Path(self.temp.name) / 'old.sqlite3'
        db = sqlite3.connect(old)
        db.executescript("CREATE TABLE ips(x); CREATE TABLE machines(y); INSERT INTO ips VALUES (1); PRAGMA user_version=4;")
        db.close()
        store = Store(old)
        self.assertEqual(store.state(), {'networks': [], 'ips': [], 'devices': [], 'observations': {}})
        db = sqlite3.connect(old)
        self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 5)
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        db.close()
        self.assertNotIn('machines', tables)

    def test_reopening_keeps_data(self):
        self.store.claim(['192.168.1.10'])
        self.assertEqual(len(Store(self.path).state()['ips']), 1)

    def test_parse_addresses(self):
        self.assertEqual(parse_addresses('192.168.1.10-12, 192.168.1.10'),
                         ['192.168.1.10', '192.168.1.11', '192.168.1.12'])
        self.assertEqual(parse_addresses('192.168.1.10 - 192.168.1.11'), ['192.168.1.10', '192.168.1.11'])
        self.assertEqual(parse_addresses('10.0.0.0/30'), ['10.0.0.1', '10.0.0.2'])
        self.assertEqual(parse_addresses(['192.168.1.2', ' 192.168.1.1 ']), ['192.168.1.1', '192.168.1.2'])
        self.assertEqual(parse_addresses('192.168.1.9-192.168.1.10'), ['192.168.1.9', '192.168.1.10'])
        for bad in ('fe80::1', '224.0.0.1', '192.168.1.043', '0.0.0.0', '255.255.255.255',
                    '10.0.0.0-10.0.16.0', '', 'hola', '192.168.1.12-10'):
            with self.subTest(bad=bad), self.assertRaises(Invalid):
                parse_addresses(bad)

    def test_networks_validation(self):
        self.store.add_network('192.168.1.0/24', 'Casa')
        self.store.add_network('10.0.0.0/22')
        nets = self.store.state()['networks']
        self.assertEqual([(n['cidr'], n['name']) for n in nets], [('10.0.0.0/22', ''), ('192.168.1.0/24', 'Casa')])
        for bad in ('172.16.0.0/21', '172.16.0.0/31', 'fd00::/120', '192.168.0.0/22', '192.168.1.0/24',
                    '192.168.1.128/25', 'nada'):
            with self.subTest(bad=bad), self.assertRaises(Invalid):
                self.store.add_network(bad)
        self.store.add_network('172.16.0.5/24')  # normalised, not strict
        self.assertIn('172.16.0.0/24', [n['cidr'] for n in self.store.state()['networks']])

    def test_watched_limit(self):
        for third in (0, 4, 8, 12):
            self.store.add_network(f'10.1.{third}.0/22')
        with self.assertRaises(Invalid):
            self.store.add_network('10.2.0.0/30')

    def test_rename_and_remove_network(self):
        nid = self.store.add_network('192.168.1.0/24')
        self.store.rename_network(nid, 'Lab')
        self.assertEqual(self.store.state()['networks'][0]['name'], 'Lab')
        self.store.remove_network(nid)
        self.assertEqual(self.store.state()['networks'], [])
        with self.assertRaises(Invalid):
            self.store.remove_network(nid)

    def test_claim_is_idempotent_and_reassigns(self):
        self.assertEqual(self.store.claim(['192.168.1.10']), {'claimed': 1, 'assigned': 0})
        self.assertEqual(self.store.claim('192.168.1.10'), {'claimed': 0, 'assigned': 0})
        self.assertEqual(len(self.store.state()['ips']), 1)
        result = self.store.claim(['192.168.1.10'], {'name': 'GLPI', 'type': 'vm'})
        self.assertEqual(result, {'claimed': 0, 'assigned': 1})
        glpi = self.device_named('GLPI')
        self.assertEqual(glpi['type'], 'vm')
        self.store.claim(['192.168.1.11'], {'name': 'glpi', 'type': 'otro'})
        self.assertEqual(len(self.store.state()['devices']), 1)
        self.assertEqual(self.ip('192.168.1.11')['device_id'], glpi['id'])
        nas = self.store.create_device({'name': 'nas', 'type': 'fisica'})
        self.store.claim(['192.168.1.10', '192.168.1.12'], {'id': nas})
        self.assertEqual(self.ip('192.168.1.10')['device_id'], nas)
        self.assertEqual(self.ip('192.168.1.12')['device_id'], nas)
        with self.assertRaises(Invalid):
            self.store.claim(['192.168.1.13'], {'id': 999})
        self.assertIsNone(self.ip('192.168.1.13'))

    def test_release_unassign_note(self):
        self.store.claim(['192.168.1.10', '192.168.1.11'], {'name': 'glpi', 'type': 'vm'})
        self.store.unassign(['192.168.1.10'])
        self.assertIsNone(self.ip('192.168.1.10')['device_id'])
        self.store.set_note('192.168.1.10', '  Para Jellyfin ')
        self.assertEqual(self.ip('192.168.1.10')['note'], 'Para Jellyfin')
        self.store.release(['192.168.1.11'])
        self.assertIsNone(self.ip('192.168.1.11'))
        self.assertEqual(len(self.store.state()['devices']), 1)
        with self.assertRaises(Invalid):
            self.store.release(['192.168.1.99'])
        with self.assertRaises(Invalid):
            self.store.set_note('192.168.1.99', 'x')
        with self.assertRaises(Invalid):
            self.store.set_note('192.168.1.10', 'x' * 2001)

    def test_create_device_with_addresses(self):
        self.store.claim(['192.168.1.20'], {'name': 'old', 'type': 'vm'})
        did = self.store.create_device({'name': 'pihole', 'type': 'contenedor', 'os': 'Debian 12', 'note': 'DNS'},
                                       ['192.168.1.20', '192.168.1.21'])
        dev = self.device_named('pihole')
        self.assertEqual((dev['id'], dev['type'], dev['os'], dev['note']), (did, 'contenedor', 'Debian 12', 'DNS'))
        self.assertEqual(self.ip('192.168.1.20')['device_id'], did)
        self.assertEqual(self.ip('192.168.1.21')['device_id'], did)

    def test_update_device_manages_ips(self):
        did = self.store.create_device({'name': 'k3s', 'type': 'vm'}, ['192.168.1.10', '192.168.1.11'])
        self.store.update_device(did, {'name': 'k3s-node-1', 'type': 'vm', 'os': 'Ubuntu 24.04', 'note': ''},
                                 add=['192.168.1.12'], remove=['192.168.1.10'])
        self.assertIsNone(self.ip('192.168.1.10')['device_id'])
        self.assertEqual(self.ip('192.168.1.11')['device_id'], did)
        self.assertEqual(self.ip('192.168.1.12')['device_id'], did)
        self.assertEqual(self.device_named('k3s-node-1')['os'], 'Ubuntu 24.04')

    def test_update_device_applies_changes_to_current_rows(self):
        # Two tabs: B changes glpi's IPs while A still has an old form open.
        glpi = self.store.create_device({'name': 'glpi', 'type': 'vm'}, ['192.168.1.10', '192.168.1.11'])
        nas = self.store.create_device({'name': 'nas', 'type': 'fisica'})
        self.store.claim(['192.168.1.12'], {'id': glpi})
        self.store.claim(['192.168.1.10'], {'id': nas})
        self.store.release(['192.168.1.11'])
        # A saves only an OS change: nothing B did is undone.
        self.store.update_device(glpi, {'name': 'glpi', 'type': 'vm', 'os': 'Debian 12'})
        self.assertEqual(self.ip('192.168.1.10')['device_id'], nas)
        self.assertEqual(self.ip('192.168.1.12')['device_id'], glpi)
        self.assertIsNone(self.ip('192.168.1.11'))
        # A removes .10 (already moved by B): it stays with nas. A adds .13: claimed for glpi.
        self.store.update_device(glpi, {'name': 'glpi', 'type': 'vm'}, add=['192.168.1.13'], remove=['192.168.1.10'])
        self.assertEqual(self.ip('192.168.1.10')['device_id'], nas)
        self.assertEqual(self.ip('192.168.1.13')['device_id'], glpi)
        self.store.update_device(glpi, {'name': 'glpi', 'type': 'vm'}, remove=['192.168.1.12', '192.168.1.99'])
        self.assertIsNone(self.ip('192.168.1.12')['device_id'])
        self.assertIsNone(self.ip('192.168.1.99'))

    def test_network_edges_cannot_be_claimed(self):
        self.store.add_network('192.168.1.0/24')
        for bad in ('192.168.1.0', '192.168.1.255', '192.168.1.250-255'):
            with self.subTest(bad=bad), self.assertRaises(Invalid):
                self.store.claim(bad)
        with self.assertRaises(Invalid):
            self.store.create_device({'name': 'x', 'type': 'vm'}, ['192.168.1.255'])
        self.assertEqual(self.store.state()['ips'], [])
        # An edge claimed before its network was registered is never pinged.
        self.store.claim('10.0.0.0')
        self.store.add_network('10.0.0.0/30')
        self.assertNotIn('10.0.0.0', self.store.watched_addresses())

    def test_update_device_rejects_bad_address_atomically(self):
        did = self.store.create_device({'name': 'k3s', 'type': 'vm'}, ['192.168.1.10', '192.168.1.11'])
        with self.assertRaises(Invalid):
            self.store.update_device(did, {'name': 'Nuevo', 'type': 'vm'}, add=['fe80::1'], remove=['192.168.1.10'])
        self.assertEqual(self.store.state()['devices'][0]['name'], 'k3s')
        self.assertEqual(self.ip('192.168.1.10')['device_id'], did)
        with self.assertRaises(Invalid):
            self.store.update_device(999, {'name': 'x', 'type': 'vm'})

    def test_device_validation(self):
        self.store.create_device({'name': 'GLPI', 'type': 'vm'})
        other = self.store.create_device({'name': 'nas', 'type': 'fisica'})
        for fields in ({'name': '  ', 'type': 'vm'}, {'name': 'glpi', 'type': 'vm'}, {'name': 'x', 'type': 'servidor'},
                       {'name': 'x' * 121, 'type': 'vm'}, {'name': 'x', 'type': 'vm', 'os': 'y' * 121},
                       {'name': 'x', 'type': 'vm', 'note': 'z' * 2001}, {'name': 5, 'type': 'vm'}):
            with self.subTest(fields=fields), self.assertRaises(Invalid):
                self.store.create_device(fields)
        with self.assertRaises(Invalid):
            self.store.update_device(other, {'name': 'Glpi', 'type': 'fisica'})
        self.store.update_device(other, {'name': 'NAS', 'type': 'fisica'})  # own name, new case
        self.assertEqual(len(self.store.state()['devices']), 2)

    def test_delete_device_keeps_ips_reserved(self):
        did = self.store.create_device({'name': 'glpi', 'type': 'vm'}, ['192.168.1.30'])
        self.store.delete_device(did)
        self.assertEqual(self.store.state()['devices'], [])
        self.assertIsNone(self.ip('192.168.1.30')['device_id'])
        with self.assertRaises(Invalid):
            self.store.delete_device(did)

    def test_remove_network_keeps_claims(self):
        nid = self.store.add_network('192.168.5.0/30')
        self.store.claim(['192.168.5.1', '10.9.9.9'])
        self.assertEqual(self.store.watched_addresses(), ['10.9.9.9', '192.168.5.1', '192.168.5.2'])
        self.store.remove_network(nid)
        self.assertEqual([i['address'] for i in self.store.state()['ips']], ['10.9.9.9', '192.168.5.1'])
        self.assertEqual(self.store.watched_addresses(), ['10.9.9.9', '192.168.5.1'])

    def test_observations_track_last_up(self):
        self.store.add_network('192.168.1.0/30')
        self.store.claim(['192.168.1.1'])
        self.store.record_observations({'192.168.1.1': True, '192.168.1.2': True}, T1)
        self.store.record_observations({'192.168.1.1': False}, T2)
        obs = self.store.state()['observations']
        self.assertEqual(obs['192.168.1.1'], {'up': False, 'checked_at': T2, 'last_up_at': T1})
        self.assertEqual(obs['192.168.1.2'], {'up': True, 'checked_at': T1, 'last_up_at': T1})
        self.assertIsNone(self.ip('192.168.1.1')['device_id'])
        self.assertEqual(len(self.store.state()['ips']), 1)

    def test_state_hides_unwatched_observations(self):
        self.store.record_observations({'8.8.8.8': True}, T1)
        self.assertEqual(self.store.state()['observations'], {})

    def test_ips_sorted_numerically(self):
        self.store.claim(['192.168.1.100', '192.168.1.9', '10.0.0.1'])
        self.assertEqual([i['address'] for i in self.store.state()['ips']], ['10.0.0.1', '192.168.1.9', '192.168.1.100'])


if __name__ == '__main__':
    unittest.main()
