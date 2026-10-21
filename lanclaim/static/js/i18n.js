// Textos en español como clave; traducción al inglés en EN.
const KEY = "lanclaim.lang";
let current = "es";
try {
  if (globalThis.localStorage && globalThis.localStorage.getItem(KEY) === "en") current = "en";
} catch {
  /* sin almacenamiento: español */
}

export const EN = {
  // Tiempo
  "ahora": "just now",
  "hace {n} min": "{n} min ago",
  "hace {n} h": "{n} h ago",
  "hace 1 día": "1 day ago",
  "hace {n} días": "{n} days ago",
  // Estados
  "Asignada": "Assigned",
  "Reservada": "Reserved",
  "Ocupada por otro": "Used by someone else",
  "Libre": "Free",
  // Tipos
  "VM": "VM",
  "Física": "Physical",
  "Contenedor": "Container",
  "Otro": "Other",
  // API
  "No se pudo conectar con el servidor.": "Could not reach the server.",
  "La operación falló.": "The operation failed.",
  // Equipo
  "Nombre del equipo (existente o nuevo)": "Device name (existing or new)",
  "Se asignará a {name}": "Will be assigned to {name}",
  "Se creará el equipo “{name}”": "Device “{name}” will be created",
  "Tipo": "Type",
  // General
  "Red": "Network",
  "Equipos": "Devices",
  "Buscar IP, equipo o nota…": "Search IP, device or note…",
  "Buscar equipo, SO o IP…": "Search device, OS or IP…",
  "No se pudo cargar LanClaim": "LanClaim could not load",
  "Reintentar": "Retry",
  "Tienes cambios sin guardar. Pulsa Cancelar para descartarlos.": "You have unsaved changes. Press Cancel to discard them.",
  "Guardar": "Save",
  "Cancelar": "Cancel",
  "Cerrar": "Close",
  "Detalles": "Details",
  // Redes
  "Redes": "Networks",
  "Editar red": "Edit network",
  "IPs reclamadas fuera de tus redes": "Claimed IPs outside your networks",
  "Otras": "Other",
  "Selección múltiple activa": "Multi-select on",
  "Seleccionar varias": "Select several",
  "Necesito una IP": "I need an IP",
  "No quedan IPs libres en esta red.": "No free IPs left in this network.",
  "Te sugiero {ip}: es tuya y está reservada.": "Try {ip}: it is yours and reserved.",
  "Te sugiero {ip}: libre y nadie respondió en 7 días.": "Try {ip}: free and nobody answered in 7 days.",
  "Red (CIDR)": "Network (CIDR)",
  "Nombre (opcional), p. ej. Casa": "Name (optional), e.g. Home",
  "Nombre de la red": "Network name",
  "Red guardada": "Network saved",
  "Red añadida": "Network added",
  "Editar red {cidr}": "Edit network {cidr}",
  "Añadir una red": "Add a network",
  "Añadir red": "Add network",
  "De /22 a /30. No puede solaparse con otra red.": "From /22 to /30. It cannot overlap another network.",
  "Red quitada · sus IPs siguen en «Otras»": "Network removed · its IPs are now under “Other”",
  "Red quitada": "Network removed",
  "Quitar red": "Remove network",
  "¿Quitar? {n} IPs tuyas pasan a «Otras»": "Remove? {n} of your IPs move to “Other”",
  "Redes de este servidor:": "This server’s networks:",
  "Tu inventario de IPs": "Your IP inventory",
  "Añade la red que quieres organizar. Verás cada IP en un mapa: qué está ocupado, qué es tuyo y qué está libre.":
    "Add the network you want to organise. You will see every IP on a map: what is taken, what is yours and what is free.",
  // Resumen y escaneo
  "asignadas": "assigned",
  "reservadas": "reserved",
  "ocupadas por otros": "used by others",
  "libres": "free",
  "Quitar filtro": "Clear filter",
  "{a} asignadas, {b} reservadas, {c} ocupadas, {d} libres": "{a} assigned, {b} reserved, {c} used by others, {d} free",
  "Resaltar en el mapa": "Highlight on the map",
  "IPs tuyas que no pertenecen a ninguna red registrada. Puedes asignarlas o liberarlas igual que en el mapa.":
    "Your IPs that do not belong to any registered network. You can assign or release them just like on the map.",
  "Escaneando… {done}/{total}": "Scanning… {done}/{total}",
  "Aún sin ping": "No ping yet",
  "Último ping {ago}": "Last ping {ago}",
  "Escaneo iniciado": "Scan started",
  "Escanear ahora": "Scan now",
  "El ping no funciona: ": "Ping is not working: ",
  "El inventario sigue funcionando sin datos de ping.": "The inventory keeps working without ping data.",
  "Cerrar aviso": "Dismiss",
  // Mapa
  "Dirección de red": "Network address",
  "Broadcast": "Broadcast",
  "Mapa de {cidr}": "Map of {cidr}",
  "Pasa el ratón por una IP para ver detalles.": "Hover an IP to see details.",
  "equipo responde": "device answers",
  "no responde": "no answer",
  "respondió hace poco": "answered recently",
  "sin datos de ping": "no ping data",
  "Shift+clic o arrastra para elegir varias": "Shift+click or drag to pick several",
  "reservada": "reserved",
  "responde, alguien la usa": "answers, someone uses it",
  "libre · respondió {ago}": "free · answered {ago}",
  "libre · sin datos de ping": "free · no ping data",
  "libre": "free",
  // Panel
  "Sin datos de ping todavía": "No ping data yet",
  "Responde al ping · comprobado {ago}": "Answers ping · checked {ago}",
  "No responde · respondió por última vez {ago}": "No answer · last answered {ago}",
  "No responde · nunca ha respondido": "No answer · never answered",
  "Copiar IP": "Copy IP",
  "{ip} copiada": "{ip} copied",
  "Nota de esta IP…": "Note for this IP…",
  "Nota": "Note",
  "Nota guardada": "Note saved",
  "Escribe el nombre de un equipo.": "Type a device name.",
  "{n} IP(s) para {name}": "{n} IP(s) for {name}",
  "Asignada a {name}": "Assigned to {name}",
  "{n} IPs liberadas": "{n} IPs released",
  "{ip} liberada, ya no es tuya": "{ip} released, no longer yours",
  "Liberar {n}": "Release {n}",
  "Liberar": "Release",
  "Deja de ser tuya": "It stops being yours",
  "¿Seguro? Deja de ser tuya": "Sure? It stops being yours",
  "El equipo no responde: puede estar apagado.": "The device does not answer: it may be off.",
  "Editar equipo": "Edit device",
  "También usa:": "Also uses:",
  "Nuevo equipo para esta IP": "New device for this IP",
  "Cambiar": "Change",
  "Cambiar equipo": "Change device",
  "{ip} vuelve a estar reservada": "{ip} is reserved again",
  "Quitar equipo": "Remove device",
  "Responde al ping aunque no le has asignado equipo.": "It answers ping although it has no device assigned.",
  "Asignar a un equipo": "Assign to a device",
  "Asignar": "Assign",
  "Alguien la está usando. Puedes reclamarla igualmente.": "Someone is using it. You can still claim it.",
  "Respondió hace poco: quizá es un equipo apagado.": "It answered recently: it may be a device that is off.",
  "{ip} reclamada y reservada para ti": "{ip} claimed and reserved for you",
  "Reclamar": "Claim",
  "queda reservada para ti": "it stays reserved for you",
  "…o reclamar y asignar a un equipo": "…or claim and assign to a device",
  "Reclamar y asignar": "Claim and assign",
  "{n} seleccionadas": "{n} selected",
  "y {n} más": "and {n} more",
  "{a} sin reclamar · {b} tuyas · {c} con equipo": "{a} unclaimed · {b} yours · {c} with device",
  "{n} IPs reclamadas": "{n} IPs claimed",
  "Reclamar {n}": "Claim {n}",
  "{n} IPs vuelven a estar reservadas": "{n} IPs are reserved again",
  "Quitar equipo de {n}": "Remove device from {n}",
  "Asignar las {n} a un equipo": "Assign all {n} to a device",
  "{n} ya tienen equipo ({names}) y se reasignarán.": "{n} already have a device ({names}) and will be reassigned.",
  "Quitar selección": "Clear selection",
  "Elige una IP del mapa": "Pick an IP on the map",
  "Elige una IP de la lista": "Pick an IP from the list",
  "Puedes asignarla a un equipo, quitárselo o liberarla.": "You can assign it to a device, remove its device or release it.",
  "Haz clic en una celda para reclamarla, asignarla a un equipo o liberarla.":
    "Click a cell to claim it, assign it to a device or release it.",
  "Tus reservadas en esta red ({n})": "Your reserved IPs in this network ({n})",
  "Ninguna. Reclama una IP libre para guardarla.": "None. Claim a free IP to keep it.",
  "Shift+clic o arrastra para elegir varias.": "Shift+click or drag to pick several.",
  "busca": "search",
  "limpia la selección": "clears the selection",
  // Equipos
  "Filtrar por tipo": "Filter by type",
  "Todos": "All",
  "Nuevo equipo": "New device",
  "Todavía no hay equipos. Créalos aquí o directamente desde una IP del mapa.":
    "No devices yet. Create them here or straight from an IP on the map.",
  "Ningún equipo coincide con la búsqueda.": "No device matches the search.",
  "Responde al ping": "Answers ping",
  "No responde": "No answer",
  "{name} eliminado · sus IPs quedan reservadas": "{name} deleted · its IPs stay reserved",
  "Ver en el mapa": "Show on the map",
  "Sin IPs": "No IPs",
  "Editar": "Edit",
  "Eliminar": "Delete",
  "¿Eliminar? Sus {n} IPs quedan reservadas": "Delete? Its {n} IPs stay reserved",
  "¿Eliminar?": "Delete?",
  "Nombre, p. ej. glpi": "Name, e.g. glpi",
  "Nombre": "Name",
  "Sistema operativo": "Operating system",
  "Sistema operativo (opcional)": "Operating system (optional)",
  "Usar {name}": "Use {name}",
  "Quitar de la lista": "Remove from the list",
  "Quitar {name} de la lista": "Remove {name} from the list",
  "«{name}» quitado de la lista": "“{name}” removed from the list",
  "Quitar del equipo (queda reservada)": "Remove from device (stays reserved)",
  "Quitar {ip}": "Remove {ip}",
  "Sin IPs todavía": "No IPs yet",
  "{ip} pasará de {name} a este equipo.": "{ip} will move from {name} to this device.",
  "Añadir una de tus IPs reservadas": "Add one of your reserved IPs",
  "o escribe una IP o rango": "or type an IP or range",
  "Escribir IP o rango": "Type an IP or range",
  "«{text}» no parece una IP válida.": "“{text}” does not look like a valid IP.",
  "El nombre es obligatorio.": "The name is required.",
  "{name} guardado": "{name} saved",
  "{name} creado": "{name} created",
  "{name} eliminado": "{name} deleted",
  "Editar {name}": "Edit {name}",
  "IPs de este equipo": "IPs of this device",
  "Añadir": "Add",
  "Crear equipo": "Create device",
  "＋ Añadir una IP reservada ({n})": "＋ Add a reserved IP ({n})",
  "No tienes IPs reservadas libres": "You have no free reserved IPs",
};

export function lang() {
  return current;
}

export function setLang(value) {
  current = value === "en" ? "en" : "es";
  try {
    globalThis.localStorage && globalThis.localStorage.setItem(KEY, current);
  } catch {
    /* ignorado */
  }
  if (globalThis.document) globalThis.document.documentElement.lang = current;
}

export function t(es, vars) {
  let text = current === "en" && EN[es] ? EN[es] : es;
  if (vars) text = text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return text;
}

export function typeLabel(type) {
  return { vm: t("VM"), fisica: t("Física"), contenedor: t("Contenedor"), otro: t("Otro") }[type] || type;
}
