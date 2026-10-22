import sqlite3
import tempfile
import unittest
from pathlib import Path

from lanclaim.db import Invalid, Store, parse_addresses

V5_SCHEMA = """
CREATE TABLE networks (id INTEGER PRIMARY KEY, cidr TEXT NOT NULL UNIQUE, sort_key INTEGER NOT NULL,
 name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE devices (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
 type TEXT NOT NULL CHECK(type IN ('vm','fisica','contenedor','otro')),
 os TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE ips (id INTEGER PRIMARY KEY, address TEXT NOT NULL UNIQUE, sort_key INTEGER NOT NULL,
 device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL, note TEXT NOT NULL DEFAULT '', claimed_at TEXT NOT NULL);
CREATE INDEX ips_device ON ips(device_id);
CREATE TABLE observations (address TEXT PRIMARY KEY, up INTEGER NOT NULL, checked_at TEXT NOT NULL, last_up_at TEXT);
"""
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
        state = store.state()
        self.assertEqual({k: state[k] for k in ('networks', 'ips', 'devices', 'observations', 'os_choices')},
                         {'networks': [], 'ips': [], 'devices': [], 'observations': {}, 'os_choices': []})
        db = sqlite3.connect(old)
        self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 7)
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        db.close()
        self.assertNotIn('machines', tables)

    def test_schema_5_upgrade_keeps_data_and_seeds_os_choices(self):
        old = Path(self.temp.name) / 'v5.sqlite3'
        db = sqlite3.connect(old)
        db.executescript(V5_SCHEMA + """
            INSERT INTO devices(name, name_key, type, os, note, created_at) VALUES('glpi','glpi','vm','Debian 12','','t');
            INSERT INTO devices(name, name_key, type, os, note, created_at) VALUES('nas','nas','fisica','','','t');
            INSERT INTO ips(address, sort_key, device_id, note, claimed_at) VALUES('192.168.1.10', 3232235786, 1, '', 't');
            PRAGMA user_version=5;""")
        db.close()
        state = Store(old).state()
        self.assertEqual([d['name'] for d in state['devices']], ['glpi', 'nas'])
        self.assertEqual(state['ips'][0]['device_id'], 1)
        self.assertEqual(state['os_choices'], ['Debian 12'])
        self.assertEqual([(d['host_id'], d['platform']) for d in state['devices']], [(None, ''), (None, '')])

    def test_schema_6_upgrade_keeps_data_and_adds_hosts(self):
        old = Path(self.temp.name) / 'v6.sqlite3'
        db = sqlite3.connect(old)
        db.executescript(V5_SCHEMA + """
            CREATE TABLE os_choices (name TEXT NOT NULL, name_key TEXT PRIMARY KEY, used_at TEXT NOT NULL);
            INSERT INTO devices(name, name_key, type, os, note, created_at) VALUES('glpi','glpi','vm','Debian 13','','t');
            INSERT INTO ips(address, sort_key, device_id, note, claimed_at) VALUES('192.168.1.20', 3232235796, 1, 'nota', 't');
            INSERT INTO os_choices VALUES('Debian 13', 'debian 13', 't');
            PRAGMA user_version=6;""")
        db.close()
        store = Store(old)
        state = store.state()
        self.assertEqual(state['devices'][0]['name'], 'glpi')
        self.assertEqual(state['ips'][0]['note'], 'nota')
        self.assertEqual(state['os_choices'], ['Debian 13'])
        self.assertIn('Proxmox VE', state['platform_choices'])
        store.update_device(1, {'name': 'glpi', 'type': 'vm', 'host': {'name': 'proxmox-01', 'platform': 'Proxmox VE'}})
        self.assertEqual(self.find(store, 'glpi')['host_id'], self.find(store, 'proxmox-01')['id'])

    def find(self, store, name):
        return next(d for d in store.state()['devices'] if d['name'] == name)

    def test_host_by_name_is_created_with_platform(self):
        vm = self.store.create_device({'name': 'glpi', 'type': 'vm', 'host': {'name': 'cluster-vmware', 'platform': 'VMware ESXi'}})
        host = self.device_named('cluster-vmware')
        self.assertEqual((host['type'], host['platform']), ('fisica', 'VMware ESXi'))
        self.assertEqual(self.device_named('glpi')['host_id'], host['id'])
        # Reusing the host by name (any case) neither duplicates it nor changes its platform.
        self.store.create_device({'name': 'jellyfin', 'type': 'vm', 'host': {'name': 'CLUSTER-VMWARE', 'platform': 'Hyper-V'}})
        self.assertEqual(len(self.store.state()['devices']), 3)
        self.assertEqual(self.device_named('cluster-vmware')['platform'], 'VMware ESXi')
        self.assertEqual(self.store.state()['platform_choices'][0], 'VMware ESXi')
        # By id, and cleared with None.
        self.store.update_device(vm, {'name': 'glpi', 'type': 'vm', 'host': {'id': host['id']}})
        self.store.update_device(vm, {'name': 'glpi', 'type': 'vm', 'host': None})
        self.assertIsNone(self.device_named('glpi')['host_id'])

    def test_host_named_like_a_platform_gets_that_platform(self):
        # "VMware ESXi" as the host name: no need to type the platform again.
        self.store.create_device({'name': 'glpi', 'type': 'vm', 'host': {'name': 'vmware esxi'}})
        host = self.device_named('vmware esxi')
        self.assertEqual(host['platform'], 'VMware ESXi')
        # Any other name is the user's own label: it is saved so it can be reused (and removed) later.
        self.store.create_device({'name': 'pihole', 'type': 'contenedor', 'host': {'name': 'Mi cluster'}})
        self.assertEqual(self.device_named('Mi cluster')['platform'], 'Mi cluster')
        self.assertEqual(self.store.state()['platform_choices'][0], 'Mi cluster')

    def test_update_without_host_key_keeps_host(self):
        vm = self.store.create_device({'name': 'glpi', 'type': 'vm', 'host': {'name': 'pve'}})
        self.store.update_device(vm, {'name': 'glpi', 'type': 'vm', 'os': 'Debian 13'})
        self.assertEqual(self.device_named('glpi')['host_id'], self.device_named('pve')['id'])

    def test_host_cycles_are_rejected(self):
        pve = self.store.create_device({'name': 'pve', 'type': 'fisica', 'platform': 'Proxmox VE'})
        vm = self.store.create_device({'name': 'nested', 'type': 'vm', 'host': {'id': pve}})
        inner = self.store.create_device({'name': 'inner', 'type': 'vm', 'host': {'id': vm}})
        for device_id, name, host in ((pve, 'pve', pve), (pve, 'pve', inner), (vm, 'nested', inner)):
            with self.subTest(device=name, host=host), self.assertRaises(Invalid):
                self.store.update_device(device_id, {'name': name, 'type': 'vm', 'host': {'id': host}})
        with self.assertRaises(Invalid):
            self.store.create_device({'name': 'x', 'type': 'vm', 'host': {'id': 999}})

    def test_deleting_host_keeps_its_guests(self):
        pve = self.store.create_device({'name': 'pve', 'type': 'fisica'}, ['192.168.1.10'])
        self.store.create_device({'name': 'glpi', 'type': 'vm', 'host': {'id': pve}}, ['192.168.1.20'])
        self.store.delete_device(pve)
        glpi = self.device_named('glpi')
        self.assertIsNone(glpi['host_id'])
        self.assertEqual(self.ip('192.168.1.20')['device_id'], glpi['id'])

    def test_platform_choices_remembered_and_forgotten(self):
        self.store.create_device({'name': 'xcp', 'type': 'fisica', 'platform': 'Vates XCP-ng'})
        self.store.create_device({'name': 'mine', 'type': 'fisica', 'platform': 'Mi plataforma'})
        choices = self.store.state()['platform_choices']
        self.assertEqual(choices[:2], ['Mi plataforma', 'Vates XCP-ng'])
        for default in ('Proxmox VE', 'VMware ESXi', 'Nutanix AHV', 'Hyper-V', 'Local host'):
            self.assertIn(default, choices)
        self.store.forget_platform('mi plataforma')
        self.assertNotIn('Mi plataforma', self.store.state()['platform_choices'])
        with self.assertRaises(Invalid):
            self.store.create_device({'name': 'y', 'type': 'fisica', 'platform': 'p' * 61})

    def test_os_choices_are_remembered(self):
        glpi = self.store.create_device({'name': 'glpi', 'type': 'vm', 'os': 'Debian 12'})
        self.store.create_device({'name': 'k3s', 'type': 'vm', 'os': 'Ubuntu 24.04'})
        self.assertEqual(self.store.state()['os_choices'], ['Ubuntu 24.04', 'Debian 12'])  # most recent first
        self.store.update_device(glpi, {'name': 'glpi', 'type': 'vm', 'os': 'debian 12'})
        self.assertEqual(self.store.state()['os_choices'], ['debian 12', 'Ubuntu 24.04'])  # one entry, latest spelling
        self.store.delete_device(glpi)
        self.assertIn('debian 12', self.store.state()['os_choices'])  # survives the device
        self.store.update_device(self.device_named('k3s')['id'], {'name': 'k3s', 'type': 'vm', 'os': ''})
        self.assertEqual(len(self.store.state()['os_choices']), 2)  # empty OS is not a choice

    def test_new_device_from_claim_records_os(self):
        self.store.claim(['192.168.1.30'], {'name': 'pihole', 'type': 'contenedor', 'os': ' Debian 12 '})
        self.assertEqual(self.device_named('pihole')['os'], 'Debian 12')
        self.assertEqual(self.store.state()['os_choices'], ['Debian 12'])
        self.store.claim(['192.168.1.31'], {'name': 'PIHOLE', 'type': 'vm', 'os': 'Windows'})
        self.assertEqual(self.device_named('pihole')['os'], 'Debian 12')  # existing device untouched
        with self.assertRaises(Invalid):
            self.store.claim(['192.168.1.32'], {'name': 'x', 'type': 'vm', 'os': 'y' * 121})

    def test_forget_os_choice(self):
        self.store.create_device({'name': 'glpi', 'type': 'vm', 'os': 'Debian 12'})
        self.store.forget_os('DEBIAN 12')
        self.assertEqual(self.store.state()['os_choices'], [])
        self.assertEqual(self.device_named('glpi')['os'], 'Debian 12')  # the device keeps its OS
        self.store.forget_os('nada')  # forgetting an unknown value is harmless

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
