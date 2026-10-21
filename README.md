# LanClaim

**Your personal IP inventory.** See every address of your network on a map, claim the ones you want, and keep track of which device uses each of them. Self-hosted, dark interface, Spanish and English.

LanClaim is an inventory, not a DHCP server: claiming an IP records it as yours. It does not reserve it on a router.

## How it works

Every address is in one of four states:

| State | Meaning |
| --- | --- |
| **Assigned** (green) | Yours, used by a device such as `glpi` or `nas-01`. |
| **Reserved** (blue outline) | Yours, waiting for the next install. |
| **Used by someone else** (amber) | Not yours, but it answers ping. |
| **Free** (grey) | Not yours and silent. A dimmer grey means it has never been pinged. |

- **Network:** each registered network (`/22` to `/30`) is shown as a grid.
  - Click a cell to claim it, assign it to a device (typing a new name creates the device), change or remove its device, add a note or release it.
  - Shift+click or drag to select several cells at once. On touch screens, use **Select several**.
  - **I need an IP** jumps to your first reserved address, or to the first free one that nobody answered from in the last 7 days.
  - The counters work as filters, and the search box highlights cells by IP, device or note.
  - IPs you claimed outside every registered network are listed under **Other**.
- **Devices:** cards with name, type (VM, physical, container, other), OS, note and IPs.
  - When editing a device you can remove an IP (it goes back to reserved), add one of your reserved IPs, or type a new IP, which is claimed on the spot.
  - Deleting a device keeps its IPs as reserved.
- **Automatic ping:** the server pings every watched address every 5 minutes (`LANCLAIM_SCAN_INTERVAL`, in seconds; `0` turns it off). You can also press **Scan now**.
  - A green dot means the device answers and a red dot means it does not. An amber ring marks a free IP that answered in the last 7 days, probably a device that is switched off.
  - Ping never changes what is yours. A firewall may block ICMP, so a silent IP is not proof that it is free.

There are no Python package dependencies. Data lives in SQLite.

## Run locally

Requires Python 3.10+:

```bash
python3 -m lanclaim.server
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). On Windows use `python`. Data is stored in `./data/lanclaim.sqlite3`. Useful options: `--data-dir`, `--port` and `--scan-interval`.

## Install on Linux

Requires systemd, Bash and root access. The installer prepares Python, `iproute2` and `ping` with the system package manager.

```bash
chmod +x install.sh update.sh uninstall.sh
sudo ./install.sh
```

The service listens on port 8080 (`sudo env LANCLAIM_PORT=8090 ./install.sh` picks another one). It runs as the `lanclaim` user with `NoNewPrivileges` and only `CAP_NET_RAW`, so ping works without changing global settings. No firewall rules are changed.

```bash
# Update from your checkout (makes a database backup and rolls back if the new version fails to start):
git pull --ff-only
sudo ./update.sh

# Remove the app, keep data and configuration:
sudo ./uninstall.sh

# Remove everything, including data and backups:
sudo ./uninstall.sh --purge
```

> **Upgrading from 0.x:** version 2 starts with an empty inventory. The previous database is discarded on first start; the copy made by `update.sh` stays in `/var/lib/lanclaim/backups`.

This is a single-user tool without authentication, meant for a trusted private network. For any other access, put it behind an authenticated HTTPS reverse proxy or a VPN. Set `LANCLAIM_ALLOWED_HOSTS` when using a custom hostname. See the [operations guide](docs/OPERACION.md).

## Validation

```bash
python3 -m unittest discover -s tests -v
node tests/test_model.mjs
node tests/test_i18n.mjs
bash -n install.sh update.sh uninstall.sh scripts/common.sh

# Disposable Linux integration environment; no host service changes:
docker build -f tests/linux/Dockerfile -t lanclaim-lifecycle:test .
docker run --rm lanclaim-lifecycle:test
```

## Documentation / Documentación

- [Operación, instalación y recuperación](docs/OPERACION.md)
- [Modelo de datos](docs/MODELO.md)
- [Verificaciones y límites](docs/VERIFICACION.md)
- [Diseño de la versión 2](docs/superpowers/specs/2026-10-21-lanclaim-rework-design.md)
