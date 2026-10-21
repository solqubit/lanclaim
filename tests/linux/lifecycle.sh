#!/usr/bin/env bash
# Runs only inside the disposable test image; never run this on a real host.
set -Eeuo pipefail
[[ -f /.dockerenv ]] || { echo 'Run inside tests/linux/Dockerfile only.' >&2; exit 1; }
bash install.sh
bash install.sh
python3 - <<'PY'
import json, urllib.request
base = 'http://127.0.0.1:8080/api/'
state = json.load(urllib.request.urlopen(base + 'state'))
def command(action, data):
    request = urllib.request.Request(base + 'commands/' + action, json.dumps(data).encode(),
        {'Content-Type': 'application/json', 'X-CSRF-Token': state['csrf']})
    return json.load(urllib.request.urlopen(request))
command('claim', {'addresses': '10.20.30.10-10.20.30.12'})
machine = command('create_machine', {'name': 'Lifecycle test'})
command('assign', {'ip_id': 1, 'machine_id': machine['id']})
command('reinstall', {'id': machine['id'], 'reason': 'Testing preservation'})
# Probe only loopback, using the real ping binary as the service user.
import time
from pathlib import Path
pid = Path('/tmp/lanclaim-test.pid').read_text().strip()
process = dict(line.split(':', 1) for line in Path(f'/proc/{pid}/status').read_text().splitlines() if ':' in line)
assert int(process['Uid'].split()[0]) != 0
assert int(process['NoNewPrivs']) == 1
assert int(process['CapEff'], 16) == 0x2000  # Only CAP_NET_RAW.
assert int(process['CapBnd'], 16) == 0x2000
request = urllib.request.Request(base + 'scans/start', json.dumps({'addresses': '127.0.0.1'}).encode(),
    {'Content-Type': 'application/json', 'X-CSRF-Token': state['csrf']})
json.load(urllib.request.urlopen(request))
for _ in range(30):
    result = json.load(urllib.request.urlopen(base + 'scans'))
    if result['scan']['status'] not in ('running', 'cancelling'):
        break
    time.sleep(0.2)
assert result['scan']['status'] == 'completed', result
assert result['observations'][0]['status'] == 'responding', result
PY
# An update must repair existing installations whose unit predates ICMP grants.
sed -i '/^CapabilityBoundingSet=/d; /^AmbientCapabilities=/d' /etc/systemd/system/lanclaim.service
bash update.sh
python3 - <<'PY'
from lanclaim.db import Store
s = Store('/var/lib/lanclaim/lanclaim.sqlite3').snapshot()
assert s['counts']['claimed'] == 3 and s['counts']['assigned'] == 1
assert s['machines'][0]['lifecycle'] == 'reinstalling'
PY
# Simulate a migration that commits incompatible data and then fails at startup.
cp lanclaim/server.py /tmp/server-original.py
python3 - <<'PY'
from pathlib import Path
p = Path('lanclaim/server.py')
s = p.read_text()
s = s.replace("    if args.backup:\n", "    if not args.backup:\n        with store.transaction() as db:\n            db.execute(\"UPDATE machines SET name='BROKEN'\")\n        raise RuntimeError('simulated failed migration')\n    if args.backup:\n")
p.write_text(s)
PY
if bash update.sh; then echo 'Expected update failure' >&2; exit 1; fi
cp /tmp/server-original.py lanclaim/server.py
python3 - <<'PY'
import json, urllib.request
s = json.load(urllib.request.urlopen('http://127.0.0.1:8080/api/state'))
assert s['machines'][0]['name'] == 'Lifecycle test', s
assert s['counts']['assigned'] == 1
PY
bash uninstall.sh
test -f /var/lib/lanclaim/lanclaim.sqlite3
test ! -e /opt/lanclaim
test ! -e /etc/systemd/system/lanclaim.service
bash install.sh
python3 - <<'PY'
import json, urllib.request
s = json.load(urllib.request.urlopen('http://127.0.0.1:8080/api/state'))
assert s['counts']['claimed'] == 3 and s['counts']['assigned'] == 1
assert s['machines'][0]['lifecycle'] == 'reinstalling'
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
echo 'PASS: install, idempotence, update, failed-migration rollback, uninstall, reinstall, cancel purge, purge.'
