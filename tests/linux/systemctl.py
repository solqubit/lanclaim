#!/usr/bin/python3
"""Test-only service-manager adapter; exercises real server under its service UID.

Not a systemd emulator or production executable. It lets unprivileged Docker CI
exercise lifecycle files and rollback without access to the host's systemd.
"""
import os
import pwd
import signal
import subprocess
import sys
import time
from pathlib import Path

pidfile = Path('/tmp/lanclaim-test.pid')


def active():
    try:
        pid = int(pidfile.read_text())
        # Child processes may remain zombies under a minimal container PID 1.
        return Path(f'/proc/{pid}/stat').read_text().split()[2] != 'Z'
    except (FileNotFoundError, ValueError):
        return False


def stop():
    if active():
        pid = int(pidfile.read_text())
        os.kill(pid, signal.SIGTERM)
        for _ in range(100):
            if not active():
                break
            time.sleep(0.02)
        if active():
            raise RuntimeError('Service failed to stop')
    pidfile.unlink(missing_ok=True)


def start():
    if active():
        return
    env = dict(os.environ)
    for line in Path('/etc/lanclaim/lanclaim.env').read_text().splitlines():
        if line and not line.startswith('#'):
            key, value = line.split('=', 1)
            env[key] = value
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    account = pwd.getpwnam('lanclaim')
    unit = Path('/etc/systemd/system/lanclaim.service').read_text()
    for setting in ('User=lanclaim', 'NoNewPrivileges=true',
                    'CapabilityBoundingSet=CAP_NET_RAW', 'AmbientCapabilities=CAP_NET_RAW'):
        if setting not in unit.splitlines():
            raise RuntimeError('Missing service permission setting: ' + setting)
    # Reproduce UID/capability/NNP semantics for real ping, even when the kernel
    # denies unprivileged ICMP sockets. Other systemd sandboxing is not emulated.
    command = ['setpriv', f'--reuid={account.pw_uid}', f'--regid={account.pw_gid}', '--clear-groups',
               '--inh-caps=+net_raw', '--ambient-caps=+net_raw', '--bounding-set=-all,+net_raw',
               '--no-new-privs', '/usr/bin/python3', '-m', 'lanclaim.server']
    with open('/tmp/lanclaim-test.log', 'ab') as output:
        process = subprocess.Popen(command, cwd='/opt/lanclaim/current', env=env,
                                   stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True)
    pidfile.write_text(str(process.pid))


args = sys.argv[1:]
action = args[0]
if action == 'start' or action == 'enable' and '--now' in args:
    start()
elif action == 'stop' or action == 'disable' and '--now' in args:
    stop()
elif action == 'is-active':
    sys.exit(0 if active() else 1)
elif action not in ('daemon-reload', 'reset-failed', 'enable', 'disable'):
    sys.exit('Unsupported test systemctl action: ' + action)
