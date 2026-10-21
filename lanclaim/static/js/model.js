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
