# LanClaim

**Your personal IP space.** Self-hosted IP address management and machine inventory, with a readable dark terminal-inspired interface in Spanish and English.

LanClaim manages the addresses you claim. Claiming an IP adds it to your inventory; it does not reserve it on a router or prove it is unused on the network. Offline machines keep their assignments.

## Features

- Browse a subnet or inclusive range in **My network**, select addresses and claim them. Local interface prefixes are suggested without scanning devices.
- Claim individual IPv4/IPv6 addresses, ranges or complete CIDRs, with duplicate detection and a 4096-address batch limit.
- Track available, planned, assigned and review-required addresses; filter reusable IPs.
- Record machine names, descriptions, operating systems, hostnames, MACs, virtualization platforms, VM IDs, tags and notes.
- Reinstall or format a machine while retaining its identity and every active IP assignment. Finish maintenance and update its details afterwards.
- Retire a machine and release its assignments atomically, retaining the machine and full history. Reactivation does not silently restore old assignments.
- Review discrepancies manually without losing existing assignments or plans.
- Store inventory and audit history in SQLite, independently of the browser. There are no runtime package dependencies beyond Python's standard library.

Automatic connectivity checks and device discovery are intentionally deferred. Network lists enumerate address space; they do not report online/offline status.

## Run locally

Requires Python 3.10+ with SQLite support:

```bash
python3 -m lanclaim.server
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). On Windows use `python` instead of `python3`. Data is stored in `./data/lanclaim.sqlite3`; use `--data-dir` to select another directory.

## Install on Linux

Requires systemd, Bash and root access for installation. The installer prepares Python and `iproute2` using a supported package manager when needed.

```bash
chmod +x install.sh update.sh uninstall.sh
sudo ./install.sh
```

The service listens on port 8080 and prints candidate access URLs. Use `sudo env LANCLAIM_PORT=8090 ./install.sh` for a different initial port. No firewall rules are changed.

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
