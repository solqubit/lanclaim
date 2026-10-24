#!/usr/bin/env bash
# Runs only inside the disposable test image; never run this on a real host.
set -Eeuo pipefail
[[ -f /.dockerenv ]] || { echo 'Run inside tests/linux/Dockerfile only.' >&2; exit 1; }
bash install.sh
bash install.sh
python3 - <<'PY'
import json, time, urllib.request
from pathlib import Path
base = 'http://127.0.0.1:8080/api/'
state = json.load(urllib.request.urlopen(base + 'state'))
def post(path, data):
    request = urllib.request.Request(base + path, json.dumps(data).encode(),
        {'Content-Type': 'application/json', 'X-CSRF-Token': state['csrf']})
    return json.load(urllib.request.urlopen(request))
post('ips/claim', {'addresses': '10.20.30.10-10.20.30.12'})
post('devices/create', {'name': 'Lifecycle test', 'type': 'vm', 'os': 'Debian 12', 'addresses': ['10.20.30.10']})
pid = Path('/tmp/lanclaim-test.pid').read_text().strip()
process = dict(line.split(':', 1) for line in Path(f'/proc/{pid}/status').read_text().splitlines() if ':' in line)
assert int(process['Uid'].split()[0]) != 0
assert int(process['NoNewPrivs']) == 1
assert int(process['CapEff'], 16) == 0x2000  # Only CAP_NET_RAW.
assert int(process['CapBnd'], 16) == 0x2000
# Adding a network pings it right away with the real ping binary as the service user (loopback only).
post('networks/add', {'cidr': '127.0.0.0/30', 'name': 'Loopback'})
for _ in range(50):
    result = json.load(urllib.request.urlopen(base + 'state'))
    if not result['scan']['running'] and '127.0.0.1' in result['observations']:
        break
    time.sleep(0.2)
assert result['scan']['error'] == '', result['scan']
assert result['observations']['127.0.0.1']['up'] is True, result
PY
# An update must repair existing installations whose unit predates ICMP grants.
sed -i '/^CapabilityBoundingSet=/d; /^AmbientCapabilities=/d' /etc/systemd/system/lanclaim.service
# Mimic a previous schema. The backup must retain v10, not trigger v11's migration.
systemctl stop lanclaim
python3 - <<'PY'
import sqlite3
db = sqlite3.connect('/var/lib/lanclaim/lanclaim.sqlite3')
db.execute('DROP TABLE identity_counters')
db.execute('PRAGMA user_version=10')
db.commit()
db.close()
PY
bash update.sh
python3 - <<'PY'
import sqlite3
from pathlib import Path
from lanclaim.db import Store
s = Store('/var/lib/lanclaim/lanclaim.sqlite3').state()
assert len(s['ips']) == 3 and s['devices'][0]['name'] == 'Lifecycle test'
assert [i['address'] for i in s['ips'] if i['device_id']] == ['10.20.30.10']
backup = max(Path('/var/lib/lanclaim/backups').glob('before-*.sqlite3'), key=lambda p: p.stat().st_mtime_ns)
db = sqlite3.connect(backup)
assert db.execute('PRAGMA user_version').fetchone()[0] == 10
assert db.execute('SELECT name FROM devices').fetchone()[0] == 'Lifecycle test'
assert db.execute("SELECT count(*) FROM sqlite_master WHERE name='identity_counters'").fetchone()[0] == 0
db.close()
PY
# Simulate a release that commits incompatible data and then fails at startup.
cp lanclaim/server.py /tmp/server-original.py
python3 - <<'PY'
from pathlib import Path
p = Path('lanclaim/server.py')
s = p.read_text()
needle = "    store = Store(Path(args.data_dir) / 'lanclaim.sqlite3')\n"
assert needle in s
s = s.replace(needle, needle + "    with store.transaction() as db:\n        db.execute(\"UPDATE devices SET name='BROKEN'\")\n        db.execute('PRAGMA user_version=12')\n    raise RuntimeError('simulated failed migration')\n", 1)
p.write_text(s)
PY
if bash update.sh; then echo 'Expected update failure' >&2; exit 1; fi
cp /tmp/server-original.py lanclaim/server.py
python3 - <<'PY'
import json, urllib.request
s = json.load(urllib.request.urlopen('http://127.0.0.1:8080/api/state'))
assert s['devices'][0]['name'] == 'Lifecycle test', s
assert len(s['ips']) == 3
PY
bash uninstall.sh
test -f /var/lib/lanclaim/lanclaim.sqlite3
test ! -e /opt/lanclaim
test ! -e /etc/systemd/system/lanclaim.service
bash install.sh
grep -q '^LANCLAIM_SCAN_INTERVAL=300$' /etc/lanclaim/lanclaim.env
python3 - <<'PY'
import json, urllib.request
base = 'http://127.0.0.1:8080/api/'
state = json.load(urllib.request.urlopen(base + 'state'))
assert len(state['ips']) == 3 and state['devices'][0]['name'] == 'Lifecycle test'
# Deleting a device keeps its IPs claimed as reserved.
device = state['devices'][0]
request = urllib.request.Request(base + 'devices/delete', json.dumps({'id': device['id'], 'created_at': device['created_at']}).encode(),
    {'Content-Type': 'application/json', 'X-CSRF-Token': state['csrf']})
after = json.load(urllib.request.urlopen(request))
assert after['devices'] == [] and len(after['ips']) == 3
assert all(i['device_id'] is None for i in after['ips'])
PY
if printf 'CANCELAR\n' | bash uninstall.sh --purge; then echo 'Purge cancellation failed' >&2; exit 1; fi
test -f /var/lib/lanclaim/lanclaim.sqlite3
printf 'PURGAR\n' | bash uninstall.sh --purge
test ! -e /opt/lanclaim
test ! -e /var/lib/lanclaim
test ! -e /etc/lanclaim
test ! -e /etc/systemd/system/lanclaim.service
if getent passwd lanclaim; then echo 'Service user survived purge' >&2; exit 1; fi
test -x /usr/bin/python3
echo 'PASS: install, idempotence, scan, update, failed-release rollback, uninstall, reinstall, delete device, cancel purge, purge.'
