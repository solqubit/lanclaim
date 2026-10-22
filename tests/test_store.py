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
        self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 10)
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

    def find(self, store, name):
        return next((d for d in store.state()['devices'] if d['name'] == name), None)

    def make_v7(self, path):
        from lanclaim.db import MIGRATIONS
        db = sqlite3.connect(path)
        db.executescript(V5_SCHEMA + MIGRATIONS[6] + MIGRATIONS[7] + """
            INSERT INTO devices(id, name, name_key, type, os, note, platform, host_id, created_at) VALUES
              (1, 'Vates Mini PC', 'vates mini pc', 'fisica', '', '', 'Vates XCP-ng', NULL, 't'),
              (2, 'Nagios XI', 'nagios xi', 'vm', 'Centos 9', '', '', 1, 't'),
              (3, 'VMware ESXi', 'vmware esxi', 'fisica', '', '', 'VMware ESXi', NULL, 't'),
              (4, 'windows-dc', 'windows-dc', 'vm', '', '', '', 3, 't'),
              (5, 'nested', 'nested', 'vm', '', '', '', 2, 't'),
              (6, 'GLPI', 'glpi', 'vm', 'Ubuntu 24.04', '', '', NULL, 't');
            INSERT INTO ips(address, sort_key, device_id, note, claimed_at) VALUES
              ('192.168.0.237', 3232235757, 1, '', 't'), ('192.168.0.30', 3232235550, 2, 'nota', 't'),
              ('192.168.0.33', 3232235553, 6, '', 't');
            PRAGMA user_version=7;""")
        db.close()

    def test_schema_7_upgrade_turns_hosts_into_platform_and_machine(self):
        old = Path(self.temp.name) / 'v7.sqlite3'
        self.make_v7(old)
        store = Store(old)
        state = store.state()
        # Real machine kept; its VM stays on it and (since v9) inherits the machine's platform.
        nagios = self.find(store, 'Nagios XI')
        self.assertEqual((nagios['platform'], nagios['host_id']), ('', 1))
        self.assertEqual(self.find(store, 'Vates Mini PC')['platform'], 'Vates XCP-ng')
        # A host that was only a label is no longer a machine; its VM keeps the platform.
        self.assertIsNone(self.find(store, 'VMware ESXi'))
        windows = self.find(store, 'windows-dc')
        self.assertEqual((windows['platform'], windows['host_id']), ('VMware ESXi', None))
        # A VM can only run on a physical machine.
        self.assertIsNone(self.find(store, 'nested')['host_id'])
        # Nothing else changes.
        self.assertEqual(self.find(store, 'GLPI')['platform'], '')
        self.assertEqual([(i['address'], i['note']) for i in state['ips']],
                         [('192.168.0.30', 'nota'), ('192.168.0.33', ''), ('192.168.0.237', '')])
        self.assertIn('VMware ESXi', state['platform_choices'])

    def test_vm_runs_on_a_physical_machine_created_by_name(self):
        vm = self.store.create_device({'name': 'Servidor 1', 'type': 'vm', 'platform': 'VMware Workstation Pro',
                                       'host': {'name': 'Mi PC'}})
        pc = self.device_named('Mi PC')
        self.assertEqual((pc['type'], pc['platform']), ('fisica', 'VMware Workstation Pro'))  # takes the VM's platform
        self.assertEqual(self.device_named('Servidor 1')['host_id'], pc['id'])
        # The same machine by name (any case) is reused, not duplicated.
        self.store.create_device({'name': 'Servidor 2', 'type': 'vm', 'platform': 'VMware Workstation Pro', 'host': {'name': 'mi pc'}})
        self.assertEqual(len(self.store.state()['devices']), 3)
        self.assertEqual(self.store.state()['platform_choices'][0], 'VMware Workstation Pro')
        # By id, and cleared with None.
        self.store.update_device(vm, {'name': 'Servidor 1', 'type': 'vm', 'host': {'id': pc['id']}})
        self.store.update_device(vm, {'name': 'Servidor 1', 'type': 'vm', 'host': None})
        self.assertIsNone(self.device_named('Servidor 1')['host_id'])

    def test_update_without_host_key_keeps_host(self):
        vm = self.store.create_device({'name': 'glpi', 'type': 'vm', 'host': {'name': 'Cubito'}})
        self.store.update_device(vm, {'name': 'glpi', 'type': 'vm', 'os': 'Debian 13'})
        self.assertEqual(self.device_named('glpi')['host_id'], self.device_named('Cubito')['id'])

    def test_only_physical_machines_host_vms(self):
        cubito = self.store.create_device({'name': 'Cubito', 'type': 'fisica', 'platform': 'Vates XCP-ng'})
        vm = self.store.create_device({'name': 'xoa', 'type': 'vm', 'host': {'id': cubito}})
        with self.assertRaises(Invalid):
            self.store.create_device({'name': 'inner', 'type': 'vm', 'host': {'id': vm}})
        # A physical machine never runs on another one.
        other = self.store.create_device({'name': 'nas', 'type': 'fisica', 'host': {'id': cubito}})
        self.assertIsNone(self.find(self.store, 'nas')['host_id'])
        # A machine with VMs inside cannot stop being physical.
        with self.assertRaises(Invalid):
            self.store.update_device(cubito, {'name': 'Cubito', 'type': 'vm'})
        self.store.update_device(other, {'name': 'nas', 'type': 'otro'})  # no VMs inside: fine
        with self.assertRaises(Invalid):
            self.store.create_device({'name': 'x', 'type': 'vm', 'host': {'id': 999}})

    def test_deleting_machine_keeps_its_vms(self):
        pve = self.store.create_device({'name': 'pve', 'type': 'fisica'}, ['192.168.1.10'])
        self.store.create_device({'name': 'glpi', 'type': 'vm', 'platform': 'Proxmox VE', 'host': {'id': pve}}, ['192.168.1.20'])
        self.store.delete_device(pve)
        glpi = self.device_named('glpi')
        self.assertEqual((glpi['host_id'], glpi['platform']), (None, 'Proxmox VE'))
        self.assertEqual(self.ip('192.168.1.20')['device_id'], glpi['id'])

    def test_vm_inherits_platform_from_its_machine(self):
        pc = self.store.create_device({'name': 'PC SOL', 'type': 'fisica', 'platform': 'VMware Workstation Pro'})
        # The VM's own platform is not stored while its machine has one: it is inherited.
        self.store.create_device({'name': 'W10', 'type': 'vm', 'platform': 'Hyper-V', 'host': {'id': pc}})
        self.assertEqual(self.device_named('W10')['platform'], '')
        # Without a machine (or with a machine without platform) the VM keeps its own.
        nas = self.store.create_device({'name': 'nas', 'type': 'fisica'})
        self.store.create_device({'name': 'app', 'type': 'vm', 'platform': 'Docker', 'host': {'id': nas}})
        self.assertEqual(self.device_named('app')['platform'], 'Docker')

    def test_schema_8_upgrade_makes_vms_inherit(self):
        from lanclaim.db import MIGRATIONS
        old = Path(self.temp.name) / 'v8.sqlite3'
        db = sqlite3.connect(old)
        db.executescript(V5_SCHEMA + MIGRATIONS[6] + MIGRATIONS[7] + MIGRATIONS[8] + """
            INSERT INTO devices(id, name, name_key, type, os, note, platform, host_id, created_at) VALUES
              (1, 'PC SOL', 'pc sol', 'fisica', 'Windows 11', '', 'VMware Workstation Pro', NULL, 't'),
              (2, 'W10', 'w10', 'vm', 'Windows 10', '', 'VMware Workstation Pro', 1, 't'),
              (3, 'nas', 'nas', 'fisica', '', '', '', NULL, 't'),
              (4, 'app', 'app', 'vm', '', '', 'Docker', 3, 't'),
              (5, 'loose', 'loose', 'vm', '', '', 'VMware ESXi', NULL, 't');
            INSERT INTO ips(address, sort_key, device_id, note, claimed_at) VALUES ('192.168.0.34', 3232235554, 2, '', 't');
            PRAGMA user_version=8;""")
        db.close()
        store = Store(old)
        self.assertEqual(self.find(store, 'W10')['platform'], '')
        self.assertEqual(self.find(store, 'app')['platform'], 'Docker')
        self.assertEqual(self.find(store, 'loose')['platform'], 'VMware ESXi')
        self.assertEqual(self.find(store, 'PC SOL')['dhcp'], False)
        self.assertEqual(store.state()['ips'][0]['device_id'], 2)

    def test_dhcp_device_holds_no_ips(self):
        pc = self.store.create_device({'name': 'PC SOL', 'type': 'fisica', 'dhcp': True}, ['192.168.0.50'])
        self.assertTrue(self.device_named('PC SOL')['dhcp'])
        self.assertIsNone(self.ip('192.168.0.50')['device_id'])  # claimed, but not tied to a DHCP device
        vm = self.store.create_device({'name': 'W10', 'type': 'vm'}, ['192.168.0.34'])
        # Switching an existing device to DHCP releases its IPs back to reserved.
        self.store.update_device(vm, {'name': 'W10', 'type': 'vm', 'dhcp': True}, add=['192.168.0.35'])
        self.assertIsNone(self.ip('192.168.0.34')['device_id'])
        self.assertIsNone(self.ip('192.168.0.35'))
        self.store.update_device(vm, {'name': 'W10', 'type': 'vm', 'dhcp': False}, add=['192.168.0.34'])
        self.assertEqual(self.ip('192.168.0.34')['device_id'], vm)
        # Assigning an IP from the map to a DHCP device is refused.
        with self.assertRaises(Invalid):
            self.store.claim(['192.168.0.60'], {'id': pc})

    def test_rename_labels_everywhere(self):
        self.store.create_device({'name': 'a', 'type': 'vm', 'os': 'Centos 9', 'platform': 'vates'})
        self.store.create_device({'name': 'b', 'type': 'vm', 'os': 'centos 9', 'platform': 'Vates'})
        self.store.rename_os('CENTOS 9', 'CentOS Stream 9')
        self.store.rename_platform('vates', 'Vates XCP-ng')
        devices = self.store.state()['devices']
        self.assertEqual({d['os'] for d in devices}, {'CentOS Stream 9'})
        self.assertEqual({d['platform'] for d in devices}, {'Vates XCP-ng'})
        state = self.store.state()
        self.assertIn('CentOS Stream 9', state['os_choices'])
        self.assertNotIn('Centos 9', state['os_choices'])
        self.assertEqual(state['platform_choices'].count('Vates XCP-ng'), 1)  # merged with the existing default
        for bad in ('', ' ', 'x' * 121):
            with self.subTest(bad=bad), self.assertRaises(Invalid):
                self.store.rename_os('CentOS Stream 9', bad)

    def test_platform_choices_remembered_and_forgotten(self):
        self.store.create_device({'name': 'xoa', 'type': 'vm', 'platform': 'Vates XCP-ng'})
        self.store.create_device({'name': 'mine', 'type': 'vm', 'platform': 'Mi plataforma'})
        choices = self.store.state()['platform_choices']
        self.assertEqual(choices[:2], ['Mi plataforma', 'Vates XCP-ng'])
        for default in ('Proxmox VE', 'VMware ESXi', 'Nutanix AHV', 'Hyper-V', 'Local host'):
            self.assertIn(default, choices)
        self.store.forget_platform('mi plataforma')
        self.assertNotIn('Mi plataforma', self.store.state()['platform_choices'])
        with self.assertRaises(Invalid):
            self.store.create_device({'name': 'y', 'type': 'vm', 'platform': 'p' * 61})

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
