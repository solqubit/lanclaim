"""Read local interface prefixes; never probe hosts or scan a network."""
import ipaddress
import json
import platform
import subprocess


def local_networks():
    networks = []
    try:
        if platform.system() == 'Windows':
            command = ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                       '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-NetIPAddress -AddressFamily IPv4 | Select-Object IPAddress,PrefixLength,InterfaceAlias | ConvertTo-Json -Compress']
            result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8-sig', timeout=8, check=True,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            entries = json.loads(result.stdout or '[]')
            if isinstance(entries, dict):
                entries = [entries]
            candidates = [(r['IPAddress'], r['PrefixLength'], r['InterfaceAlias']) for r in entries]
        else:
            result = subprocess.run(['ip', '-j', '-4', 'address', 'show'], capture_output=True, text=True, timeout=3, check=True)
            candidates = [(a['local'], a['prefixlen'], interface['ifname']) for interface in json.loads(result.stdout)
                          for a in interface.get('addr_info', []) if a.get('family') == 'inet']
        seen = set()
        for address, prefix, interface in candidates:
            ip = ipaddress.ip_address(address)
            if ip.is_loopback or ip.is_link_local:
                continue
            network = ipaddress.ip_network(f'{ip}/{prefix}', strict=False)
            key = (str(network), str(interface))
            if key not in seen:
                networks.append({'cidr': str(network), 'interface': str(interface), 'address': str(ip), 'size': network.num_addresses})
                seen.add(key)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        return []
    return networks
