"""Inventario personal de IPs: redes, IPs reclamadas, equipos y observaciones de ping."""
import ipaddress
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 7
MAX_ADDRESSES = 4096
MIN_PREFIX, MAX_PREFIX = 22, 30
DEVICE_TYPES = ('vm', 'fisica', 'contenedor', 'otro')

SCHEMA = """
CREATE TABLE networks (
 id INTEGER PRIMARY KEY, cidr TEXT NOT NULL UNIQUE, sort_key INTEGER NOT NULL,
 name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE devices (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
 type TEXT NOT NULL CHECK(type IN ('vm','fisica','contenedor','otro')),
 os TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE ips (
 id INTEGER PRIMARY KEY, address TEXT NOT NULL UNIQUE, sort_key INTEGER NOT NULL,
 device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
 note TEXT NOT NULL DEFAULT '', claimed_at TEXT NOT NULL
);
CREATE INDEX ips_device ON ips(device_id);
CREATE TABLE observations (
 address TEXT PRIMARY KEY, up INTEGER NOT NULL, checked_at TEXT NOT NULL, last_up_at TEXT
);
"""

# Migraciones incrementales a partir del esquema 5. Una instalación nueva crea el 5 y las aplica todas.
DEFAULT_PLATFORMS = ('Proxmox VE', 'VMware ESXi', 'Vates XCP-ng', 'Nutanix AHV', 'Hyper-V', 'KVM', 'Local host')
MIGRATIONS = {
    # v6: sistemas operativos ya usados, independientes de los equipos que los usaron.
    6: """
CREATE TABLE os_choices (name TEXT NOT NULL, name_key TEXT PRIMARY KEY, used_at TEXT NOT NULL);
INSERT OR IGNORE INTO os_choices(name, name_key, used_at)
 SELECT os, lower(os), created_at FROM devices WHERE os <> '' ORDER BY created_at;
""",
    # v7: anfitrión de cada equipo y plataforma de virtualización del anfitrión.
    7: """
ALTER TABLE devices ADD COLUMN host_id INTEGER REFERENCES devices(id) ON DELETE SET NULL;
ALTER TABLE devices ADD COLUMN platform TEXT NOT NULL DEFAULT '';
CREATE INDEX devices_host ON devices(host_id);
CREATE TABLE platform_choices (name TEXT NOT NULL, name_key TEXT PRIMARY KEY, used_at TEXT NOT NULL);
""" + ''.join(f"INSERT INTO platform_choices VALUES('{p}', '{p.lower()}', '');\n" for p in reversed(DEFAULT_PLATFORMS)),
}


class Invalid(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _host(text):
    try:
        address = ipaddress.ip_address(text)
    except ValueError:
        raise Invalid(f'«{text}» no es una dirección IP válida.') from None
    if address.version != 4:
        raise Invalid('LanClaim solo admite direcciones IPv4.')
    if address.is_multicast or address.is_unspecified or str(address) == '255.255.255.255':
        raise Invalid(f'{address} no es una dirección de equipo.')
    return address


def _sort_key(address):
    return int(ipaddress.IPv4Address(address))


def parse_addresses(raw):
    """IPs sueltas, rangos (192.168.1.10-20 o completos) y CIDR, como lista IPv4 canónica ordenada."""
    if isinstance(raw, (list, tuple)):
        if not all(isinstance(item, str) for item in raw):
            raise Invalid('Lista de direcciones inválida.')
        raw = ','.join(raw)
    if not isinstance(raw, str) or not raw.strip():
        raise Invalid('Escribe una IP, un rango o una red.')
    if len(raw) > 100000:
        raise Invalid('Demasiadas direcciones.')
    result = set()
    for token in re.split(r'[,;\s]+', re.sub(r'\s*-\s*', '-', raw.strip())):
        if not token:
            continue
        if '/' in token:
            try:
                network = ipaddress.IPv4Network(token, strict=False)
            except ValueError:
                raise Invalid(f'«{token}» no es una red IPv4 válida.') from None
            if network.num_addresses > MAX_ADDRESSES:
                raise Invalid(f'Máximo {MAX_ADDRESSES} direcciones por operación.')
            hosts = [_host(str(h)) for h in (network.hosts() if network.prefixlen < 32 else [network.network_address])]
        elif '-' in token:
            left, right = token.split('-', 1)
            first = _host(left)
            if '.' not in right:
                right = left.rsplit('.', 1)[0] + '.' + right
            last = _host(right)
            count = int(last) - int(first) + 1
            if count <= 0:
                raise Invalid(f'El rango «{token}» está al revés.')
            if count > MAX_ADDRESSES:
                raise Invalid(f'Máximo {MAX_ADDRESSES} direcciones por operación.')
            hosts = [_host(str(ipaddress.IPv4Address(n))) for n in range(int(first), int(last) + 1)]
        else:
            hosts = [_host(token)]
        result.update(str(h) for h in hosts)
        if len(result) > MAX_ADDRESSES:
            raise Invalid(f'Máximo {MAX_ADDRESSES} direcciones por operación.')
    if not result:
        raise Invalid('Escribe una IP, un rango o una red.')
    return sorted(result, key=_sort_key)


def _optional_addresses(raw):
    if raw is None or raw == '' or raw == [] or raw == ():
        return []
    return parse_addresses(raw)


def parse_network(cidr):
    if not isinstance(cidr, str):
        raise Invalid('Escribe una red en formato CIDR, por ejemplo 192.168.1.0/24.')
    try:
        network = ipaddress.ip_network(cidr.strip(), strict=False)
    except ValueError:
        raise Invalid(f'«{cidr}» no es una red válida. Ejemplo: 192.168.1.0/24.') from None
    if network.version != 4:
        raise Invalid('LanClaim solo admite redes IPv4.')
    if not MIN_PREFIX <= network.prefixlen <= MAX_PREFIX:
        raise Invalid(f'La red debe estar entre /{MIN_PREFIX} y /{MAX_PREFIX}.')
    return network


def _text(data, key, limit, required=False, label=None):
    value = data.get(key, '')
    if value is None:
        value = ''
    if not isinstance(value, str):
        raise Invalid(f'Campo inválido: {label or key}.')
    value = value.strip()
    if len(value) > limit:
        raise Invalid(f'{label or key}: máximo {limit} caracteres.')
    if required and not value:
        raise Invalid(f'Completa el campo {label or key}.')
    return value


def _device_fields(data):
    if not isinstance(data, dict):
        raise Invalid('Datos de equipo inválidos.')
    fields = {
        'name': _text(data, 'name', 120, True, 'nombre'),
        'type': data.get('type') or 'vm',
        'os': _text(data, 'os', 120, label='sistema operativo'),
        'note': _text(data, 'note', 2000, label='nota'),
        'platform': _text(data, 'platform', 60, label='plataforma'),
    }
    if fields['type'] not in DEVICE_TYPES:
        raise Invalid('Tipo de equipo desconocido.')
    return fields


def _int_id(value, what):
    if isinstance(value, bool) or not isinstance(value, int):
        raise Invalid(f'Identificador de {what} inválido.')
    return value


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=15)
        try:
            db.execute('PRAGMA journal_mode=WAL')
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version > SCHEMA_VERSION:
                raise RuntimeError('La base de datos pertenece a una versión más nueva de LanClaim.')
            if 5 <= version < SCHEMA_VERSION:
                # Desde la versión 2 los datos se conservan: se aplican las migraciones pendientes en orden.
                steps = ''.join(MIGRATIONS[v] for v in range(version + 1, SCHEMA_VERSION + 1))
                db.executescript(f'BEGIN;\n{steps}PRAGMA user_version={SCHEMA_VERSION};\nCOMMIT;')
            elif version != SCHEMA_VERSION:
                # Las versiones 0.x (esquemas 1-4) no se conservan: se descarta todo y se empieza vacío.
                objects = db.execute("SELECT type, name FROM sqlite_master WHERE type IN ('table','view') "
                                     "AND name NOT LIKE 'sqlite_%'").fetchall()
                drops = ''.join(f'DROP {kind.upper()} IF EXISTS "{name.replace(chr(34), chr(34) * 2)}";\n'
                                for kind, name in objects)
                db.execute('PRAGMA foreign_keys=OFF')
                steps = ''.join(MIGRATIONS[v] for v in range(6, SCHEMA_VERSION + 1))
                db.executescript(f'BEGIN;\n{drops}{SCHEMA}{steps}PRAGMA user_version={SCHEMA_VERSION};\nCOMMIT;')
        finally:
            db.close()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    def backup(self, target):
        with self.connect() as source:
            destination = sqlite3.connect(target)
            try:
                source.backup(destination)
            finally:
                destination.close()

    # Lectura

    def state(self):
        with self.connect() as db:
            networks = [dict(r) for r in db.execute('SELECT id, cidr, name FROM networks ORDER BY sort_key')]
            ips = [dict(r) for r in db.execute('SELECT address, device_id, note, claimed_at FROM ips ORDER BY sort_key')]
            devices = [dict(r) for r in db.execute('SELECT id, name, type, os, note, host_id, platform FROM devices ORDER BY name_key')]
            rows = db.execute('SELECT address, up, checked_at, last_up_at FROM observations').fetchall()
            watched = set(self._watched(db))
            os_choices = [r[0] for r in db.execute('SELECT name FROM os_choices ORDER BY used_at DESC, rowid DESC')]
            platform_choices = [r[0] for r in db.execute('SELECT name FROM platform_choices ORDER BY used_at DESC, rowid DESC')]
        observations = {r['address']: {'up': bool(r['up']), 'checked_at': r['checked_at'], 'last_up_at': r['last_up_at']}
                        for r in rows if r['address'] in watched}
        return {'networks': networks, 'ips': ips, 'devices': devices, 'observations': observations,
                'os_choices': os_choices, 'platform_choices': platform_choices}

    def watched_addresses(self):
        with self.connect() as db:
            return self._watched(db)

    def _watched(self, db):
        result = set()
        networks = [ipaddress.IPv4Network(r[0]) for r in db.execute('SELECT cidr FROM networks')]
        for network in networks:
            result.update(str(h) for h in network.hosts())
        result.update(r[0] for r in db.execute('SELECT address FROM ips'))
        edges = self._edges(db)
        return sorted((a for a in result if a not in edges), key=_sort_key)

    def _edges(self, db):
        """Direcciones de red y broadcast de las redes registradas: no son de equipos."""
        edges = set()
        for (cidr,) in db.execute('SELECT cidr FROM networks'):
            network = ipaddress.IPv4Network(cidr)
            if network.prefixlen < 31:
                edges.update((str(network.network_address), str(network.broadcast_address)))
        return edges

    def _reject_edges(self, db, targets):
        edges = self._edges(db)
        for address in targets:
            if address in edges:
                raise Invalid(f'{address} es la dirección de red o de broadcast de una red registrada.')

    # Redes

    def add_network(self, cidr, name=''):
        network = parse_network(cidr)
        name = _text({'name': name}, 'name', 60, label='nombre de la red')
        with self.transaction() as db:
            existing = [ipaddress.IPv4Network(r[0]) for r in db.execute('SELECT cidr FROM networks')]
            for other in existing:
                if network.overlaps(other):
                    raise Invalid(f'{network} se solapa con {other}, que ya está registrada.')
            if sum(n.num_addresses for n in existing) + network.num_addresses > MAX_ADDRESSES:
                raise Invalid(f'Entre todas las redes no pueden pasar de {MAX_ADDRESSES} direcciones.')
            return db.execute('INSERT INTO networks(cidr, sort_key, name, created_at) VALUES(?,?,?,?)',
                              (str(network), int(network.network_address), name, now())).lastrowid

    def rename_network(self, network_id, name):
        name = _text({'name': name}, 'name', 60, label='nombre de la red')
        with self.transaction() as db:
            if db.execute('UPDATE networks SET name=? WHERE id=?', (name, _int_id(network_id, 'red'))).rowcount != 1:
                raise Invalid('Esa red ya no existe.')

    def remove_network(self, network_id):
        with self.transaction() as db:
            if db.execute('DELETE FROM networks WHERE id=?', (_int_id(network_id, 'red'),)).rowcount != 1:
                raise Invalid('Esa red ya no existe.')

    # IPs

    def claim(self, addresses, device=None):
        targets = parse_addresses(addresses)
        with self.transaction() as db:
            self._reject_edges(db, targets)
            device_id = self._resolve_device(db, device) if device is not None else None
            claimed = assigned = 0
            for address in targets:
                row = db.execute('SELECT device_id FROM ips WHERE address=?', (address,)).fetchone()
                if row is None:
                    db.execute('INSERT INTO ips(address, sort_key, device_id, claimed_at) VALUES(?,?,?,?)',
                               (address, _sort_key(address), device_id, now()))
                    claimed += 1
                    assigned += device_id is not None
                elif device_id is not None and row['device_id'] != device_id:
                    db.execute('UPDATE ips SET device_id=? WHERE address=?', (device_id, address))
                    assigned += 1
            return {'claimed': claimed, 'assigned': assigned}

    def release(self, addresses):
        targets = parse_addresses(addresses)
        with self.transaction() as db:
            self._require_claimed(db, targets)
            db.executemany('DELETE FROM ips WHERE address=?', [(a,) for a in targets])

    def unassign(self, addresses):
        targets = parse_addresses(addresses)
        with self.transaction() as db:
            self._require_claimed(db, targets)
            db.executemany('UPDATE ips SET device_id=NULL WHERE address=?', [(a,) for a in targets])

    def set_note(self, address, note):
        targets = parse_addresses(address)
        if len(targets) != 1:
            raise Invalid('La nota se guarda en una sola IP.')
        note = _text({'note': note}, 'note', 2000, label='nota')
        with self.transaction() as db:
            self._require_claimed(db, targets)
            db.execute('UPDATE ips SET note=? WHERE address=?', (note, targets[0]))

    def _require_claimed(self, db, targets):
        for address in targets:
            if db.execute('SELECT 1 FROM ips WHERE address=?', (address,)).fetchone() is None:
                raise Invalid(f'{address} no está reclamada.')

    # Equipos

    def _resolve_device(self, db, device):
        if not isinstance(device, dict):
            raise Invalid('Equipo inválido.')
        if 'id' in device:
            device_id = _int_id(device['id'], 'equipo')
            if db.execute('SELECT 1 FROM devices WHERE id=?', (device_id,)).fetchone() is None:
                raise Invalid('Ese equipo ya no existe.')
            return device_id
        name = _text(device, 'name', 120, True, 'nombre')
        row = db.execute('SELECT id FROM devices WHERE name_key=?', (name.casefold(),)).fetchone()
        if row:
            return row['id']
        return self._insert_device(db, _device_fields({'name': name, 'type': device.get('type'), 'os': device.get('os')}))

    def _remember(self, db, table, value):
        if value:
            db.execute(f'INSERT INTO {table}(name, name_key, used_at) VALUES(?,?,?) '
                       'ON CONFLICT(name_key) DO UPDATE SET name=excluded.name, used_at=excluded.used_at',
                       (value, value.casefold(), now()))

    def forget_os(self, name):
        name = _text({'name': name}, 'name', 120, label='sistema operativo')
        with self.transaction() as db:
            db.execute('DELETE FROM os_choices WHERE name_key=?', (name.casefold(),))

    def forget_platform(self, name):
        name = _text({'name': name}, 'name', 60, label='plataforma')
        with self.transaction() as db:
            db.execute('DELETE FROM platform_choices WHERE name_key=?', (name.casefold(),))

    def _resolve_host(self, db, host, device_id=None):
        """Anfitrión por id o por nombre (si no existe, se crea como equipo físico con su plataforma)."""
        if host is None:
            return None
        if not isinstance(host, dict):
            raise Invalid('Anfitrión inválido.')
        if 'id' in host:
            host_id = _int_id(host['id'], 'anfitrión')
            if db.execute('SELECT 1 FROM devices WHERE id=?', (host_id,)).fetchone() is None:
                raise Invalid('Ese anfitrión ya no existe.')
        else:
            name = _text(host, 'name', 120, True, 'nombre del anfitrión')
            row = db.execute('SELECT id FROM devices WHERE name_key=?', (name.casefold(),)).fetchone()
            platform = host.get('platform')
            if not platform:
                # Un anfitrión llamado como una plataforma conocida («VMware ESXi») la recibe sin volver a escribirla.
                known = db.execute('SELECT name FROM platform_choices WHERE name_key=?', (name.casefold(),)).fetchone()
                platform = known['name'] if known else ''
            host_id = row['id'] if row else self._insert_device(
                db, _device_fields({'name': name, 'type': 'fisica', 'platform': platform}))
        # Sin ciclos: el anfitrión no puede ser el propio equipo ni algo que corre dentro de él.
        current = host_id
        while device_id is not None and current is not None:
            if current == device_id:
                raise Invalid('Un equipo no puede ser anfitrión de sí mismo ni de quien lo aloja.')
            current = db.execute('SELECT host_id FROM devices WHERE id=?', (current,)).fetchone()['host_id']
        return host_id

    def _insert_device(self, db, fields, host_id=None):
        self._remember(db, 'os_choices', fields['os'])
        self._remember(db, 'platform_choices', fields['platform'])
        try:
            return db.execute('INSERT INTO devices(name, name_key, type, os, note, platform, host_id, created_at) '
                              'VALUES(?,?,?,?,?,?,?,?)',
                              (fields['name'], fields['name'].casefold(), fields['type'], fields['os'],
                               fields['note'], fields['platform'], host_id, now())).lastrowid
        except sqlite3.IntegrityError:
            raise Invalid(f'Ya existe un equipo llamado «{fields["name"]}».') from None

    def _change_device_ips(self, db, device_id, add, remove):
        """Aplica altas y bajas sobre las filas actuales, no sobre una copia antigua del formulario."""
        self._reject_edges(db, add)
        for address in remove:
            if address not in add:
                db.execute('UPDATE ips SET device_id=NULL WHERE address=? AND device_id=?', (address, device_id))
        for address in add:
            if db.execute('UPDATE ips SET device_id=? WHERE address=?', (device_id, address)).rowcount == 0:
                db.execute('INSERT INTO ips(address, sort_key, device_id, claimed_at) VALUES(?,?,?,?)',
                           (address, _sort_key(address), device_id, now()))

    def create_device(self, fields, addresses=()):
        host = fields.get('host') if isinstance(fields, dict) else None
        fields = _device_fields(fields)
        targets = _optional_addresses(addresses)
        with self.transaction() as db:
            device_id = self._insert_device(db, fields, self._resolve_host(db, host))
            self._change_device_ips(db, device_id, targets, [])
            return device_id

    def update_device(self, device_id, fields, add=(), remove=()):
        device_id = _int_id(device_id, 'equipo')
        has_host = isinstance(fields, dict) and 'host' in fields
        host = fields.get('host') if has_host else None
        fields = _device_fields(fields)
        add, remove = _optional_addresses(add), _optional_addresses(remove)
        with self.transaction() as db:
            if db.execute('SELECT 1 FROM devices WHERE id=?', (device_id,)).fetchone() is None:
                raise Invalid('Ese equipo ya no existe.')
            clash = db.execute('SELECT 1 FROM devices WHERE name_key=? AND id<>?',
                               (fields['name'].casefold(), device_id)).fetchone()
            if clash:
                raise Invalid(f'Ya existe un equipo llamado «{fields["name"]}».')
            self._remember(db, 'os_choices', fields['os'])
            self._remember(db, 'platform_choices', fields['platform'])
            db.execute('UPDATE devices SET name=?, name_key=?, type=?, os=?, note=?, platform=? WHERE id=?',
                       (fields['name'], fields['name'].casefold(), fields['type'], fields['os'], fields['note'],
                        fields['platform'], device_id))
            if has_host:
                db.execute('UPDATE devices SET host_id=? WHERE id=?', (self._resolve_host(db, host, device_id), device_id))
            self._change_device_ips(db, device_id, add, remove)

    def delete_device(self, device_id):
        with self.transaction() as db:
            if db.execute('DELETE FROM devices WHERE id=?', (_int_id(device_id, 'equipo'),)).rowcount != 1:
                raise Invalid('Ese equipo ya no existe.')

    # Observaciones (nunca tocan ips ni devices)

    def record_observations(self, results, at):
        with self.transaction() as db:
            db.executemany(
                'INSERT INTO observations(address, up, checked_at, last_up_at) VALUES(?1, ?2, ?3, CASE WHEN ?2 THEN ?3 END) '
                'ON CONFLICT(address) DO UPDATE SET up=excluded.up, checked_at=excluded.checked_at, '
                'last_up_at=CASE WHEN excluded.up THEN excluded.checked_at ELSE observations.last_up_at END',
                [(address, int(bool(up)), at) for address, up in results.items()])
