"use strict";
// Translate source literals only. Values entered by users are never translated.
const language = (() => {
  try {
    return localStorage.getItem("lanclaim.language") === "en" ? "en" : "es";
  } catch {
    return "es";
  }
})();
const english = {
  "Tu infraestructura, en orden.": "Your infrastructure, organized.",
  "Espacio personal": "Personal workspace",
  "Inventario local": "Local inventory",
  ADMINISTRAR: "WORKSPACE",
  "Mi espacio de IPs": "My IP space",
  "Mi red": "My network",
  Máquinas: "Machines",
  Historial: "History",
  "Tus IPs se quedan contigo.": "Your IPs stay with you.",
  "Libera una asignación y conserva la dirección para tu siguiente máquina.":
    "Release an assignment and keep the address for your next machine.",
  Autoalojado: "Self-hosted",
  "Datos alojados en tu servidor": "Data stored on your server",
  "ESPACIO DE IPS": "IP SPACE",
  "MI RED": "MY NETWORK",
  MÁQUINAS: "MACHINES",
  HISTORIAL: "HISTORY",
  Actualizar: "Refresh",
  "UN LUGAR PARA CADA DIRECCIÓN": "A PLACE FOR EVERY ADDRESS",
  "Administra lo que es tuyo. Ten claro qué puedes usar después.":
    "Manage your space. Know what you can use next.",
  "Nueva máquina": "New machine",
  "Reclamar IPs": "Claim IPs",
  "Resumen del inventario": "Inventory overview",
  "Cargando tu espacio…": "Loading your workspace…",
  "La disponibilidad es administrativa. Una máquina apagada conserva su IP.":
    "Availability is administrative. An offline machine keeps its IP.",
  "Navegación principal": "Main navigation",
  Cerrar: "Close",
  Idioma: "Language",
  Disponible: "Available",
  Planificada: "Planned",
  Asignada: "Assigned",
  "Pendiente de revisión": "Needs review",
  Activa: "Active",
  "En reinstalación": "Reinstalling",
  Retirada: "Retired",
  "IP reclamada": "IP claimed",
  "Máquina registrada": "Machine registered",
  "Ficha actualizada": "Machine updated",
  "IP asignada": "IP assigned",
  "IP liberada": "IP released",
  "IP planificada": "IP planned",
  "Plan ejecutado": "Plan executed",
  "Plan cancelado": "Plan cancelled",
  "Revisión abierta": "Review opened",
  "Revisión resuelta": "Review resolved",
  "Máquina retirada": "Machine retired",
  "Reinstalación iniciada": "Reinstallation started",
  "Reinstalación finalizada": "Reinstallation completed",
  "Máquina reactivada": "Machine reactivated",
  "Notas actualizadas": "Notes updated",
  "Sistema operativo": "Operating system",
  "Plataforma de virtualización": "Virtualization platform",
  "Identificador de VM": "VM identifier",
  "Dirección MAC": "MAC address",
  Nombre: "Name",
  Descripción: "Description",
  Etiquetas: "Tags",
  Notas: "Notes",
  Actual: "Current",
  Máquina: "Machine",
  "No se pudo completar la operación.": "The operation could not be completed.",
  " Comprueba el servidor y pulsa Actualizar.":
    " Check the server and click Refresh.",
  "No pudimos abrir tu espacio": "We could not open your workspace",
  "Tus datos permanecen en el servidor. Vuelve a intentar la conexión.":
    "Your data remains on the server. Try connecting again.",
  "IPs reclamadas": "Claimed IPs",
  "Tu espacio personal": "Your personal workspace",
  Disponibles: "Available",
  "Listas para asignar": "Ready to assign",
  "Con asignación activa": "Actively assigned",
  "Incluye las que requieren revisión": "Includes assignments under review",
  Planificadas: "Planned",
  "Para lo que viene": "For what comes next",
  "Por revisar": "Needs review",
  "Discrepancias abiertas": "Open discrepancies",
  "Mira las direcciones de tu red y elige cuáles incorporar a tu espacio.":
    "Browse your network addresses and choose which ones to claim.",
  "Mis máquinas": "My machines",
  "Cada equipo, sus direcciones y toda su historia.":
    "Every machine, its addresses and its complete history.",
  "Cada cambio deja una huella. Nada de tu inventario se pierde.":
    "Every change leaves a record. Keep your inventory history.",
  "Filtrar inventario": "Filter inventory",
  "Cargando…": "Loading…",
  "Mostrar direcciones": "Show addresses",
  "Divide esta red en rangos de hasta 4096 IPs":
    "Split this network into ranges of up to 4096 IPs",
  "Redes del servidor:": "Server networks:",
  "Introduce tu subred manualmente. En VM o WSL2 puede ser distinta de la red del equipo desde el que accedes.":
    "Enter your subnet manually. In a VM or WSL2 it may differ from the network of your browsing device.",
  Todas: "All",
  "Sin reclamar": "Unclaimed",
  "En mi espacio": "In my workspace",
  "Buscar dirección…": "Search address…",
  Administrar: "Manage",
  "Selecciona para incorporar": "Select to claim",
  "Reclamar ": "Claim ",
  "Seleccionar IPs sin reclamar de esta página":
    "Select unclaimed IPs on this page",
  "Dirección IP": "IP address",
  "Mi inventario": "My inventory",
  "Máquina / destino": "Machine / destination",
  Acciones: "Actions",
  " direcciones · ": " addresses · ",
  " seleccionadas": " selected",
  Anterior: "Previous",
  "Página ": "Page ",
  " de ": " of ",
  Siguiente: "Next",
  "Sin direcciones con este filtro": "No addresses match this filter",
  "Tu red, dirección por dirección": "Your network, address by address",
  "Cambia el filtro para ver otras direcciones.":
    "Change the filter to see other addresses.",
  "Introduce una subred o elige una de las redes detectadas en el servidor para empezar.":
    "Enter a subnet or choose a network detected on the server to get started.",
  "Elige una red o un rango": "Choose a network or range",
  "Lista de direcciones del rango. La presencia de una IP aquí no indica que esté ocupada.":
    "Addresses in this range. An address listed here is not necessarily in use.",
  "Red o rango": "Network or range",
  "192.168.1.0/24 o 192.168.1.10-192.168.1.50":
    "192.168.1.0/24 or 192.168.1.10-192.168.1.50",
  "Hasta 4096 direcciones por consulta. En CIDR se incluyen también los extremos de la red; verifica su uso antes de asignarlos.":
    "Up to 4096 addresses per query. CIDRs include network endpoints; check their intended use before assigning them.",
  "Direcciones de la red": "Network addresses",
  "Selecciona las que quieras administrar. Las ya reclamadas conservan su estado.":
    "Select the addresses you want to manage. Claimed addresses keep their current state.",
  "Reclamar seleccionadas": "Claim selected",
  Reutilizable: "Reusable",
  "Asignación conservada": "Assignment retained",
  "Plan conservado": "Plan retained",
  "Sin sistema registrado": "No OS recorded",
  "Destino previsto": "Planned destination",
  "Sin asignar": "Unassigned",
  Asignadas: "Assigned",
  Reutilizables: "Reusable",
  "Buscar IP, máquina o etiqueta…": "Search IP, machine or tag…",
  Estado: "Status",
  " direcciones en esta vista": " addresses in this view",
  "Asignaciones e historial persistentes": "Persistent assignments and history",
  "Sin resultados en esta vista": "No results in this view",
  "Tu próximo proyecto empieza con una IP":
    "Your next project starts with an IP",
  "Prueba otro filtro o cambia la búsqueda.":
    "Try another filter or change your search.",
  "Añade una dirección o un rango. Puedes mantenerlo disponible, planificarlo o asignarlo cuando quieras.":
    "Add an address or a range. Keep it available, plan it or assign it when you are ready.",
  "Reclamar mis primeras IPs": "Claim my first IPs",
  "Direcciones de mi espacio": "Addresses in my workspace",
  "Reclamar una IP la incorpora a tu inventario; no la ocupa en la red.":
    "Claiming an IP adds it to your inventory; it does not occupy it on the network.",
  " IPs listas para una nueva etapa": " IPs ready for a new purpose",
  "Direcciones liberadas que conservan toda su historia.":
    "Released addresses with their complete history.",
  "Ver IPs": "View IPs",
  "¿Vas a formatear una máquina?": "Reinstalling a machine?",
  "Márcala en reinstalación y conserva sus IPs.":
    "Mark it as reinstalling and keep its IPs.",
  "Ver máquinas": "View machines",
  Activas: "Active",
  Retiradas: "Retired",
  "Buscar nombre, hostname, etiqueta…": "Search name, hostname or tag…",
  "Sistema operativo sin especificar": "Operating system not specified",
  "Plataforma sin especificar": "Platform not specified",
  "Sin IPs asignadas": "No IPs assigned",
  "Sin máquinas en esta vista": "No machines in this view",
  "Dale nombre a tu infraestructura": "Give your infrastructure a name",
  "Registra equipos físicos o virtuales, aunque estén apagados o todavía no tengan IP.":
    "Register physical or virtual machines, even if they are offline or have no IP yet.",
  "Registrar máquina": "Register machine",
  "Inventario de máquinas": "Machine inventory",
  " retiradas · Sus direcciones e historial siguen disponibles.":
    " retired · Their addresses and history remain available.",
  Motivo: "Reason",
  Destino: "Destination",
  "Estado anterior": "Previous state",
  Registro: "Record",
  Asignación: "Assignment",
  "Historial de ": "History of ",
  "Actividad del inventario": "Inventory activity",
  "Ver todo": "View all",
  "Todavía no hay movimientos": "No activity yet",
  "Aquí aparecerá la historia de tu inventario.":
    "Your inventory history will appear here.",
  "Cargar anteriores": "Load earlier",
  "Reclamaciones, cambios, asignaciones y ciclos de vida.":
    "Claims, changes, assignments and lifecycle events.",
  Guardar: "Save",
  Cancelar: "Cancel",
  "Cambio guardado.": "Change saved.",
  "Reclamar direcciones IP": "Claim IP addresses",
  "Direcciones o rangos": "Addresses or ranges",
  "Añade IPs individuales, rangos inclusivos o redes CIDR. Máximo 4096 direcciones por operación. Una red CIDR incluye todas sus direcciones, también los extremos.":
    "Add individual IPs, inclusive ranges or CIDRs. Up to 4096 addresses per operation. A CIDR includes all addresses, including network endpoints.",
  "Ejemplos:": "Examples:",
  "Separa entradas con espacios, comas o saltos de línea.":
    "Separate entries with spaces, commas or line breaks.",
  "Revisar direcciones": "Review addresses",
  "Direcciones incorporadas a tu espacio.":
    "Addresses added to your workspace.",
  " IPs nuevas · ": " new IPs · ",
  " ya estaban reclamadas.": " were already claimed.",
  " … y ": " … and ",
  " más": " more",
  " nuevas · ": " new · ",
  " ya reclamadas": " already claimed",
  "Las existentes conservarán su estado e historial.":
    "Existing addresses will keep their state and history.",
  "Confirmar reclamación": "Confirm claim",
  "Editar máquina": "Edit machine",
  "Registra su identidad una vez. Sus IPs y su historial la acompañarán durante todo su ciclo de vida.":
    "Record its identity once. Its IPs and history stay with it throughout its lifecycle.",
  "Ficha actualizada. Las asignaciones se conservan.":
    "Machine updated. Assignments are preserved.",
  "Asignar a máquina": "Assign to machine",
  Planificar: "Plan",
  "Liberar asignación": "Release assignment",
  "Ejecutar plan": "Execute plan",
  "Cancelar plan": "Cancel plan",
  "Abrir revisión": "Open review",
  "Editar notas": "Edit notes",
  "Asignada a ": "Assigned to ",
  " desde ": " since ",
  "Planificada para ": "Planned for ",
  "Resolver revisión": "Resolve review",
  "Todavía no se ha asignado a ninguna máquina.":
    "No machine has been assigned yet.",
  "Reclamada el ": "Claimed on ",
  ". Esta dirección permanece en tu espacio al liberar su asignación.":
    ". This address stays in your workspace when its assignment is released.",
  "Asignaciones de esta dirección": "Assignments for this address",
  "Movimientos recientes": "Recent activity",
  "Consultar todo el historial": "View complete history",
  "Reinstalar / formatear": "Reinstall / format",
  "Finalizar reinstalación": "Finish reinstallation",
  "Reactivar máquina": "Reactivate machine",
  "Retirar máquina": "Retire machine",
  "Editar ficha": "Edit details",
  "Las IPs siguen asignadas a esta máquina durante el formateo. Al terminar puedes editar el SO, hostname y demás datos sin perder su historia.":
    "IPs remain assigned during reinstallation. Afterwards, update the OS, hostname and other details without losing history.",
  "Esta máquina no tiene IPs asignadas.": "This machine has no assigned IPs.",
  "No hay asignaciones anteriores.": "No previous assignments.",
  "IPs actuales": "Current IPs",
  "Asignaciones anteriores": "Previous assignments",
  "Sin movimientos.": "No activity.",
  "Necesitas una máquina activa": "An active machine is required",
  "Registra una máquina o finaliza su reinstalación para poder asignar ":
    "Register a machine or finish its reinstallation before assigning ",
  "Ejecutar planificación": "Execute plan",
  "Asignar ": "Assign ",
  "Plan para ": "Plan for ",
  "Notas de la asignación": "Assignment notes",
  "Esta IP seguirá asignada aunque el equipo esté apagado.":
    "This IP stays assigned even when the machine is offline.",
  "Selecciona una máquina": "Select a machine",
  "Asignar IP": "Assign IP",
  Confirmar: "Confirm",
  "Motivo o detalle": "Reason or details",
  "Reclamar IPs seleccionadas": "Claim selected IPs",
  "Se incorporarán ": "Your workspace will gain ",
  " direcciones</strong> a tu espacio.": " addresses</strong>.",
  "Quedarán disponibles administrativamente. Reclamar no reserva estas direcciones en el router ni comprueba si otro equipo las usa.":
    "They will be administratively available. Claiming does not reserve addresses on your router or check whether another device uses them.",
  " direcciones incorporadas a tu espacio.":
    " addresses added to your workspace.",
  "Máquina futura o propósito": "Future machine or purpose",
  "Guarda esta dirección para una máquina futura. No estará disponible para otra asignación hasta ejecutar o cancelar el plan.":
    "Keep this address for a future machine. It will not be available for another assignment until the plan is executed or cancelled.",
  "Planificar IP": "Plan IP",
  "Liberar ": "Release ",
  " Seguirá pendiente de revisión hasta resolver sus discrepancias.":
    " It will remain under review until its discrepancies are resolved.",
  " Volverá a estar disponible.": " It will become available again.",
  "Se cerrará la asignación a ": "The assignment will be closed for ",
  ". La dirección permanecerá reclamada y conservará su historial.":
    ". The address stays claimed and keeps its history.",
  "Cancelar planificación": "Cancel plan",
  "La IP seguirá reclamada y quedará disponible si no tiene revisiones abiertas.":
    "The IP stays claimed and becomes available if it has no open reviews.",
  "Revisar ": "Review ",
  "La asignación o planificación existente se conservará. Documenta la posible discrepancia.":
    "The existing assignment or plan will be preserved. Document the possible discrepancy.",
  "Documenta qué verificaste. Resolver esta revisión no modifica la asignación ni cancela planes.":
    "Document what you verified. Resolving this review does not change the assignment or cancel plans.",
  "Notas de ": "Notes for ",
  " pasará a «En reinstalación». Todas sus IPs seguirán asignadas. Esta acción registra tu mantenimiento; no formatea ni apaga el equipo.":
    " will be marked as reinstalling. All its IPs stay assigned. This records maintenance; it does not format or shut down the machine.",
  "Iniciar reinstalación": "Start reinstallation",
  "La máquina volverá a activa con las mismas IPs. Puedes actualizar su SO, hostname y notas con «Editar ficha».":
    "The machine will return to active with the same IPs. Update its OS, hostname and notes using Edit details.",
  "La ficha volverá a activa. Sus asignaciones anteriores seguirán cerradas; podrás asignarle las IPs que estén disponibles.":
    "The machine will become active again. Previous assignments stay closed; you can assign available IPs to it.",
  Reactivar: "Reactivate",
  "Retirar ": "Retire ",
  ninguna: "none",
  "Se liberarán ": "The following will be released: ",
  ". Se conservarán la máquina, las reclamaciones y su historial. Las revisiones abiertas continuarán pendientes. Si solo vas a formatear, utiliza «Reinstalar / formatear» para conservar las asignaciones.":
    ". The machine, claims and history are preserved. Open reviews remain pending. If you are only reinstalling, use Reinstall / format to keep the assignments.",
  "Retirar y liberar IPs": "Retire and release IPs",
  "Inventario actualizado.": "Inventory refreshed.",
  // API validation messages are translated separately from inventory contents.
  "Origen o Host no permitido.": "Origin or host is not allowed.",
  "Sesión de página caducada u origen no permitido. Recarga la página.":
    "Page session expired or origin not allowed. Reload the page.",
  "No se pudieron consultar los datos del servidor.":
    "Could not load data from the server.",
  "La operación no pudo guardarse. No se aplicaron cambios parciales.":
    "The operation could not be saved. No partial changes were made.",
  "Introduce direcciones, rangos o redes CIDR.":
    "Enter IP addresses, ranges or CIDRs.",
  "La operación entra en conflicto con el estado actual. Actualiza e inténtalo de nuevo.":
    "The operation conflicts with the current state. Refresh and try again.",
  "La IP o la máquina no está disponible para asignar.":
    "The IP or machine is not available for assignment.",
  "Solo puedes planificar direcciones disponibles.":
    "Only available addresses can be planned.",
  "La asignación ha cambiado. Actualiza antes de liberar.":
    "The assignment changed. Refresh before releasing it.",
  "Debes ejecutar o cancelar la planificación existente.":
    "Execute or cancel the existing plan first.",
  "La planificación ya no está abierta.": "The plan is no longer open.",
  "El estado actual de la máquina no permite esta acción.":
    "The current machine state does not allow this action.",
  "Las asignaciones cambiaron. Actualiza y revisa las IPs antes de retirar la máquina.":
    "Assignments changed. Refresh and review the IPs before retiring the machine.",
  "Este registro ya está cerrado.": "This record is already closed.",
  "El registro ya no existe. Actualiza la página.":
    "This record no longer exists. Refresh the page.",
  "La MAC debe tener seis pares hexadecimales, por ejemplo AA:BB:CC:DD:EE:FF.":
    "A MAC address must contain six hexadecimal pairs, such as AA:BB:CC:DD:EE:FF.",
  "Campo inválido: ": "Invalid field: ",
  " (máximo ": " (maximum ",
  " caracteres).": " characters).",
  "Completa el campo ": "Complete the field ",
  "Direcciones inválidas: ": "Invalid addresses: ",
  "Rango inválido o superior a 4096 direcciones.":
    "Invalid range or more than 4096 addresses.",
  "Máximo 4096 direcciones por operación.":
    "Up to 4096 addresses per operation.",
  "No se admiten identificadores de zona IPv6.":
    "IPv6 zone identifiers are not supported.",
  "Se esperaba un objeto JSON.": "Expected a JSON object.",
  "Operación desconocida.": "Unknown operation.",
  "Petición vacía o demasiado grande.": "Empty request or request too large.",
  "No encontrado.": "Not found.",
  "Se requiere application/json.": "application/json is required.",
};
Object.assign(english, {
  "Direcciones IP": "IP addresses",
  Red: "Network",
  "Mis IPs": "My IPs",
  Reclamadas: "Claimed",
  "Escanea, revisa y reclama tus direcciones.":
    "Scan, review and claim your addresses.",
  "Tus direcciones, asignaciones y planes.":
    "Your addresses, assignments and plans.",
  "Equipos, direcciones y ciclo de vida.": "Machines, addresses and lifecycle.",
  "Registro de cambios y asignaciones.": "Changes and assignment history.",
  "Una IP sin respuesta no significa que esté disponible.":
    "An IP with no response is not necessarily available.",
  "Red del servidor": "Server network",
  "Elegir red / rango manual": "Choose network / custom range",
  "Escanear red": "Scan network",
  "Ver rango": "View range",
  Conectividad: "Connectivity",
  "Buscar IP…": "Search IP…",
  "Sin comprobar": "Not checked",
  "Sin respuesta": "No response",
  "Sin escaneo en curso": "No scan in progress",
  "Escaneando…": "Scanning…",
  "Deteniendo…": "Stopping…",
  "Escaneo terminado": "Scan completed",
  "Escaneo detenido": "Scan stopped",
  "Error de escaneo": "Scan error",
  activas: "responding",
  Detener: "Stop",
  Administrar: "Manage",
  "Elige tu red para empezar": "Choose your network to start",
  "Escanea para ver qué IPs responden, o abre el rango para reclamarlas.":
    "Scan to see which IPs respond, or view the range to claim them.",
  "Acerca del escaneo": "About scanning",
  "Comprueba respuestas ICMP desde el servidor. Un firewall puede impedirlas. Hasta 1024 IPv4 por escaneo; no modifica tus asignaciones. Los resultados muestran la fecha de la última comprobación.":
    "Checks ICMP responses from the server. Firewalls may block replies. Up to 1024 IPv4 addresses per scan; assignments stay unchanged. Results show the last check time.",
  "En VM o WSL2, elige la red que el servidor puede alcanzar. Ver rango admite hasta 4096 direcciones e incluye los extremos de una subred; el escaneo CIDR omite red y broadcast.":
    "In a VM or WSL2, choose a network reachable from the server. View range supports up to 4096 addresses including subnet endpoints; CIDR scans skip network and broadcast addresses.",
  "El escaneo admite solamente IPv4.": "Scanning supports IPv4 only.",
  "Escanea hasta 1024 direcciones por operación.":
    "Scan up to 1024 addresses per operation.",
  "Selecciona direcciones IPv4 de equipos, sin multicast ni broadcast.":
    "Select IPv4 host addresses, without multicast or broadcast.",
  "No se encontró ping. Instala iputils-ping o iputils en el servidor.":
    "Ping was not found. Install iputils-ping or iputils on the server.",
  "No se pudo ejecutar ping. Revisa los permisos y la red del servidor.":
    "Could not run ping. Check server permissions and networking.",
  "Ya hay un escaneo en curso.": "A scan is already running.",
  "No se pudo guardar el resultado del escaneo.":
    "Could not save the scan result.",
});
Object.assign(english, {
  "Ver IP": "Open IP",
  "Añadir equipo": "Add device",
  "Datos del equipo": "Device details",
  "Cambiar el equipo de esta IP": "Change the device using this IP",
  "¿Qué equipo usa esta IP?": "Which device uses this IP?",
  "Actualiza su ficha. La IP y el historial se conservan.":
    "Update its details. The IP and history are preserved.",
  "Equipo actual": "Current device",
  "El cambio afecta solo a esta IP; las demás asignaciones se conservan.":
    "Only this IP changes; other assignments are preserved.",
  "Escribe un nombre y guarda. El equipo se registrará aquí mismo.":
    "Enter a name and save. The device will be registered here.",
  "Al guardar, la IP quedará reclamada y vinculada al equipo. No se cambia la configuración de red del equipo.":
    "Saving claims this IP and links it to the device. It does not change the device network configuration.",
  "Equipo registrado": "Registered device",
  Equipo: "Device",
  "Registrar uno nuevo": "Register a new device",
  "Elegir uno que ya registré": "Choose an existing device",
  "Nombre del equipo": "Device name",
  "Más datos del equipo (opcional)": "More device details (optional)",
  "Selecciona un equipo": "Select a device",
  "Motivo del cambio": "Reason for the change",
  "Este equipo tiene varias IPs. Los datos de su ficha se actualizan para todas; sus asignaciones se conservan.":
    "This device has several IPs. Its details are shared across them; assignments are preserved.",
  "Guardar datos": "Save details",
  "Guardar cambio de equipo": "Save device change",
  "Guardar IP y equipo": "Save IP and device",
  "IP y equipo guardados.": "IP and device saved.",
  "Editar datos del equipo": "Edit device details",
  "Nombre, sistema operativo y otros datos de este equipo.":
    "Name, operating system and other device details.",
  "Ya terminé de formatear": "Reinstallation is finished",
  "Voy a formatear este equipo": "I am reinstalling this device",
  "Vuelve a activo conservando sus IPs y su historial.":
    "Mark it active again, keeping its IPs and history.",
  "Conserva esta IP y las demás del equipo durante la reinstalación.":
    "Keep this IP and the device’s other IPs during reinstallation.",
  "Dejar esta IP disponible": "Make this IP available",
  "Desvincula el equipo de esta IP. La dirección sigue siendo tuya.":
    "Unlink the device from this IP. The address remains yours.",
  "Esta IP ahora es de otro equipo": "This IP now belongs to another device",
  "Guarda el equipo anterior en el historial y asigna el nuevo.":
    "Keep the previous device in history and assign the new one.",
  "Ya tengo el equipo para esta IP": "The device for this IP is ready",
  "Añadir equipo a esta IP": "Add a device to this IP",
  "Regístralo aquí o elige uno existente, sin salir de la IP.":
    "Register it here or select an existing device, without leaving this IP.",
  "Guardar para más adelante": "Save for later",
  "Reserva esta IP en tu inventario para un uso futuro.":
    "Set this IP aside in your inventory for future use.",
  "Quitar la reserva": "Remove the plan",
  "La IP sigue reclamada y vuelve a estar disponible si no tiene incidencias.":
    "The IP remains claimed and becomes available if it has no open issues.",
  "Reservada para": "Set aside for",
  "Sin equipo asignado": "No device assigned",
  "Puedes completar sus datos cuando quieras.":
    "You can fill in its details whenever you like.",
  "Puedes usarla ahora o guardarla para después.":
    "Use it now or set it aside for later.",
  "Marcar incidencia como resuelta": "Mark issue as resolved",
  "Notas y otras opciones": "Notes and other options",
  "Notas de esta IP": "Notes for this IP",
  "Guarda información útil sobre esta dirección.":
    "Keep useful information about this address.",
  "Hay un problema con esta IP": "There is a problem with this IP",
  "Anota un posible conflicto para revisarlo sin perder la asignación.":
    "Record a possible conflict for review without losing the assignment.",
  "Ya no uso este equipo": "I no longer use this device",
  "Retira el equipo y libera sus": "Retire the device and release its",
  "IPs. Se conservan las direcciones y el historial.":
    "IPs. Addresses and history are preserved.",
  "Historial de esta IP": "History of this IP",
  "Esta IP permanece en tu inventario aunque el equipo esté apagado.":
    "This IP stays in your inventory even when the device is off.",
  "Guardar para después:": "Save for later:",
  "Guardar reserva": "Save plan",
  "¿Para qué la quieres guardar?": "What will you use it for?",
  "Dejar disponible:": "Make available:",
  "Anotar problema:": "Record an issue:",
  "Guardar incidencia": "Save issue",
  "Conservar IPs durante el formateo": "Keep IPs during reinstallation",
  "Guardar solo la IP, sin equipo": "Save just the IP, without a device",
  "Añadir equipo desde una IP": "Add a device from an IP",
  "Abre una IP en Red o Mis IPs y añade su equipo. Aparecerá aquí automáticamente.":
    "Open an IP in Network or My IPs and add its device. It will appear here automatically.",
  "Selecciona una sola IP para registrar su equipo.":
    "Select a single IP to register its device.",
  "Selecciona cómo quieres guardar el equipo de esta IP.":
    "Choose how to save the device for this IP.",
  "El equipo de esta IP cambió. Actualiza antes de guardar.":
    "The device using this IP changed. Refresh before saving.",
  "Esta IP todavía no tiene equipo.": "This IP does not have a device yet.",
  "Ese equipo ya utiliza esta IP. Puedes editar sus datos.":
    "That device already uses this IP. You can edit its details.",
});
Object.assign(english, {
  "Nota (opcional)": "Note (optional)",
  "Nota del cambio (opcional)": "Change note (optional)",
  "Cambio de equipo desde la IP.": "Device changed from the IP page.",
});
const translationPattern = new RegExp(
  Object.keys(english)
    .sort((a, b) => b.length - a.length)
    .map((key) =>
      key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"),
    )
    .join("|"),
  "g",
);
function t(literal) {
  return language === "es"
    ? literal
    : String(literal).replace(
        translationPattern,
        (match) => english[match.replace(/\s+/g, " ")] ?? match,
      );
}
function html(strings, ...values) {
  return strings.reduce(
    (result, literal, i) =>
      result + t(literal) + (i < values.length ? values[i] : ""),
    "",
  );
}
document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.lang = language;
  document.title = t(document.title);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes)
    if (
      !["SCRIPT", "STYLE", "OPTION"].includes(node.parentElement.tagName) &&
      !node.parentElement.closest("#content,#stats,#dialog-body,#toast")
    )
      node.nodeValue = t(node.nodeValue);
  document
    .querySelectorAll("[aria-label],[title],[placeholder]")
    .forEach((element) => {
      for (const attribute of ["aria-label", "title", "placeholder"])
        if (element.hasAttribute(attribute))
          element.setAttribute(attribute, t(element.getAttribute(attribute)));
    });
  const selector = document.querySelector("#language");
  selector.value = language;
  selector.addEventListener("change", () => {
    try {
      localStorage.setItem("lanclaim.language", selector.value);
    } catch {
      return;
    }
    location.reload();
  });
});
