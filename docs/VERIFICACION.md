# Verificación de LanClaim 2

## Pruebas automáticas

- **Python (`python -m unittest discover -s tests`)**:
  - almacén: esquema v5, descarte de bases antiguas, validación de direcciones y redes, solapamientos, límite de 4096, reclamar/reasignar, liberar, notas, equipos con gestión de IPs atómica, y observaciones que no tocan el inventario;
  - escáner periódico: ciclo completo, sin solapamiento, errores de ping visibles y recuperables, intervalo 0, ping de Linux/Windows y errores de permisos;
  - API HTTP: estáticos con lista blanca, CSP, CSRF, Host/Origin, rutas de recursos que devuelven el estado y escaneo al añadir una red;
  - interfaces de red.
- **Node**:
  - `tests/test_model.mjs`: estados, ping reciente, hosts y bordes de red, recuentos, sugerencia de IP, IPs fuera de red y búsqueda;
  - `tests/test_i18n.mjs`: todo texto pasado a `t()` tiene traducción al inglés.
- **Linux en contenedor** (`tests/linux`): Ubuntu 24.04 con el servidor real y el UID del servicio. Cubre instalación, repetición, ping de loopback como servicio (con solo `CAP_NET_RAW`), actualización, fallo simulado de una versión que modifica la base con recuperación de código y datos, desinstalación conservando datos, reinstalación, borrado de un equipo conservando sus IPs y cancelación/confirmación de purga. Pasa con `ping_group_range` normal y restringido (`1 0`).

## Navegador (Windows, inventario aislado)

- Primer uso y alta de red con sugerencias del servidor. Escaneo inmediato con barra de progreso.
- Panel lateral:
  - reclamar;
  - reclamar y asignar a un equipo nuevo;
  - selección por arrastre y reclamación en lote;
  - «Necesito una IP» sobre reservadas;
  - nota con autoguardado durante un escaneo, sin perder el foco.
- Un nombre de equipo `<b>x</b>` se muestra literal.
- Equipos:
  - añadir una IP reservada desde el desplegable;
  - escribir una IP de otro equipo, con aviso de que se moverá;
  - quitar una IP, que vuelve a reservada;
  - guardar y eliminar con confirmación;
  - un clic en una IP lleva al mapa con esa IP seleccionada.
- Recarga con el hash `#red/<red>/<ip>`: restaura la red y la selección.

## Límites

- El adaptador de servicio del contenedor no reproduce systemd completo. No se ha certificado una matriz de distribuciones ni de navegadores móviles.
- Un firewall puede bloquear ICMP: el ping no detecta todos los equipos y una IP silenciosa no está garantizada como libre.
- Los tests usan rangos y nombres de prueba, nunca datos reales de infraestructura.
