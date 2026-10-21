# LanClaim 2 — Diseño del rework

Fecha: 2026-10-21 · Estado: borrador para aprobación

## 1. Intención

LanClaim es un **inventario personal de IPs**. Sirve para responder rápido a una pregunta concreta: *"voy a instalar una VM nueva, ¿qué IP puedo ocupar?"*. También sirve para llevar la cuenta de qué equipo usa cada una de mis IPs.

La versión actual funciona, pero se siente llena de trabas. Su modelo es de IPAM empresarial: planes, revisiones, ciclo de vida de máquinas (activa/reinstalando/retirada), asignaciones con historial, eventos y borrado anonimizado. Ese modelo obliga a pasar por demasiados conceptos para algo tan simple como "esta IP es mía y la usa GLPI". El rework parte de cero: modelo mínimo e interfaz nueva y visual.

### El flujo real del usuario (sus palabras, resumidas)

1. Mira una red y ve qué IPs responden al ping y cuáles no.
2. Reclama las que le interesan. Desde ese momento son suyas.
3. A cada IP reclamada le asigna un equipo (p. ej. GLPI), o la deja **reservada sin equipo** para una instalación futura.
4. Más tarde, para instalar algo nuevo, busca una IP suya reservada (o una libre de la red) y la ocupa.

**La IP es la entidad principal.** Los equipos son un complemento: un equipo puede tener una o varias IPs.

### Éxito

- Al abrir la app se ve de un vistazo el estado de toda la red: ocupado, libre, mío asignado, mío reservado.
- Hacer "reclamar esta IP", "asignarla a X" o "liberarla" lleva uno o dos clics, sin pasar por pantallas ni conceptos intermedios.
- La pregunta "¿qué IP uso para la VM nueva?" se responde en segundos.

## 2. Objetivos, no-objetivos y anti-objetivos

**Objetivos**
- Mapa visual por red (cuadrícula), como vista principal.
- Vista de equipos con sus IPs.
- Ping automático periódico de las redes registradas, más un escaneo manual inmediato.
- Seguir siendo autoalojado, sin dependencias de Python y con instalación en Linux mediante los scripts existentes.

**No-objetivos (se eliminan)**
- Planes, revisiones/discrepancias, ciclo de vida de máquinas (reinstalación, retirada, reactivación), historial de eventos y vista de historial.
- Relación anfitrión/invitado ("VM dentro de proxmox-01").
- IPv6.
- Usuarios, autenticación y multiusuario. Sigue siendo un único usuario en red de confianza.
- Migrar datos de la versión anterior.
- Grupos con nombre. La organización es **por red**: cada red registrada es "un grupo" (ver §4).

**Anti-objetivos (sería un fracaso aunque funcione)**
- Que reaparezcan textos aclaratorios por todas partes o confirmaciones para acciones reversibles.
- Que el ping cambie por sí solo lo que es mío. La propiedad solo cambia por acción del usuario.
- Que para asignar una IP haya que crear antes el equipo en otra pantalla.
- Que una IP que no responde se muestre como "libre" sin matices cuando sí respondió hace poco (VM apagada).

## 3. Modelo

### Entidades

| Entidad | Campos |
| --- | --- |
| **Red** | id, cidr (IPv4, de /22 a /30), nombre opcional (p. ej. "Casa", "Lab"), creada_en |
| **IP reclamada** | id, dirección (IPv4 canónica, única), equipo_id (opcional), nota, reclamada_en |
| **Equipo** | id, nombre (obligatorio, único sin distinguir mayúsculas), tipo (`vm`, `fisica`, `contenedor`, `otro`), so (texto libre con autocompletado de valores ya usados), nota, creado_en |
| **Observación** | dirección (puede no estar reclamada), último_resultado (`responde`/`no_responde`), comprobada_en, última_respuesta_en (la última vez que respondió, nunca se borra) |

Una IP reclamada puede pertenecer a una red registrada o no. Si no pertenece a ninguna (por ejemplo, porque se quitó su red o se escribió a mano al crear un equipo), aparece en el chip **Otras** de la barra de redes (ver §4.1).

Las redes registradas **no pueden solaparse**: añadir una red que se solape con otra ya registrada se rechaza con un mensaje claro. Así cada IP aparece en un solo mapa y cuenta una sola vez para el límite de escaneo.

### Estados de una dirección (derivados, no almacenados)

| Estado | Condición | Color |
| --- | --- | --- |
| **Asignada** | Reclamada y con equipo | verde |
| **Reservada** | Reclamada sin equipo | azul, solo contorno |
| **Ocupada** | No reclamada y respondió en el último escaneo | ámbar |
| **Libre** | No reclamada y no responde | gris tenue |
| **Sin datos** | No reclamada y nunca escaneada | gris aún más tenue |

Además, como **señal secundaria** (un punto pequeño en la celda):
- En IP **asignada**: el punto indica si el equipo responde o no. Sirve para ver de un vistazo qué está apagado.
- En IP **libre** que respondió en el pasado: una marca "vista hace X". Así no se confunde una VM apagada con una IP libre.

La dirección de red y la de broadcast (en prefijos < /31) se muestran como celdas no seleccionables.

### Operaciones

| Operación | Efecto |
| --- | --- |
| Reclamar (una o varias) | La IP pasa a reservada. Si ya era mía, no cambia nada. |
| Asignar a equipo | Se elige un equipo existente o se escribe un nombre nuevo, y el equipo se crea en el mismo paso. La IP queda asignada. |
| Quitar equipo | La IP vuelve a reservada (sigue siendo mía). |
| Liberar | Deja de ser mía. Se borra el registro de la IP; el equipo y sus otras IPs no cambian. |
| Editar equipo | Nombre, tipo, SO, nota. |
| Eliminar equipo | Sus IPs quedan **reservadas** (siguen siendo mías). Pide una sola confirmación. |
| Añadir/quitar red | Quitar una red no borra las IPs reclamadas dentro de ella. |

Sin historial: lo que se borra, se borra. Solo piden confirmación las acciones que pierden información (liberar una IP con equipo o nota, eliminar un equipo, liberar varias a la vez).

## 4. Interfaz

Diseño oscuro y cuidado, en la línea del mockup elegido (opción A). La navegación superior tiene dos secciones: **Red** y **Equipos**. ES/EN se mantiene.

### 4.1 Red (vista principal)

- **Barra de redes**: un chip por red registrada (`192.168.1.0/24 · Casa`), más un botón **＋** para añadir otra. Al añadir se sugieren las subredes de las interfaces del servidor o se escribe un CIDR. Con 0 redes registradas, la pantalla vacía invita a añadir la primera y muestra las sugerencias. Si hay IPs reclamadas fuera de toda red registrada, aparece además un chip **Otras (N)**. Ese chip muestra esas IPs como una lista compacta (no como cuadrícula), con el mismo panel lateral y las mismas acciones. Los chips de Equipos que apunten a esas IPs llevan ahí. "Necesito una IP" no las considera.
- **Resumen** de la red activa: `N asignadas · N reservadas · N ocupadas · N libres`. Cada contador funciona como filtro y resalta esas celdas.
- **Cuadrícula** de 16 columnas, una celda por dirección, con el último octeto visible. En una /24 son 256 celdas. Redes /23 y /22 se muestran como bloques /24 apilados con su encabezado; redes menores de /24, como cuadrícula parcial. En las celdas asignadas, el tooltip y el panel muestran el nombre del equipo.
- **Buscador** que resalta celdas por IP, nombre de equipo o nota.
- **Selección**: clic en una celda selecciona una. Shift+clic o arrastrar selecciona varias, para reclamar o liberar en lote. En pantallas táctiles hay un botón **Seleccionar varias** que activa un modo en el que cada toque añade o quita celdas.
- **Panel lateral** de la celda seleccionada, con acciones que dependen del estado:
  - Libre / ocupada / sin datos: **Reclamar** y **Reclamar y asignar…** (campo de equipo con autocompletado o nombre nuevo). Si la IP está ocupada, el panel lo dice ("responde al ping, alguien la usa") pero no bloquea la acción.
  - Reservada: **Asignar a equipo**, nota editable y **Liberar**.
  - Asignada: equipo (enlace), tipo/SO, nota editable, estado de ping y "vista hace X", **Cambiar equipo**, **Quitar equipo** y **Liberar**.
  - Varias seleccionadas: **Reclamar N**, **Liberar N** (solo mías) y **Asignar N a equipo**. Este último, igual que "Reclamar y asignar" con una sola IP, reclama en el mismo paso las que todavía no son mías. Si alguna ya estaba asignada a otro equipo, la reasigna, y el panel lo avisa antes de confirmar ("2 pasarán de GLPI a nas-01").
- **Botón "Necesito una IP"**: lleva al panel la primera IP **reservada** de la red activa. Si no hay ninguna, propone la primera **libre** sin respuesta reciente. Responde directamente a la pregunta del caso de uso.
- **Escaneo**: indicador "último escaneo hace 2 min" y botón **Escanear ahora**, con progreso mientras corre.

### 4.2 Equipos

- Tarjetas (como el mockup C): nombre, tipo, SO y chips con sus IPs. El punto en cada chip indica si responde. Al hacer clic en un chip se va a esa IP en el mapa.
- Buscador y filtro por tipo.
- **＋ Nuevo equipo**: el formulario permite darle IPs desde una lista de mis IPs reservadas, o escribir una IP o rango para reclamarla en el acto.
- La edición se hace en la propia tarjeta o en un panel. Eliminar desde ahí.
- **Gestionar IPs al editar un equipo** (pedido por el usuario tras la demo):
  - Cada IP del equipo aparece como chip con una **×**. Quitarla devuelve la IP a reservada, sin liberarla.
  - Un selector **＋ Añadir IP** lista mis IPs reservadas, agrupadas por red, para añadirlas con un clic. También se puede escribir una IP: si no está reclamada, se reclama en el acto.
  - Si la IP escrita ya está asignada a otro equipo, se avisa antes de moverla.
  - Los cambios de IPs se aplican al guardar el formulario, junto con el resto de campos, en una sola operación.

### 4.3 Comportamiento general

- Los cambios se guardan al confirmar en el panel, sin pantallas intermedias.
- Al recargar se conservan la red activa, la vista, el filtro y la IP seleccionada (en la URL/hash).
- Avisos breves (toast) para confirmar y para errores. Las explicaciones largas se eliminan.
- Tiene que funcionar en el móvil: allí el panel lateral pasa a hoja inferior y la cuadrícula se mantiene en 16 columnas, con celdas más pequeñas y sin número.

## 5. Escaneo automático

- Un hilo en el servidor hace ping a todas las direcciones de todas las redes registradas cada **5 minutos** (configurable con `LANCLAIM_SCAN_INTERVAL`, en segundos; `0` lo desactiva). Las IPs reclamadas fuera de redes registradas también se incluyen.
- Concurrencia limitada (32 pings simultáneos, timeout de 1 s). Total máximo de direcciones vigiladas: 4096. Una red que supere el límite no se puede registrar.
- **Escanear ahora** lanza un ciclo inmediato de la red activa. Si ya hay uno en curso, no lanza otro.
- Se reutiliza la lógica de ping actual (`scanner.py`): Linux/Windows, `CAP_NET_RAW` y mensajes de error de permisos. Si ping falla por permisos, la UI lo muestra una vez de forma clara y el mapa sigue funcionando sin datos de ping.
- El escaneo nunca modifica IPs reclamadas ni equipos.

## 6. Arquitectura y decisiones técnicas

- **Backend**: Python 3.10+ solo con la biblioteca estándar y `http.server` (como ahora). Se mantienen las protecciones actuales: comprobación de Host/Origin, CSRF y CSP estricta. La API es JSON y simple, con recursos (`/api/networks`, `/api/ips`, `/api/devices`, `/api/scan`) en lugar del `/api/commands/<acción>` genérico. `GET /api/state` devuelve todo lo necesario para pintar (redes, IPs, equipos, observaciones de las redes registradas) para que la UI haga una sola carga.
- **Frontend**: JS vanilla sin paso de build, reescrito desde cero y dividido en módulos ES (`<script type="module">`): estado/API, vista Red, vista Equipos, panel, i18n. CSS nuevo con tokens. Objetivo de tamaño: una fracción del actual (~1800 líneas de JS y ~1600 de CSS).
- **Datos**: SQLite con un esquema nuevo en el mismo archivo `lanclaim.sqlite3`. **No se conserva nada de la versión anterior** (decisión del usuario). Al arrancar, si el archivo tiene el esquema antiguo (`user_version` ≤ 4), se descarta y se crea vacío. No hay migración. La copia previa que `update.sh` ya hace antes de actualizar sigue existiendo, pero la app no la usa.
- **Scripts de Linux** (`install.sh`, `update.sh`, `uninstall.sh`, `scripts/common.sh`): **se conservan (requisito explícito del usuario)**, con los ajustes mínimos: la nueva variable `LANCLAIM_SCAN_INTERVAL` en el `.env` generado y lo que cambie en la verificación del servicio. El archivo de base de datos mantiene su nombre, así que el respaldo y la restauración de `update.sh` siguen igual.
- **Se eliminan**: `/api/history`, el modelo de eventos, planes, revisiones y ciclo de vida, y la documentación que los describe (`docs/MODELO.md`, `REQUISITOS.md` y `PLAN.md` se reescriben para el nuevo modelo).
- **Tests**: se reescriben para el nuevo modelo (dominio, HTTP, escáner e i18n). El test de ciclo de vida Linux en Docker se mantiene y se ajusta al nuevo archivo de datos.
- `.superpowers/` se añade a `.gitignore`.

## 7. Decisiones que tomé yo (revisables)

- Sin grupos con nombre: la red registrada, con nombre opcional, cumple esa función.
- Equipo con solo nombre, tipo, SO y nota. Sin MAC, hostname ni ID de VM.
- Liberar borra la IP sin dejar historial.
- Eliminar un equipo deja sus IPs reservadas, no liberadas.
- Ping automático cada 5 minutos, activado por defecto.
- Solo IPv4. Redes de /22 a /30.
- Botón "Necesito una IP": primero prioriza mis reservadas y después las libres sin respuesta reciente. "Reciente" son 7 días.
- Redes registradas sin solapamiento.
- IPs fuera de toda red: chip "Otras" en forma de lista.
- "Asignar N a equipo" reclama las no reclamadas y reasigna con aviso.
- Multiselección táctil mediante un modo "Seleccionar varias".
- Se mantiene ES/EN.

## 8. Libre para quien construya

Paleta exacta, tipografía, iconos, animaciones, estructura interna de módulos JS, rutas exactas y forma de la API, nombres de tablas y columnas, y estrategia de tests, siempre que respeten lo anterior.
