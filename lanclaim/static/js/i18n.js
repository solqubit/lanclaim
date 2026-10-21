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
