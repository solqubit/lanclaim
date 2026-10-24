// Arranque, estado de la interfaz, navegación por hash y refresco.
import { load, post } from "./api.js";
import { renderDevices } from "./devices.js";
import { lang, setLang, t } from "./i18n.js";
import { renderRed } from "./map.js";
import { agoText, networkOf } from "./model.js";
import { hasUnstoredDrafts } from "./drafts.js";
import { toast } from "./ui.js";

export const ui = {
  view: "red", // 'red' | 'equipos'
  net: null, // cidr de la red activa o 'outside'
  sel: new Set(),
  anchor: null, // última IP pulsada, para Shift+clic
  filter: null, // 'use' | 'res' | 'occ' | 'free'
  q: "",
  typeFilter: null,
  editDev: null, // id del equipo en edición o 'new'
  newDevAddress: null, // IP a precargar al crear un equipo
  addingNet: false,
  editNet: null, // id de la red en edición
  multi: false, // modo táctil de selección múltiple
  dismissedError: "",
  mapMode: "map",
  offline: false,
  lastLoaded: null,
  pendingWrites: 0,
};

export let state = null;
const root = () => document.getElementById("app");

// Un contenedor está ocupado si tiene el foco o cambios sin guardar.
export function isBusy(node) {
  if (!node) return false;
  const active = document.activeElement;
  const focused = active && node.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
  return focused || node.matches("[data-dirty]") || !!node.querySelector("[data-dirty]");
}

export function markDirty(event) {
  event.target.setAttribute("data-dirty", "");
}

function renderChrome() {
  document.documentElement.lang = lang();
  for (const tab of document.querySelectorAll("[data-view]")) {
    const on = tab.dataset.view === ui.view;
    tab.classList.toggle("on", on);
    if (on) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  document.querySelector('[data-view="red"] span').textContent = t("Red");
  document.querySelector('[data-view="equipos"] span').textContent = t("Equipos");
  document.getElementById("dev-count").textContent = state ? String(state.devices.length || "") : "";
  const q = document.getElementById("q");
  q.placeholder = ui.view === "red" ? t("Buscar IP, equipo o nota…") : t("Buscar equipo, SO o IP…");
  q.setAttribute("aria-label", q.placeholder);
  document.getElementById("lang").value = lang();
  document.title = ui.view === "red" ? `${t("Red")} · LanClaim` : `${t("Equipos")} · LanClaim`;
  const connection = document.getElementById("connection-status");
  connection.hidden = !ui.offline;
  document.getElementById("connection-message").textContent = ui.lastLoaded
    ? t("Sin conexión con el servidor. Se muestran datos de {ago}.", { ago: agoText(Math.round((Date.now() - ui.lastLoaded) / 60000)) })
    : t("Sin conexión con el servidor.");
  document.getElementById("connection-retry").textContent = t("Reintentar");
}

function ensureNet() {
  if (!state) return;
  if (ui.editNet != null && !state.networks.some((n) => n.id === ui.editNet)) ui.editNet = null;
  const valid =
    ui.net === "outside" ? state.ips.some((ip) => !networkOf(state, ip.address)) : state.networks.some((n) => n.cidr === ui.net);
  if (!valid) ui.net = state.networks[0]?.cidr || (state.ips.some((ip) => !networkOf(state, ip.address)) ? "outside" : null);
}

export function render(opts = {}) {
  ensureNet();
  renderChrome();
  if (!state) return;
  if (ui.view === "equipos") renderDevices(root(), state, ui, opts);
  else renderRed(root(), state, ui, opts);
  writeHash();
}

// Ejecuta una mutación, reemplaza el estado y vuelve a pintar.
// Las mutaciones se encadenan: ninguna se descarta aunque llegue mientras otra está en curso.
// quiet: actualiza el estado sin repintar (p. ej. la nota que se está escribiendo).
let queue = Promise.resolve();
export function act(path, body, okMessage, { quiet = false, onError = () => {} } = {}) {
  const run = async () => {
    document.body.classList.add("busy");
    ui.pendingWrites++;
    try {
      state = await post(path, body);
      ui.offline = false;
      ui.lastLoaded = Date.now();
      renderChrome();
      if (okMessage) toast(typeof okMessage === "function" ? okMessage(state) : okMessage);
      if (!quiet) render();
      if (state.scan.running) pollScan();
      return true;
    } catch (error) {
      toast(error.message, "error");
      await refresh();
      onError(error);
      return false;
    } finally {
      document.body.classList.remove("busy");
      ui.pendingWrites--;
    }
  };
  const result = queue.then(run);
  queue = result.catch(() => false);
  return result;
}

// Quitar un SO o una plataforma de la lista guardada sin repintar (el formulario abierto sigue igual).
export function forgetOs(name) {
  return act("os/forget", { name }, t("«{name}» quitado de la lista", { name }), { quiet: true });
}

export function forgetPlatform(name) {
  return act("platforms/forget", { name }, t("«{name}» quitado de la lista", { name }), { quiet: true });
}

export function goto(address) {
  ui.view = "red";
  ui.net = networkOf(state, address)?.cidr || "outside";
  ui.sel = new Set([address]);
  ui.anchor = address;
  ui.filter = null;
  render();
  flash(address);
}

export function flash(address) {
  const cell = document.querySelector(`[data-ip="${address}"]`);
  if (!cell) return;
  cell.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  cell.classList.remove("flash");
  void cell.offsetWidth;
  cell.classList.add("flash");
}

export function editDevice(id, address = null) {
  ui.view = "equipos";
  ui.editDev = id;
  ui.newDevAddress = address;
  render();
  document.querySelector("#dev-panel input")?.focus();
}

// Hash: #red/192.168.1.0-24/192.168.1.43 · #red/otras · #equipos · #equipos/12
function writeHash() {
  let hash = typeof ui.editDev === "number" ? `#equipos/${ui.editDev}` : ui.editDev === "new" ? "#equipos/new" : ui.editDev === "labels" ? "#equipos/labels" : "#equipos";
  if (ui.editDev === "new" && ui.newDevAddress) hash += "?address=" + encodeURIComponent(ui.newDevAddress);
  if (ui.view === "red") {
    const net = ui.net === "outside" ? "otras" : ui.net ? ui.net.replace("/", "-") : "";
    const one = ui.sel.size === 1 ? [...ui.sel][0] : "";
    hash = ["#red", net, one].filter(Boolean).join("/");
    const query = new URLSearchParams();
    if (ui.mapMode === "list") query.set("mode", "list");
    if (ui.editNet != null) query.set("edit", String(ui.editNet));
    if (ui.addingNet) query.set("add", "1");
    if (query.size) hash += "?" + query;
  }
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

function readHash() {
  const [route, query] = location.hash.replace(/^#/, "").split("?");
  const [view, net, address] = route.split("/");
  const params = new URLSearchParams(query || "");
  ui.mapMode = params.get("mode") === "list" ? "list" : "map";
  ui.editNet = /^\d+$/.test(params.get("edit") || "") ? Number(params.get("edit")) : null;
  ui.addingNet = params.get("add") === "1";
  ui.view = view === "equipos" ? "equipos" : "red";
  if (ui.view === "equipos") {
    ui.editDev = net === "new" || net === "labels" ? net : /^\d+$/.test(net || "") ? Number(net) : null;
    const initialAddress = params.get("address");
    ui.newDevAddress = initialAddress && /^\d{1,3}(\.\d{1,3}){3}$/.test(initialAddress) ? initialAddress : null;
    return;
  }
  if (net) ui.net = net === "otras" ? "outside" : net.replace("-", "/");
  ui.sel = new Set(address && /^\d{1,3}(\.\d{1,3}){3}$/.test(address) ? [address] : []);
  ui.anchor = address || null;
}

export async function refresh(opts = { soft: true }) {
  try {
    state = await load();
    ui.offline = false;
    ui.lastLoaded = Date.now();
    render(opts);
  } catch (error) {
    ui.offline = true;
    renderChrome();
    if (!state) showFatal(error.message);
  }
}

let scanTimer = null;
export function pollScan() {
  if (scanTimer) return;
  scanTimer = setInterval(async () => {
    await refresh({ soft: true });
    if (!state?.scan.running) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
  }, 1500);
}

function showFatal(message) {
  const box = root();
  box.replaceChildren();
  const card = document.createElement("div");
  card.className = "empty-state";
  const h = document.createElement("h2");
  h.textContent = t("No se pudo cargar LanClaim");
  const p = document.createElement("p");
  p.textContent = message;
  const retry = document.createElement("button");
  retry.className = "btn primary";
  retry.textContent = t("Reintentar");
  retry.onclick = () => refresh({});
  card.append(h, p, retry);
  box.append(card);
}

function boot() {
  readHash();
  document.getElementById("connection-retry").addEventListener("click", () => refresh());
  addEventListener("beforeunload", (event) => {
    if (ui.pendingWrites || hasUnstoredDrafts()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  document.getElementById("lang").addEventListener("change", (e) => {
    setLang(e.target.value);
    render();
  });
  const q = document.getElementById("q");
  q.addEventListener("input", () => {
    ui.q = q.value.trim();
    render({ soft: true });
  });
  for (const tab of document.querySelectorAll("[data-view]")) {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      ui.view = tab.dataset.view;
      ui.editDev = null;
      render();
    });
  }
  addEventListener("hashchange", () => {
    readHash();
    render();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
      if (typing && document.activeElement.id !== "q") {
        document.activeElement.blur();
      }
      // Un formulario con cambios sin guardar no se descarta con Escape: hay que pulsar Cancelar.
      if (root().querySelector(".dev-form[data-dirty], .dev-form [data-dirty], #net-form[data-dirty], #net-form [data-dirty]")) {
        toast(t("Tienes cambios sin guardar. Pulsa Cancelar para descartarlos."));
        return;
      }
      ui.sel.clear();
      ui.addingNet = false;
      ui.editNet = null;
      ui.editDev = null;
      render();
    } else if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) {
      e.preventDefault();
      q.focus();
    }
  });
  addEventListener("focus", () => refresh());
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh());
  setInterval(() => document.visibilityState === "visible" && refresh(), 30000);
  refresh({}).then(() => {
    if (state?.scan.running) pollScan();
    if (ui.sel.size === 1) flash([...ui.sel][0]);
  });
}

boot();
