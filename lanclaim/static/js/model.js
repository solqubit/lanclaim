// Funciones puras sobre el estado que devuelve /api/state. Sin DOM.
import { t } from "./i18n.js";

export const RECENT_MS = 7 * 86400000;

export function ipToInt(address) {
  return address.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

export function intToIp(n) {
  return [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join(".");
}

function parseCidr(cidr) {
  const [base, prefix] = cidr.split("/");
  const size = 2 ** (32 - Number(prefix));
  const start = Math.floor(ipToInt(base) / size) * size;
  return { start, size, prefix: Number(prefix) };
}

export function networkHosts(cidr) {
  const { start, size } = parseCidr(cidr);
  return Array.from({ length: size }, (_, i) => intToIp(start + i));
}

export function inNetwork(cidr, address) {
  const { start, size } = parseCidr(cidr);
  const n = ipToInt(address);
  return n >= start && n < start + size;
}

export function isEdge(cidr, address) {
  const { start, size, prefix } = parseCidr(cidr);
  if (prefix >= 31) return false;
  const n = ipToInt(address);
  return n === start || n === start + size - 1;
}

const indexes = new WeakMap();
function index(state) {
  let idx = indexes.get(state);
  if (!idx) {
    idx = {
      ips: new Map(state.ips.map((ip) => [ip.address, ip])),
      devices: new Map(state.devices.map((d) => [d.id, d])),
    };
    indexes.set(state, idx);
  }
  return idx;
}

export function ipRecord(state, address) {
  return index(state).ips.get(address) || null;
}

export function device(state, id) {
  return id == null ? null : index(state).devices.get(id) || null;
}

export function deviceOf(state, address) {
  const ip = ipRecord(state, address);
  return ip ? device(state, ip.device_id) : null;
}

export function ipStatus(state, address) {
  const ip = ipRecord(state, address);
  if (ip) return ip.device_id != null ? "use" : "res";
  const obs = state.observations[address];
  return obs && obs.up ? "occ" : "free";
}

export function pingInfo(state, address, nowMs = Date.now()) {
  const obs = state.observations[address];
  if (!obs) return { up: null, recent: false, lastUpAgoMin: null };
  const lastUp = obs.last_up_at ? Date.parse(obs.last_up_at) : null;
  return {
    up: obs.up,
    recent: lastUp != null && nowMs - lastUp <= RECENT_MS,
    lastUpAgoMin: lastUp == null ? null : Math.max(0, Math.round((nowMs - lastUp) / 60000)),
  };
}

export function networkOf(state, address) {
  return state.networks.find((n) => inNetwork(n.cidr, address)) || null;
}

export function outsideIps(state) {
  return state.ips.filter((ip) => !networkOf(state, ip.address));
}

export function counts(state, cidr) {
  const result = { use: 0, res: 0, occ: 0, free: 0 };
  for (const address of networkHosts(cidr)) {
    if (!isEdge(cidr, address)) result[ipStatus(state, address)]++;
  }
  return result;
}

export function suggestIp(state, cidr, nowMs = Date.now()) {
  const hosts = networkHosts(cidr).filter((a) => !isEdge(cidr, a));
  const reserved = hosts.find((a) => ipStatus(state, a) === "res");
  if (reserved) return { address: reserved, reason: "reserved" };
  const free = hosts.find((a) => ipStatus(state, a) === "free" && !pingInfo(state, a, nowMs).recent);
  return free ? { address: free, reason: "free" } : null;
}

export function deviceIps(state, deviceId) {
  return state.ips
    .filter((ip) => ip.device_id === deviceId)
    .map((ip) => ip.address)
    .sort((a, b) => ipToInt(a) - ipToInt(b));
}

export function findDeviceByName(state, name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  return state.devices.find((d) => d.name.toLowerCase() === key) || null;
}

export function matches(state, address, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  if (address.includes(q)) return true;
  const ip = ipRecord(state, address);
  if (!ip) return false;
  const d = device(state, ip.device_id);
  return (d && d.name.toLowerCase().includes(q)) || ip.note.toLowerCase().includes(q);
}

export function agoText(min) {
  if (min < 1) return t("ahora");
  if (min < 60) return t("hace {n} min", { n: min });
  if (min < 1440) return t("hace {n} h", { n: Math.round(min / 60) });
  const days = Math.round(min / 1440);
  return days === 1 ? t("hace 1 día") : t("hace {n} días", { n: days });
}

export function minutesSince(iso, nowMs = Date.now()) {
  return iso ? Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000)) : null;
}

export function byIp(a, b) {
  return ipToInt(a) - ipToInt(b);
}

// SO guardados que encajan con lo escrito (más recientes primero); nada si ya está elegido uno exacto.
export function osSuggestions(choices, typed, limit = 8) {
  const q = String(typed || "").trim().toLowerCase();
  const list = (choices || []).filter((name) => name.toLowerCase() !== q && name.toLowerCase().includes(q));
  return list.slice(0, limit);
}

// Lista de Equipos, en orden de pintado: [{device, depth, guests}] o [{group, depth: 0, count}].
// 1) máquinas físicas (las que tienen VMs primero) con sus VMs debajo; 2) VMs sin máquina agrupadas por
// plataforma; 3) el resto. keep filtra, pero un resultado mantiene visible su máquina o su grupo.
export function deviceTree(state, keep = () => true) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const isMachine = (d) => d.type === "fisica";
  const machineIds = new Set(state.devices.filter(isMachine).map((d) => d.id));
  const guestsOf = (id) => state.devices.filter((d) => !isMachine(d) && d.host_id === id).sort(byName);
  const out = [];
  const machineList = state.devices.filter(isMachine).sort((a, b) => (guestsOf(b.id).length > 0) - (guestsOf(a.id).length > 0) || byName(a, b));
  for (const m of machineList) {
    const guests = guestsOf(m.id).filter(keep);
    if (!keep(m) && !guests.length) continue;
    out.push({ device: m, depth: 0, guests: guestsOf(m.id).length });
    for (const g of guests) out.push({ device: g, depth: 1, guests: 0 });
  }
  const loose = state.devices.filter((d) => !isMachine(d) && !machineIds.has(d.host_id));
  const groups = new Map();
  for (const d of loose.filter((d) => d.platform)) {
    const key = d.platform.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: d.platform, items: [] });
    groups.get(key).items.push(d);
  }
  for (const { name, items } of [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const shown = items.filter(keep).sort(byName);
    if (!shown.length) continue;
    out.push({ group: name, depth: 0, count: items.length });
    for (const d of shown) out.push({ device: d, depth: 1, guests: 0 });
  }
  for (const d of loose.filter((d) => !d.platform && keep(d)).sort(byName)) out.push({ device: d, depth: 0, guests: 0 });
  return out;
}

// Máquinas físicas, por nombre.
export function machines(state) {
  return state.devices.filter((d) => d.type === "fisica").sort((a, b) => a.name.localeCompare(b.name));
}

// Etiquetas de plataforma guardadas; solo se pueden eliminar mientras ningún equipo las use.
export function platformLabels(state) {
  const used = new Set(state.devices.map((d) => (d.platform || "").toLowerCase()).filter(Boolean));
  return (state.platform_choices || []).map((name) => ({ name, removable: !used.has(name.toLowerCase()) }));
}

// La única máquina física que ejecuta esa plataforma, para rellenarla sola; null si no hay o hay varias.
export function machineForPlatform(state, platform) {
  const q = String(platform || "").trim().toLowerCase();
  const found = q ? machines(state).filter((m) => (m.platform || "").toLowerCase() === q) : [];
  return found.length === 1 ? found[0] : null;
}

// Plataforma que de verdad usa un equipo: la de su máquina física si la tiene (heredada) o la suya.
export function effectivePlatform(state, d) {
  const machine = d.type !== "fisica" && d.host_id != null ? state.devices.find((x) => x.id === d.host_id && x.type === "fisica") : null;
  if (machine && machine.platform) return { name: machine.platform, inherited: true, from: machine.name };
  return { name: d.platform || "", inherited: false, from: null };
}

// Etiquetas guardadas con cuántos equipos las usan (la plataforma heredada cuenta).
export function labelUsage(state) {
  const count = (values, name) => values.filter((v) => v.toLowerCase() === name.toLowerCase()).length;
  const platforms = state.devices.map((d) => effectivePlatform(state, d).name).filter(Boolean);
  const systems = state.devices.map((d) => d.os || "").filter(Boolean);
  return {
    platforms: (state.platform_choices || []).map((name) => ({ name, count: count(platforms, name) })),
    os: (state.os_choices || []).map((name) => ({ name, count: count(systems, name) })),
  };
}

// Familia del sistema operativo, para su icono. null si no se reconoce.
const OS_FAMILIES = [
  ["windows", /\bwindows\b|\bwin(10|11|20\d\d)\b/],
  ["proxmox", /proxmox/],
  ["truenas", /truenas|freenas/],
  ["ubuntu", /ubuntu/],
  ["debian", /debian/],
  ["rocky", /rocky/],
  ["alma", /alma/],
  ["centos", /centos/],
  ["redhat", /red ?hat|\brhel\b/],
  ["fedora", /fedora/],
  ["alpine", /alpine/],
  ["arch", /\barch\b|archlinux/],
  ["opensuse", /suse/],
  ["freebsd", /freebsd/],
  ["macos", /mac ?os|os ?x\b/],
  ["linux", /linux|mint|kali|manjaro|gentoo|slackware|raspbian/],
];
export function osFamily(os) {
  const text = String(os || "").toLowerCase();
  if (!text) return null;
  const hit = OS_FAMILIES.find(([, re]) => re.test(text));
  return hit ? hit[0] : null;
}
