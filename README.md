# LanClaim

**Your personal IP space.** Self-hosted IP address management and machine inventory, with a minimal, readable dark interface in Spanish and English.

LanClaim manages the addresses you claim. Claiming an IP adds it to your inventory; it does not reserve it on a router or prove it is unused on the network. Offline machines keep their assignments.

## Features

- Open **Network**, choose a server interface or enter a range, and scan for ICMP replies. Filter responding addresses and claim them directly from the table.
- Click **Claim IP** on any unclaimed address to add it to My IPs as available, without entering a device name. **Claim and add device** is a separate option for registering or choosing a device and assigning it in one save. Reuse an existing device, edit its details, reinstall it or replace just this IP’s assignment without leaving the IP. The device form contains only name, OS, virtualization platform and notes. OS and platform values can be entered manually and selected later from persistent saved lists.
- See device/VM names prominently above their IP addresses in both Network and My IPs, and search the network list by name. Details and forms expand beneath the selected row, with stable table columns and Back, Cancel and Escape navigation. Refreshing the list preserves the open form draft. Near-black surfaces and pastel state badges keep names, status and actions readable. IP notes can be edited and saved directly below the device summary.
- Use **My IPs** and **Machines** through a compact top navigation; counts stay small and machine details open on demand.
- Reload the browser or switch language without losing the current section, filters, search, network range/page, open IP or machine, and scroll position. Navigation is remembered per tab. Reloading returns to the record's overview; unsaved form edits and pending confirmations are not restored.
- Claim individual IPv4/IPv6 addresses, ranges or complete CIDRs, with duplicate detection and a 4096-address batch limit.
- Track available, planned, assigned and review-required addresses; filter reusable IPs.
- Edit device names, operating systems, virtualization platforms and device notes. Schema 3 seeds saved OS/platform choices from existing devices; partial edits preserve legacy metadata.
- Reinstall or format a machine while retaining its identity and every active IP assignment. Finish maintenance and update its details afterwards.
- Retire a machine and release its assignments atomically, retaining the machine and assignment records. Reactivation does not silently restore old assignments.
- Use clear Start/Finish reinstallation, Release assignment and Change assigned device actions, with visible state transitions before confirmation. History screens and links are removed from the interface; existing stored records are retained.
- Review discrepancies manually without losing existing assignments or plans.
- Store inventory and audit history in SQLite, independently of the browser. There are no Python runtime package dependencies; manual scans use the operating system's `ping` executable.

Manual scanning supports up to 1024 IPv4 addresses with progress and cancellation (16 concurrent probes). CIDR scans skip network/broadcast endpoints for prefixes below /31. Each result retains its timestamp in SQLite, separately from assignments. **No response does not mean free or offline**: a firewall may block ICMP. Periodic scanning, automatic conflict detection and device identity discovery are deferred.

Scanning runs from the server, so VM/WSL2 routing matters. Merely opening a page or selecting a range does not scan it. On restart, completed observations remain; an interrupted scan is not resumed automatically.

## Run locally

Requires Python 3.10+ with SQLite support:

```bash
python3 -m lanclaim.server
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). On Windows use `python` instead of `python3`. Data is stored in `./data/lanclaim.sqlite3`; use `--data-dir` to select another directory.

## Install on Linux

Requires systemd, Bash and root access for installation. The installer prepares Python, `iproute2` and `ping` (`iputils-ping` or `iputils`) using a supported package manager when needed.

```bash
chmod +x install.sh update.sh uninstall.sh
sudo ./install.sh
```

The service listens on port 8080 and prints candidate access URLs. Use `sudo env LANCLAIM_PORT=8090 ./install.sh` for a different initial port. No firewall rules are changed.

The service runs as `lanclaim` with `NoNewPrivileges` and only `CAP_NET_RAW`, so ping also works when Linux restricts unprivileged ICMP sockets. Existing installations receive the permission fix through `update.sh`; global ping permissions and kernel network settings are unchanged.

This release is a single-user tool without application authentication, intended for a trusted private network. For other access, use an authenticated HTTPS reverse proxy or VPN. Configure `LANCLAIM_ALLOWED_HOSTS` when using a custom hostname; see the [operations guide](docs/OPERACION.md).

```bash
# Run from your source checkout after pulling the desired version:
git pull --ff-only
sudo ./update.sh

# Preserve data and configuration:
sudo ./uninstall.sh

# Explicitly remove LanClaim data, backups and configuration:
sudo ./uninstall.sh --purge
```

Updates create a consistent database backup and restore the previous release/database if startup fails. Code lives under `/opt/lanclaim`, data under `/var/lib/lanclaim`, and configuration under `/etc/lanclaim`.

## Validation

```bash
python3 -m unittest discover -s tests -v
node tests/test_i18n.cjs
node --check lanclaim/static/app.js
bash -n install.sh update.sh uninstall.sh scripts/common.sh

# Disposable Linux integration environment; no host service changes:
docker build -f tests/linux/Dockerfile -t lanclaim-lifecycle:test .
docker run --rm lanclaim-lifecycle:test
```

The lifecycle test exercises the real application as its service user with a test-only service-manager adapter. It covers installation, updates, failed-migration rollback, uninstall/reinstall and purge. It does **not** certify a real systemd deployment. Application tests also run on Ubuntu under WSL2; see the [verification record](docs/VERIFICACION.md) for exact scope.

## Product documentation / Documentación

- [Operación, instalación y recuperación (español)](docs/OPERACION.md)
- [Requisitos funcionales](docs/REQUISITOS.md)
- [Modelo de dominio](docs/MODELO.md)
- [Prioridades y aceptación](docs/PLAN.md)
- [Verificaciones y límites](docs/VERIFICACION.md)
