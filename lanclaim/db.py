import ipaddress
import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


class Invalid(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


SCHEMA = """
CREATE TABLE ips (
 id INTEGER PRIMARY KEY, address TEXT NOT NULL UNIQUE, family INTEGER NOT NULL,
 claimed_at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE machines (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 os TEXT NOT NULL DEFAULT '', hostname TEXT NOT NULL DEFAULT '', mac TEXT NOT NULL DEFAULT '',
 platform TEXT NOT NULL DEFAULT '', vm_id TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '', lifecycle TEXT NOT NULL DEFAULT 'active'
 CHECK(lifecycle IN ('active','reinstalling','retired')), created_at TEXT NOT NULL, retired_at TEXT
);
CREATE TABLE assignments (
 id INTEGER PRIMARY KEY, ip_id INTEGER NOT NULL REFERENCES ips(id),
 machine_id INTEGER NOT NULL REFERENCES machines(id), started_at TEXT NOT NULL,
 ended_at TEXT, reason TEXT NOT NULL DEFAULT '', end_reason TEXT
);
CREATE UNIQUE INDEX one_active_assignment ON assignments(ip_id) WHERE ended_at IS NULL;
CREATE TABLE plans (
 id INTEGER PRIMARY KEY, ip_id INTEGER NOT NULL REFERENCES ips(id), target TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, closed_at TEXT,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','executed','cancelled'))
);
CREATE UNIQUE INDEX one_open_plan ON plans(ip_id) WHERE status='open';
CREATE TABLE reviews (
 id INTEGER PRIMARY KEY, ip_id INTEGER NOT NULL REFERENCES ips(id), reason TEXT NOT NULL,
 opened_at TEXT NOT NULL, closed_at TEXT, resolution TEXT
);
CREATE TABLE events (
 id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL,
 ip_id INTEGER REFERENCES ips(id), machine_id INTEGER REFERENCES machines(id),
 detail TEXT NOT NULL
);
CREATE INDEX events_ip ON events(ip_id,id);
CREATE INDEX events_machine ON events(machine_id,id);
CREATE TRIGGER assignment_guard BEFORE INSERT ON assignments WHEN NEW.ended_at IS NULL BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM plans WHERE ip_id=NEW.ip_id AND status='open')
 OR EXISTS(SELECT 1 FROM reviews WHERE ip_id=NEW.ip_id AND closed_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM machines WHERE id=NEW.machine_id AND lifecycle='active')
 THEN RAISE(ABORT,'La IP o la máquina no permite esta asignación') END;
END;
CREATE TRIGGER plan_guard BEFORE INSERT ON plans WHEN NEW.status='open' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignments WHERE ip_id=NEW.ip_id AND ended_at IS NULL)
 OR EXISTS(SELECT 1 FROM reviews WHERE ip_id=NEW.ip_id AND closed_at IS NULL)
 THEN RAISE(ABORT,'La IP no está disponible') END;
END;
PRAGMA user_version=1;
"""

MACHINE_FIELDS = ('name', 'description', 'os', 'hostname', 'mac', 'platform', 'vm_id', 'tags', 'notes')


def string(data, key, required=False, limit=4000):
    value = data.get(key, '')
    if not isinstance(value, str) or len(value) > limit:
        raise Invalid(f'Campo inválido: {key} (máximo {limit} caracteres).')
    value = value.strip()
    if required and not value:
        raise Invalid(f'Completa el campo {key}.')
    return value


def addresses(raw):
    """Accept individual addresses, inclusive ranges and whole CIDRs, atomically."""
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 100000:
        raise Invalid('Introduce direcciones, rangos o redes CIDR.')
    result = set()
    try:
        for token in re.split(r'[,;\s]+', re.sub(r'\s*-\s*', '-', raw.strip())):
            if not token:
                continue
            if '/' in token:
                network = ipaddress.ip_network(token, strict=False)
                first, last = network.network_address, network.broadcast_address
            elif '-' in token:
                left, right = token.split('-', 1)
                first, last = ipaddress.ip_address(left), ipaddress.ip_address(right)
            else:
                first = last = ipaddress.ip_address(token)
            if '%' in str(first) or '%' in str(last):
                raise ValueError('No se admiten identificadores de zona IPv6.')
            count = int(last) - int(first) + 1
            if first.version != last.version or count <= 0 or count > 4096:
                raise ValueError('Rango inválido o superior a 4096 direcciones.')
            for number in range(int(first), int(last) + 1):
                result.add(str(type(first)(number)))
            if len(result) > 4096:
                raise ValueError('Máximo 4096 direcciones por operación.')
    except ValueError as exc:
        raise Invalid(f'Direcciones inválidas: {exc}') from exc
    return sorted(result, key=lambda a: (ipaddress.ip_address(a).version, int(ipaddress.ip_address(a))))


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version > 2:
                raise RuntimeError('La base de datos requiere una versión más reciente de LanClaim.')
            if version == 0:
                db.executescript('BEGIN IMMEDIATE;\n' + SCHEMA + '\nCOMMIT;')
            if version < 2:
                db.executescript("""BEGIN IMMEDIATE;
                    CREATE TABLE observations (
                        address TEXT PRIMARY KEY,
                        status TEXT NOT NULL CHECK(status IN ('responding','no_response')),
                        checked_at TEXT NOT NULL
                    );
                    PRAGMA user_version=2;
                    COMMIT;""")

    def observe(self, address, status):
        with self.transaction() as db:
            db.execute('INSERT INTO observations(address,status,checked_at) VALUES(?,?,?) '
                       'ON CONFLICT(address) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at',
                       (address, status, now()))

    def observations(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute('SELECT * FROM observations ORDER BY address')]

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

    def event(self, db, kind, detail, ip_id=None, machine_id=None):
        db.execute('INSERT INTO events(at,kind,ip_id,machine_id,detail) VALUES(?,?,?,?,?)',
                   (now(), kind, ip_id, machine_id, json.dumps(detail, ensure_ascii=False)))

    def row(self, db, table, ident):
        # table is always an internal literal, never supplied by HTTP clients.
        row = db.execute(f'SELECT * FROM {table} WHERE id=?', (ident,)).fetchone()
        if row is None:
            raise Invalid('El registro ya no existe. Actualiza la página.')
        return dict(row)

    def snapshot(self):
        with self.connect() as db:
            db.execute('BEGIN')
            result = {table: [dict(r) for r in db.execute(f'SELECT * FROM {table} ORDER BY id')]
                      for table in ('ips', 'machines', 'assignments', 'plans', 'reviews')}
        assignments = {r['ip_id']: r for r in result['assignments'] if not r['ended_at']}
        plans = {r['ip_id']: r for r in result['plans'] if r['status'] == 'open'}
        reviews = {r['ip_id'] for r in result['reviews'] if not r['closed_at']}
        used = {r['ip_id'] for r in result['assignments'] if r['ended_at']}
        for ip in result['ips']:
            ip['assignment'] = assignments.get(ip['id'])
            ip['plan'] = plans.get(ip['id'])
            ip['review'] = ip['id'] in reviews
            ip['status'] = ('review' if ip['review'] else 'assigned' if ip['assignment']
                            else 'planned' if ip['plan'] else 'available')
            ip['reusable'] = ip['status'] == 'available' and ip['id'] in used
        result['ips'].sort(key=lambda x: (x['family'], int(ipaddress.ip_address(x['address']))))
        result['counts'] = {
            'claimed': len(result['ips']),
            'available': sum(i['status'] == 'available' for i in result['ips']),
            'assigned': len(assignments), 'planned': len(plans), 'review': len(reviews),
            'reusable': sum(i['reusable'] for i in result['ips']),
            'retired': sum(m['lifecycle'] == 'retired' for m in result['machines'])}
        return result

    def history(self, ip_id=None, machine_id=None, before=None):
        clauses, args = [], []
        for column, value in (('ip_id', ip_id), ('machine_id', machine_id), ('id', before)):
            if value is not None:
                clauses.append(f'{column}{"<" if column == "id" else "="}?')
                args.append(value)
        where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
        with self.connect() as db:
            rows = [dict(r) for r in db.execute('SELECT * FROM events' + where + ' ORDER BY id DESC LIMIT 100', args)]
        for row in rows:
            row['detail'] = json.loads(row['detail'])
        return rows

    def command(self, action, data):
        if not isinstance(data, dict):
            raise Invalid('Se esperaba un objeto JSON.')
        try:
            with self.transaction() as db:
                return self._command(db, action, data)
        except sqlite3.IntegrityError as exc:
            raise Invalid('La operación entra en conflicto con el estado actual. Actualiza e inténtalo de nuevo.') from exc

    def _command(self, db, action, data):
        if action in ('claim', 'preview_claim'):
            batch = addresses(data.get('addresses'))
            existing = {r[0] for r in db.execute('SELECT address FROM ips')}
            fresh = [a for a in batch if a not in existing]
            if action == 'claim':
                for address in fresh:
                    cur = db.execute('INSERT INTO ips(address,family,claimed_at) VALUES(?,?,?)',
                                     (address, ipaddress.ip_address(address).version, now()))
                    self.event(db, 'claimed', {'address': address}, ip_id=cur.lastrowid)
            return {'addresses': batch, 'added': len(fresh), 'existing': len(batch) - len(fresh)}

        if action in ('create_machine', 'edit_machine'):
            fields = {key: string(data, key, key == 'name', 200 if key not in ('notes', 'description') else 4000)
                      for key in MACHINE_FIELDS}
            if fields['mac'] and not re.fullmatch(r'(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}', fields['mac']):
                raise Invalid('La MAC debe tener seis pares hexadecimales, por ejemplo AA:BB:CC:DD:EE:FF.')
            if action == 'create_machine':
                cur = db.execute(f'INSERT INTO machines({",".join(MACHINE_FIELDS)},created_at) VALUES({",".join("?" for _ in range(10))})',
                                 (*fields.values(), now()))
                ident = cur.lastrowid
                self.event(db, 'machine_created', fields, machine_id=ident)
            else:
                ident = data.get('id')
                old = self.row(db, 'machines', ident)
                db.execute(f'UPDATE machines SET {",".join(k+"=?" for k in MACHINE_FIELDS)} WHERE id=?', (*fields.values(), ident))
                changes = {k: {'before': old[k], 'after': v} for k, v in fields.items() if old[k] != v}
                if changes:
                    self.event(db, 'machine_edited', changes, machine_id=ident)
            return {'id': ident}

        if action in ('retire', 'reinstall', 'finish_reinstall', 'restore_machine'):
            machine = self.row(db, 'machines', data.get('id'))
            allowed = {'retire': ('active', 'reinstalling'), 'reinstall': ('active',),
                       'finish_reinstall': ('reinstalling',), 'restore_machine': ('retired',)}
            if machine['lifecycle'] not in allowed[action]:
                raise Invalid('El estado actual de la máquina no permite esta acción.')
            reason = string(data, 'reason', True)
            state = {'retire': 'retired', 'reinstall': 'reinstalling', 'finish_reinstall': 'active', 'restore_machine': 'active'}[action]
            if action == 'retire':
                active = db.execute('SELECT * FROM assignments WHERE machine_id=? AND ended_at IS NULL', (machine['id'],)).fetchall()
                if 'assignment_ids' in data and data['assignment_ids'] != sorted(r['id'] for r in active):
                    raise Invalid('Las asignaciones cambiaron. Actualiza y revisa las IPs antes de retirar la máquina.')
                for row in active:
                    self.release(db, dict(row), reason)
            db.execute('UPDATE machines SET lifecycle=?,retired_at=? WHERE id=?',
                       (state, now() if state == 'retired' else None, machine['id']))
            self.event(db, action, {'name': machine['name'], 'reason': reason, 'previous': machine['lifecycle']}, machine_id=machine['id'])
            return {'id': machine['id']}

        if action in ('cancel_plan', 'resolve_review'):
            table = 'plans' if action == 'cancel_plan' else 'reviews'
            row = self.row(db, table, data.get('id'))
            if row['closed_at']:
                raise Invalid('Este registro ya está cerrado.')
            reason = string(data, 'reason', True)
            if action == 'cancel_plan':
                db.execute("UPDATE plans SET closed_at=?,status='cancelled' WHERE id=?", (now(), row['id']))
            else:
                db.execute('UPDATE reviews SET closed_at=?,resolution=? WHERE id=?', (now(), reason, row['id']))
            self.event(db, action, {'reason': reason, 'record_id': row['id']}, ip_id=row['ip_id'])
            return {}

        if action not in ('assign', 'plan', 'release', 'review', 'ip_notes'):
            raise Invalid('Operación desconocida.')
        ip = self.row(db, 'ips', data.get('ip_id'))
        assignment = db.execute('SELECT * FROM assignments WHERE ip_id=? AND ended_at IS NULL', (ip['id'],)).fetchone()
        plan = db.execute("SELECT * FROM plans WHERE ip_id=? AND status='open'", (ip['id'],)).fetchone()
        review = db.execute('SELECT 1 FROM reviews WHERE ip_id=? AND closed_at IS NULL', (ip['id'],)).fetchone()
        if action == 'assign':
            machine = self.row(db, 'machines', data.get('machine_id'))
            if assignment or review or machine['lifecycle'] != 'active':
                raise Invalid('La IP o la máquina no está disponible para asignar.')
            if plan:
                if data.get('plan_id') != plan['id']:
                    raise Invalid('Debes ejecutar o cancelar la planificación existente.')
                db.execute("UPDATE plans SET status='executed',closed_at=? WHERE id=?", (now(), plan['id']))
                self.event(db, 'plan_executed', {'target': plan['target']}, ip_id=ip['id'], machine_id=machine['id'])
            elif data.get('plan_id') is not None:
                raise Invalid('La planificación ya no está abierta.')
            db.execute('INSERT INTO assignments(ip_id,machine_id,started_at,reason) VALUES(?,?,?,?)',
                       (ip['id'], machine['id'], now(), string(data, 'reason')))
            self.event(db, 'assigned', {'address': ip['address'], 'machine': machine['name'], 'reason': string(data, 'reason')}, ip['id'], machine['id'])
        elif action == 'plan':
            if assignment or plan or review:
                raise Invalid('Solo puedes planificar direcciones disponibles.')
            target, notes = string(data, 'target', True, 200), string(data, 'notes')
            db.execute('INSERT INTO plans(ip_id,target,notes,created_at) VALUES(?,?,?,?)', (ip['id'], target, notes, now()))
            self.event(db, 'planned', {'target': target, 'notes': notes}, ip_id=ip['id'])
        elif action == 'release':
            if not assignment or data.get('assignment_id') != assignment['id']:
                raise Invalid('La asignación ha cambiado. Actualiza antes de liberar.')
            self.release(db, dict(assignment), string(data, 'reason', True))
        elif action == 'review':
            reason = string(data, 'reason', True)
            db.execute('INSERT INTO reviews(ip_id,reason,opened_at) VALUES(?,?,?)', (ip['id'], reason, now()))
            self.event(db, 'review_opened', {'reason': reason}, ip_id=ip['id'])
        elif action == 'ip_notes':
            notes = string(data, 'notes')
            db.execute('UPDATE ips SET notes=? WHERE id=?', (notes, ip['id']))
            self.event(db, 'ip_edited', {'before': ip['notes'], 'notes': notes}, ip_id=ip['id'])
        return {}

    def release(self, db, assignment, reason):
        db.execute('UPDATE assignments SET ended_at=?,end_reason=? WHERE id=?', (now(), reason, assignment['id']))
        self.event(db, 'released', {'reason': reason, 'assignment_id': assignment['id']}, assignment['ip_id'], assignment['machine_id'])

    def backup(self, target):
        with self.connect() as source:
            destination = sqlite3.connect(target)
            try:
                source.backup(destination)
            finally:
                destination.close()
