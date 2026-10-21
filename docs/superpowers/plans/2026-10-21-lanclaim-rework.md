# LanClaim 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rehacer LanClaim como inventario personal de IPs centrado en un mapa de red. Una IP es libre, ocupada, reservada (mía, sin equipo) o asignada (mía, con equipo). Además: vista de equipos y ping automático.

**Architecture:** Backend Python con solo la biblioteca estándar: `http.server` + SQLite, con un esquema nuevo (v5) que descarta cualquier base antigua. Cada mutación devuelve el estado completo y la UI re-renderiza desde ese único objeto. Frontend en JS vanilla con módulos ES, sin build, en `lanclaim/static/js/`. Las funciones puras viven en `model.js` y se testean con Node.

**Tech Stack:** Python 3.10+ stdlib (`sqlite3`, `http.server`, `threading`, `subprocess`), JS ES2020 modules, CSS con custom properties, `unittest`, Node 18+ (`node:assert`) y Docker para el test de ciclo de vida Linux.

**Spec:** `docs/superpowers/specs/2026-10-21-lanclaim-rework-design.md`. La demo aprobada está en `.superpowers/brainstorm/5017-1792563035/content/demo.html` y es la referencia visual: paleta, layout y textos se copian de ahí.

## Global Constraints

- Solo IPv4. Redes registrables de /22 a /30. Las redes registradas no pueden solaparse. Suma de direcciones vigiladas ≤ 4096.
- Sin dependencias de Python fuera de la stdlib. Sin paso de build en el frontend. Sin CDNs (la CSP es `default-src 'self'`).
- `install.sh`, `update.sh`, `uninstall.sh` y `scripts/common.sh` se conservan (requisito del usuario). Solo se añade `LANCLAIM_SCAN_INTERVAL=300` al `.env` generado.
- No se conserva nada de la versión anterior: si `PRAGMA user_version` está entre 1 y 4, se borran todas las tablas, índices y triggers y se crea el esquema v5 vacío.
- El escaneo nunca modifica `ips` ni `devices`.
- Tipos de equipo: `vm`, `fisica`, `contenedor`, `otro` (etiquetas: VM, Física, Contenedor, Otro).
- Nombre de equipo obligatorio y único sin distinguir mayúsculas. Máximo 120 caracteres. SO máximo 120. Notas máximo 2000.
- "Respondió hace poco" = `last_up_at` dentro de los últimos 7 días.
- Intervalo de ping por defecto: 300 s (`LANCLAIM_SCAN_INTERVAL`; `0` lo desactiva). 32 pings concurrentes, timeout de 1 s.
- Se mantienen las protecciones HTTP actuales: Host/Origin, `X-CSRF-Token` y JSON obligatorio en POST, CSP y cabeceras.
- UI en español por defecto, con traducción a inglés. Todo texto visible pasa por `t()`.
- Confirmación (botón de dos pasos, como en la demo) solo para: liberar una IP con equipo o nota, liberar varias, eliminar equipo y quitar una red con IPs reclamadas.
- `__version__ = "2.0.0"`.

## Review Focus

1. **Doble pestaña / estado viejo**: asignar o liberar una IP que otra pestaña ya cambió. Lo esperado es que la operación se aplique sobre el estado actual del servidor y la UI se refresque con la respuesta, nunca con un 500. Test en Task 1: `test_claim_is_idempotent_and_reassigns`.
2. **Entradas de IP raras** en el formulario de equipo: espacios, `192.168.1.043`, IPv6, `192.168.1.0` (dirección de red), duplicados. Lo esperado: normalizar o rechazar con un mensaje claro y sin cambios parciales. Test en Task 1: `test_update_device_rejects_bad_address_atomically`.
3. **Ping sin permisos o sin binario**: el mapa sigue usable, el error se muestra una vez y el hilo no muere ni hace spam en el log. Test en Task 2: `test_probe_error_is_reported_and_loop_survives`.
4. **Quitar una red con IPs reclamadas**: las IPs pasan al chip "Otras" y siguen siendo asignables. Test en Task 1 (`test_remove_network_keeps_claims`). Comprobación en el navegador en Task 7.
5. **Nombres con HTML o comillas** (`<img onerror>`, `"`): siempre se insertan como texto. Test en Task 4: el helper `el()` usa `textContent`/`append(string)`. Comprobación en Task 7 creando un equipo `<b>x</b>`.

---

## File Structure

| Archivo | Responsabilidad |
| --- | --- |
| `lanclaim/db.py` (reescrito) | Esquema v5, descarte de esquemas antiguos, validación y todas las operaciones de dominio. `Store.state()` |
| `lanclaim/scanner.py` (reescrito, conserva `ping`) | `ping()` igual que ahora. `Scanner`: bucle periódico, `scan_now()` y `status()` |
| `lanclaim/networks.py` (sin cambios) | Sugerencias de redes del servidor |
| `lanclaim/server.py` (reescrito el routing) | Rutas REST, estáticos con lista blanca y arranque |
| `lanclaim/static/index.html` | Esqueleto HTML |
| `lanclaim/static/css/app.css` | Tokens y componentes (de la demo) |
| `lanclaim/static/js/package.json` | `{"type":"module"}` para que Node importe los módulos en tests (no se sirve) |
| `lanclaim/static/js/ui.js` | `el()`, `toast()`, `confirmButton()`, `deviceInput()` |
| `lanclaim/static/js/i18n.js` | Diccionario ES→EN, `t()`, `setLang()`, `lang()` |
| `lanclaim/static/js/model.js` | Funciones puras sobre el estado (sin DOM) |
| `lanclaim/static/js/api.js` | `load()`, `post()` con CSRF y manejo de errores |
| `lanclaim/static/js/map.js` | Barra de redes, resumen, cuadrícula/lista "Otras", selección, escaneo |
| `lanclaim/static/js/panel.js` | Panel lateral según selección |
| `lanclaim/static/js/devices.js` | Tarjetas, filtros y formulario de equipo con gestión de IPs |
| `lanclaim/static/js/main.js` | Estado de UI, hash, render, eventos globales, refresco periódico |
| Se borran | `lanclaim/static/app.js`, `lanclaim/static/i18n.js`, `lanclaim/static/style.css`, `tests/test_domain.py`, `tests/test_ip_workflow.py`, `tests/test_machine_choices.py`, `tests/test_machine_deletion.py`, `tests/test_i18n.cjs`, `docs/PLAN.md`, `docs/REQUISITOS.md` |
| Tests | `tests/test_store.py`, `tests/test_scanner.py` (reescrito), `tests/test_http.py` (reescrito), `tests/test_networks.py` (se mantiene), `tests/test_model.mjs`, `tests/test_i18n.mjs` |

---

### Task 1: Store v5 (dominio)

**Files:**
- Rewrite: `lanclaim/db.py`
- Create: `tests/test_store.py`
- Delete: `tests/test_domain.py`, `tests/test_ip_workflow.py`, `tests/test_machine_choices.py`, `tests/test_machine_deletion.py`

**Interfaces:**
- Produces:
  - `class Invalid(ValueError)` y `now() -> str` (ISO UTC, como ahora).
  - `parse_addresses(raw: str | list[str]) -> list[str]`: IPv4 canónicas, ordenadas y únicas. Acepta IPs sueltas, rangos `a-b` y CIDR (de CIDR excluye red y broadcast si el prefijo es < /31). Máximo 4096. Rechaza IPv6, multicast, `0.0.0.0` y `255.255.255.255` con `Invalid` en español.
  - `parse_network(cidr: str) -> ipaddress.IPv4Network` (`strict=False`, rango de prefijo /22–/30).
  - `Store(path)` con métodos que devuelven `None` salvo que se indique otra cosa. Todos validan y hacen la operación en una única transacción:
    - `state() -> dict`: `{"networks":[{id,cidr,name}], "ips":[{address,device_id,note,claimed_at}], "devices":[{id,name,type,os,note}], "observations":{address:{"up":bool,"checked_at":str,"last_up_at":str|None}}}`. Las observaciones incluyen solo direcciones vigiladas.
    - `add_network(cidr: str, name: str = "") -> int`; `rename_network(id: int, name: str)`; `remove_network(id: int)`.
    - `claim(addresses, device: dict | None = None) -> dict` (`{"claimed":int,"assigned":int}`). `device` es `{"id": int}` o `{"name": str, "type": str}`. Un nombre que ya existe (sin distinguir mayúsculas) reutiliza ese equipo, y uno nuevo lo crea con `os=""`. Las IPs ya reclamadas no se duplican; si se pasa `device`, se reasignan.
    - `release(addresses)` (no reclamadas → `Invalid`); `unassign(addresses)`; `set_note(address, note)`.
    - `create_device(fields: dict, addresses: list[str] = ()) -> int`; `update_device(id: int, fields: dict, addresses: list[str])`: `addresses` es la lista final; las que salen quedan reservadas y las que entran se reclaman o reasignan. `delete_device(id)`: sus IPs quedan reservadas.
    - `watched_addresses() -> list[str]`: hosts de todas las redes más las IPs reclamadas fuera de ellas.
    - `record_observations(results: dict[str, bool], at: str)`.
    - `backup(destination: str)` (igual que ahora, lo usa `update.sh`).

- [ ] **Step 1: Write failing tests in `tests/test_store.py`** (unittest, `tempfile` DB)
  - `test_discards_old_schema`: crear un sqlite con `CREATE TABLE ips(x)` y `PRAGMA user_version=4`. `Store(path).state()` == `{"networks":[], "ips":[], "devices":[], "observations":{}}` y `user_version == 5`.
  - `test_parse_addresses`: `parse_addresses("192.168.1.10-12, 192.168.1.10")` == `['192.168.1.10','192.168.1.11','192.168.1.12']`; `parse_addresses("10.0.0.0/30")` == `['10.0.0.1','10.0.0.2']`; `"fe80::1"`, `"224.0.0.1"`, `"192.168.1.043"` y un rango de 4097 lanzan `Invalid`.
  - `test_networks_validation`: aceptar `/24` y `/22`; rechazar `/21`, `/31`, IPv6, solapamiento (`192.168.0.0/22` después de `192.168.1.0/24`) y duplicados; rechazar si la suma de vigiladas pasaría de 4096.
  - `test_claim_is_idempotent_and_reassigns`: reclamar `.10` dos veces → 1 IP. `claim(['.10'], {"name":"GLPI","type":"vm"})` crea el equipo. `claim(['.10'], {"name":"glpi","type":"otro"})` reutiliza el mismo id (count de equipos 1). `claim` con `{"id": otro}` reasigna.
  - `test_release_unassign_note`: `unassign` → `device_id None`; `set_note`; `release` → la IP desaparece y el equipo sigue.
  - `test_update_device_manages_ips`: equipo con `.10,.11`. `update_device(id, {...}, ['.11','.12'])` → `.10` reservada, `.11` sigue, `.12` reclamada y asignada.
  - `test_update_device_rejects_bad_address_atomically`: `update_device(id, {"name":"Nuevo"...}, ['.11','fe80::1'])` lanza `Invalid` y el nombre y las IPs no cambian.
  - `test_device_validation`: nombre vacío, duplicado (`"glpi"` vs `"GLPI"`), tipo desconocido y >120 caracteres → `Invalid`.
  - `test_delete_device_keeps_ips_reserved`.
  - `test_remove_network_keeps_claims`: las IPs reclamadas dentro de la red siguen en `state()["ips"]` y aparecen en `watched_addresses()`.
  - `test_observations_track_last_up`: `record_observations({'.10':True}, t1)` y luego `({'.10':False}, t2)` → `up False`, `checked_at t2`, `last_up_at t1`. Las observaciones no tocan `ips`.

- [ ] **Step 2: Run** `python -m unittest tests.test_store -v`. Expected: FAIL (ImportError / AttributeError).

- [ ] **Step 3: Implement `lanclaim/db.py`.** Tablas: `networks(id, cidr UNIQUE, name, created_at)`, `devices(id, name, name_key UNIQUE, type CHECK(type IN ('vm','fisica','contenedor','otro')), os, note, created_at)`, `ips(id, address UNIQUE, sort_key INTEGER, device_id REFERENCES devices(id) ON DELETE SET NULL, note, claimed_at)` y `observations(address PRIMARY KEY, up INTEGER, checked_at, last_up_at)`. Usar `PRAGMA foreign_keys=ON` y WAL. Para descartar el esquema antiguo, recorrer `sqlite_master` (triggers, índices y tablas no internas) con `DROP` dentro de una transacción. Conservar los helpers `connect()`/`transaction()` del archivo actual.

- [ ] **Step 4: Run** `python -m unittest tests.test_store -v`. Expected: PASS. Borrar los cuatro tests antiguos de dominio.

- [ ] **Step 5: Commit** `feat: new minimal IP inventory store (schema v5)`

### Task 2: Escáner periódico

**Files:**
- Rewrite: `lanclaim/scanner.py` (conservar `ping()` y sus constantes de error tal cual)
- Rewrite: `tests/test_scanner.py`

**Interfaces:**
- Consumes: `Store.watched_addresses()`, `Store.record_observations()`, `Invalid`, `now()`.
- Produces: `Scanner(store, probe=ping, interval=300, workers=32)` con:
  - `start()`: arranca el hilo daemon si `interval > 0` y hace el primer ciclo enseguida.
  - `scan_now() -> dict`: lanza un ciclo inmediato en otro hilo si no hay uno corriendo.
  - `status() -> dict`: `{"running":bool,"total":int,"done":int,"finished_at":str|None,"error":str}`.
  - `close()`.
  - Cada ciclo guarda los resultados con `record_observations` en lotes. Si `probe` lanza `Invalid`, el mensaje va a `error`, el ciclo termina y el siguiente lo reintenta. `error` se limpia tras un ciclo correcto.

- [ ] **Step 1: Write failing tests** (con `probe` falso, sin ping real)
  - `test_cycle_records_all_watched`: red /29 → 6 direcciones sondeadas y `status()["done"] == 6`. Observaciones según el `probe` falso.
  - `test_scan_now_does_not_overlap`: con un `probe` bloqueado por un `Event`, dos `scan_now()` → un solo ciclo.
  - `test_probe_error_is_reported_and_loop_survives`: el `probe` lanza `Invalid(PING_PERMISSION_ERROR)`. `status()["error"]` contiene el mensaje. El siguiente `scan_now()` con un `probe` sano limpia el error.
  - `test_interval_zero_disables_loop`: `start()` con `interval=0` no crea hilo y `scan_now()` sigue funcionando.
  - Conservar los tests actuales de `ping()` (parseo Windows TTL, errores de permisos) que sigan aplicando.

- [ ] **Step 2: Run** `python -m unittest tests.test_scanner -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Usar `ThreadPoolExecutor(max_workers=workers)` y un `threading.Event` para el sleep interrumpible del bucle.
- [ ] **Step 4: Run** `python -m unittest tests.test_scanner -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: periodic background ping of watched addresses`

### Task 3: Servidor HTTP

**Files:**
- Modify: `lanclaim/server.py` (conservar `Server.__init__` de hosts permitidos, `trusted_request`, `send`, la lectura de cuerpo POST y `main()`; reescribir el routing)
- Modify: `lanclaim/__init__.py` (`__version__ = "2.0.0"`)
- Rewrite: `tests/test_http.py`

**Interfaces:**
- Consumes: `Store`, `Scanner`, `local_networks()`.
- Produces (todas las respuestas son JSON):
  - `GET /api/health` → `{"ok":true,"version":...}`.
  - `GET /api/state` → `{**store.state(), "scan": scanner.status(), "csrf":..., "version":...}`.
  - `GET /api/suggestions` → `{"networks": local_networks()}`.
  - `POST /api/<recurso>/<acción>` → mismo cuerpo que `GET /api/state`, para que la UI reemplace su estado:
    - `networks/add {cidr,name}`, `networks/rename {id,name}`, `networks/remove {id}`
    - `ips/claim {addresses, device?}`, `ips/release {addresses}`, `ips/unassign {addresses}`, `ips/note {address,note}`
    - `devices/create {name,type,os,note,addresses}`, `devices/update {id,name,type,os,note,addresses}`, `devices/delete {id}`
    - `scan/now {}`
  - Un `Invalid` devuelve 400 `{"error": msg}`. Cualquier otro error, 500 con el mensaje genérico actual.
  - Estáticos: `/` → `index.html`. Cualquier otra ruta bajo `/css/`, `/js/` o `/favicon.svg` se resuelve dentro de `STATIC` (con `resolve()` y verificación de que no se sale de esa carpeta), solo con extensiones `.html .css .js .svg`. Cualquier otra cosa da 404.
  - `main()`: añadir `--scan-interval` (por defecto `LANCLAIM_SCAN_INTERVAL` o 300) y llamar a `scanner.start()` después de crear el servidor.

- [ ] **Step 1: Write failing tests** (con la forma de `tests/test_http.py` actual; el servidor se construye con un `Scanner` cuyo `probe` es falso e `interval=0`)
  - `test_serves_shell_and_modules`: `/` es 200 y contiene `<script type="module" src="/js/main.js">`. `/js/model.js` tiene `Content-Type` `text/javascript`. `/js/package.json`, `/../db.py` y `/js/%2e%2e/x` dan 404.
  - `test_security_headers_and_csrf`: CSP con `frame-ancestors 'none'`; POST sin token → 403; Host ajeno → 403.
  - `test_mutation_returns_state`: `POST /api/ips/claim {"addresses":"192.168.1.10","device":{"name":"glpi","type":"vm"}}` → 200 con `ips[0].device_id == devices[0].id`.
  - `test_invalid_is_400`: `networks/add {"cidr":"10.0.0.0/8"}` → 400 con `error` en español.
  - `test_unknown_route_404`.
- [ ] **Step 2: Run** `python -m unittest tests.test_http -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Despachar con un dict `{(recurso, acción): callable(data)}`.
- [ ] **Step 4: Run** `python -m unittest discover -s tests -v`. Expected: PASS (incluido `test_networks`).
- [ ] **Step 5: Commit** `feat: resource API returning full state; static module serving`

### Task 4: Frontend — base (model, ui, i18n, api)

**Files:**
- Create: `lanclaim/static/js/package.json`, `model.js`, `ui.js`, `i18n.js`, `api.js`
- Create: `tests/test_model.mjs`, `tests/test_i18n.mjs`
- Delete: `lanclaim/static/app.js`, `lanclaim/static/i18n.js`, `tests/test_i18n.cjs`

**Interfaces:**
- `model.js` (puro, sin DOM). Entrada: `state` tal como lo da `/api/state`. Se recomienda un índice cacheado por objeto `state` con `WeakMap`.
  - `ipStatus(state, address) -> 'use'|'res'|'occ'|'free'`
  - `pingInfo(state, address, nowMs) -> {up:bool|null, recent:bool, lastUpAgoMin:number|null}` (`recent` = `last_up_at` dentro de 7 días)
  - `networkHosts(cidr) -> string[]` (todas las direcciones, incluidas red y broadcast, en orden) y `isEdge(cidr, address) -> bool`
  - `outsideIps(state) -> ip[]`: reclamadas fuera de toda red
  - `counts(state, cidr) -> {use,res,occ,free}`, excluyendo los bordes
  - `suggestIp(state, cidr, nowMs) -> {address, reason:'reserved'|'free'} | null`: primero reservadas, después libres sin `recent`, en orden numérico
  - `deviceIps(state, deviceId) -> string[]` (orden numérico) y `findDeviceByName(state, name)` (sin distinguir mayúsculas)
  - `matches(state, address, query) -> bool`: por IP, nombre de equipo o nota
  - `agoText(min) -> string` vía `t()`: "hace 5 min" / "hace 3 h" / "hace 2 días"
- `ui.js`:
  - `el(tag, attrs, ...children)`: los hijos string van como texto, `on*` como listener y `false/null` se ignoran
  - `toast(msg, kind='ok'|'error')`
  - `confirmButton({key, label, sureLabel, onConfirm, className})`: dos pasos; el estado armado vive en un `Set` del módulo y se resetea con `resetConfirms()`
  - `deviceInput(state, idPrefix) -> {node, read(): {id}|{name,type}|null}`: datalist de equipos; si el nombre es nuevo, muestra un `select` de tipo y la pista "Se creará el equipo “X”"
- `i18n.js`: `t(es: string, vars?: object) -> string` (interpola `{n}`); `setLang('es'|'en')`, `lang()` y `TYPES_LABEL` vía `t`. El idioma se guarda en `localStorage` (con try/catch).
- `api.js`: `load() -> Promise<state>` y `post(path, body) -> Promise<state>`. Guarda el `csrf` del último estado. En un 403 recarga el estado y reintenta una vez. En un error lanza `Error(msg)` con el mensaje del servidor.

- [ ] **Step 1: Write failing tests**
  - `tests/test_model.mjs` (`node:assert/strict`, importa `../lanclaim/static/js/model.js`). Usar un estado fijo con red `192.168.1.0/24`: equipo glpi en `.30`, reservada `.43`, `.7` observada up, `.88` con `last_up_at` de hace 2 días, `.9` con `last_up_at` de hace 10 días.
    - `ipStatus` → `.30` es `use`, `.43` `res`, `.7` `occ`, `.88` `free`.
    - `pingInfo(.88).recent === true` y `pingInfo(.9).recent === false`.
    - `networkHosts('10.0.0.0/30').length === 4` y `isEdge` es true en `.0` y `.3`.
    - `counts` suma 254.
    - `suggestIp` → `.43 reserved`. Sin `.43`, devuelve la primera libre no `recent` y nunca `.88`.
    - `outsideIps` incluye una IP `10.9.9.9` reclamada.
    - `matches(state,'192.168.1.30','GLP')` es true.
  - `tests/test_i18n.mjs`: extraer con regex `t\((['"])(.+?)\1` todas las claves literales de `lanclaim/static/js/*.js` y comprobar que cada una tiene traducción EN no vacía en el diccionario exportado `EN`. Además, `t('hace {n} min',{n:5})` en `en` == `'5 min ago'`.
- [ ] **Step 2: Run** `node tests/test_model.mjs && node tests/test_i18n.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** los cuatro módulos.
- [ ] **Step 4: Run** lo mismo. Expected: PASS.
- [ ] **Step 5: Commit** `feat: frontend model, ui helpers, i18n and api client`

### Task 5: Frontend — vista Red y panel

**Files:**
- Create: `lanclaim/static/index.html` (reescrito), `css/app.css`, `js/map.js`, `js/panel.js`, `js/main.js`
- Delete: `lanclaim/static/style.css`

**Interfaces:**
- Consumes: todo lo de Task 4.
- `main.js`: es dueño de `ui = {view:'red'|'equipos', net: cidr|'outside', sel:Set<string>, filter:null|status, q:'', typeFilter:null, editDev:null|id|'new'}` y de `state`. Exporta `render()`, `act(path, body, okMsg)` (llama a `post`, reemplaza `state`, hace `toast` y `render`) y `goto(address)`. Sincroniza `view`, `net` y la selección con `location.hash` (`#red/192.168.1.0-24/192.168.1.43`, `#equipos`). Refresca `load()` cada 30 s y al volver el foco a la pestaña. Mientras haya un escaneo en curso refresca cada 2 s. Escape limpia la selección y cancela formularios.
- `map.js`: `renderNetworkBar`, `renderSummary`, `renderGrid` y `renderOutsideList`. Cada uno recibe `(root, state, ui)`.
  - Barra: un chip por red, más "Otras (N)" si `outsideIps` no está vacío, el botón "＋ Red" y "✦ Necesito una IP".
  - "＋ Red" abre un formulario en línea con CIDR y nombre. Las sugerencias vienen de `/api/suggestions`, con la red /24 que contiene la IP del servidor como opción por defecto si cabe.
  - Cada chip de red tiene menú "Renombrar / Quitar". Quitar pide confirmación si la red tiene IPs reclamadas.
  - Estado vacío sin redes: tarjeta centrada con las sugerencias como botones.
  - Cuadrícula: redes /22 y /23 se muestran como varios bloques de 256 con encabezado `x.y.z.0/24`. Redes menores que /24 se muestran como cuadrícula parcial. Las celdas de borde no son seleccionables.
  - Selección: clic, Shift/Ctrl+clic, arrastre, y el botón táctil "Seleccionar varias" visible solo con `(pointer: coarse)`.
  - Barra inferior con información al pasar el ratón, la leyenda y "Último ping hace X · ↻ Escanear ahora". Mientras escanea muestra progreso `done/total`. Si hay error de ping, banner ámbar con el mensaje y un botón para cerrarlo.
- `panel.js`: `renderPanel(root, state, ui)` con los estados de la demo: sin selección (lista de reservadas de la red), libre/ocupada, reservada, asignada (con "también …" de otras IPs del equipo, cambiar o quitar equipo, liberar) y selección múltiple (reclamar N, liberar N, asignar N con aviso "N pasarán de X a Y").
  - La nota se guarda al perder el foco solo si cambió.
  - En pantallas de menos de 860 px el panel pasa a ser una hoja inferior fija que se cierra con ×.
- `app.css`: tokens y estilos de `demo.html`, más los estados de foco visibles (`:focus-visible`), `prefers-reduced-motion` y el layout móvil.

- [ ] **Step 1: Implement** `index.html` (header con tabs Red/Equipos, buscador, selector ES/EN, `<main>`, toast; `<script type="module" src="/js/main.js">`), `app.css`, `map.js`, `panel.js` y `main.js`.
- [ ] **Step 2: Run** `node --check` en cada `.js` (con el `package.json` de módulo), `node tests/test_i18n.mjs` y `python -m unittest discover -s tests`. Expected: PASS.
- [ ] **Step 3: Verify in browser.** Arrancar `python -m lanclaim.server --port 8091 --data-dir <scratch>` y, en el panel del navegador:
  - añadir una red;
  - reclamar una IP;
  - reclamar y asignar a "glpi" (nuevo);
  - cambiar de equipo, quitar el equipo y liberar;
  - hacer una selección múltiple y asignarla;
  - pulsar "Necesito una IP" y "Escanear ahora";
  - recargar y comprobar que el hash restaura la red y la selección.

  Sin errores en consola.
- [ ] **Step 4: Commit** `feat: network map view and contextual side panel`

### Task 6: Frontend — vista Equipos

**Files:**
- Create: `lanclaim/static/js/devices.js`
- Modify: `lanclaim/static/js/main.js` (enlazar la vista)

**Interfaces:**
- `renderDevices(root, state, ui)`:
  - Filtro por tipo y búsqueda por nombre, SO o IP.
  - Tarjeta "＋ Nuevo equipo".
  - Tarjetas con nombre, tipo, SO, nota y chips de IP (punto verde o rojo según ping). Un clic en un chip llama a `goto(address)`.
  - Acciones Editar y Eliminar (con confirmación). Al eliminar, el toast dice "X eliminado · sus IPs quedan reservadas".
- `deviceForm(state, device|null)`:
  - Campos nombre, tipo, SO (con datalist de valores ya usados) y nota.
  - Sección **IPs** con chips de las IPs actuales, cada uno con ×.
  - "＋ Añadir IP": desplegable de mis reservadas agrupadas por red, más un input libre para escribir una IP o un rango.
  - Si una IP escrita pertenece a otro equipo, se muestra el aviso "pasará de X a este equipo".
  - Todo se envía en un solo `devices/create` o `devices/update` con la lista final de `addresses`.

- [ ] **Step 1: Implement** `devices.js` y el enlace en `main.js`.
- [ ] **Step 2: Run** `node --check` y `node tests/test_i18n.mjs`. Expected: PASS.
- [ ] **Step 3: Verify in browser:**
  - crear un equipo con una IP reservada y otra escrita;
  - editarlo, quitar una IP (comprobar en el mapa que queda reservada) y añadir otra;
  - eliminar el equipo (sus IPs quedan reservadas);
  - hacer clic en un chip y comprobar que lleva al mapa con la IP seleccionada.
- [ ] **Step 4: Commit** `feat: devices view with in-form IP management`

### Task 7: Linux, documentación y verificación final

**Files:**
- Modify: `install.sh` (añadir `LANCLAIM_SCAN_INTERVAL=300` al heredoc del `.env`), `tests/linux/lifecycle.sh` (reescribir las llamadas a la API con las nuevas rutas: reclamar `10.20.30.10-12`, crear el equipo "Lifecycle test" con `.10`, red `127.0.0.0/30` y `scan/now` para comprobar que `127.0.0.1` responde; las aserciones posteriores usan `state()["ips"]` y `["devices"]`; la migración fallida simulada pasa a `UPDATE devices SET name='BROKEN'`; se eliminan los pasos de retirar y eliminar definitivamente), `.github/workflows/test.yml` (`node --check` sobre `lanclaim/static/js/*.js`, `node tests/test_model.mjs`, `node tests/test_i18n.mjs`)
- Rewrite: `README.md`, `docs/MODELO.md`, `docs/VERIFICACION.md`. Update: `docs/OPERACION.md` (versión 2.0.0, variable de escaneo, aviso de que actualizar desde 0.x empieza con el inventario vacío). Delete: `docs/PLAN.md`, `docs/REQUISITOS.md`

- [ ] **Step 1: Apply the edits above.**
- [ ] **Step 2: Run** `python -m unittest discover -s tests -v`, `node tests/test_model.mjs`, `node tests/test_i18n.mjs` y `bash -n install.sh update.sh uninstall.sh scripts/common.sh`. Expected: todo PASS.
- [ ] **Step 3: Run** `docker build -f tests/linux/Dockerfile -t lanclaim-lifecycle:test . && docker run --rm lanclaim-lifecycle:test`. Expected: última línea `PASS: ...`.
- [ ] **Step 4: Browser pass on Review Focus:**
  - dos pestañas que cambian la misma IP;
  - un equipo llamado `<b>x</b>` (debe verse literal);
  - quitar una red con IPs reclamadas y comprobar que aparecen en "Otras";
  - vista a 375 px de ancho;
  - cambio de idioma a EN.
- [ ] **Step 5: Commit** `chore: lifecycle test, docs and CI for LanClaim 2`
