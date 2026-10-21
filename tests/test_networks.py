import json
import subprocess
import unittest
from unittest.mock import patch

from lanclaim.networks import local_networks


class NetworkTests(unittest.TestCase):
    @patch('lanclaim.networks.platform.system', return_value='Linux')
    @patch('lanclaim.networks.subprocess.run')
    def test_linux_interfaces_without_scanning(self, run, _system):
        run.return_value.stdout = json.dumps([
            {'ifname': 'lo', 'addr_info': [{'family': 'inet', 'local': '127.0.0.1', 'prefixlen': 8}]},
            {'ifname': 'eth0', 'addr_info': [{'family': 'inet', 'local': '192.168.50.20', 'prefixlen': 24}]}
        ])
        self.assertEqual(local_networks(), [{'cidr': '192.168.50.0/24', 'interface': 'eth0', 'address': '192.168.50.20', 'size': 256}])
        self.assertEqual(run.call_args.args[0], ['ip', '-j', '-4', 'address', 'show'])

    @patch('lanclaim.networks.platform.system', return_value='Windows')
    @patch('lanclaim.networks.subprocess.run')
    def test_windows_single_interface_json(self, run, _system):
        run.return_value.stdout = json.dumps({'IPAddress': '10.0.1.4', 'PrefixLength': 24, 'InterfaceAlias': 'Ethernet'})
        self.assertEqual(local_networks()[0]['cidr'], '10.0.1.0/24')

    @patch('lanclaim.networks.subprocess.run', side_effect=FileNotFoundError)
    def test_no_ip_command_allows_manual_network(self, _run):
        self.assertEqual(local_networks(), [])

    @patch('lanclaim.networks.subprocess.run', side_effect=subprocess.TimeoutExpired('ip', 3))
    def test_detection_timeout_does_not_block_app(self, _run):
        self.assertEqual(local_networks(), [])
