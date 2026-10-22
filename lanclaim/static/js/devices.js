// Vista Equipos: lista fija agrupada por anfitrión y formulario en el panel lateral.
import { t, typeLabel } from "./i18n.js";
import { act, forgetOs, forgetPlatform, goto, isBusy, markDirty, render, state as liveState, ui } from "./main.js";
import { byIp, device as deviceById, deviceIps, deviceOf, deviceTree, hostCandidates, networkOf, pingInfo } from "./model.js";
import { choicePicker, confirmButton, el, osPicker, toast } from "./ui.js";

const TYPES = ["vm", "fisica", "contenedor", "otro"];
const HAS_HOST = new Set(["vm", "contenedor", "otro"]); // corren dentro de otro equipo
const IS_HOST = new Set(["fisica", "otro"]); // pueden alojar VMs y tener plataforma

export function renderDevices(root, state, ui, opts = {}) {
  const old = root.querySelector("section.devices");
  const head = header(state);
  const list = deviceList(state);
  const panel = devicePanel(state);
  // Refresco suave: la lista y el panel solo cambian si cambió lo que muestran; un formulario a medias se respeta.
  if (opts.soft && old) {
    swap(old.querySelector(".devhead"), head);
    swap(old.querySelector(".dev-list"), list);
    const oldPanel = old.querySelector("#dev-panel");
    if (!isBusy(oldPanel)) swap(oldPanel, panel);
    return;
  }
  root.replaceChildren(
    el("section", { class: "devices" }, head, el("div", { class: "layout" + (ui.editDev != null ? " has-sel" : "") }, list, panel)),
  );
}

function swap(oldNode, fresh) {
  if (oldNode && oldNode.className + oldNode.textContent !== fresh.className + fresh.textContent) oldNode.replaceWith(fresh);
}

function openDevice(id) {
  ui.editDev = id;
  ui.newDevAddress = null;
  render();
  document.querySelector("#dev-panel input")?.focus();
}

function closePanel() {
  ui.editDev = null;
  ui.newDevAddress = null;
  render();
}

function flashDevice(id) {
  const row = document.querySelector(`.dev-row[data-device="${id}"]`);
  if (!row) return;
  row.scrollIntoView({ block: "nearest" });
  row.classList.remove("flash");
  void row.offsetWidth;
  row.classList.add("flash");
}

// ---------- Cabecera ----------

function header(state) {
  const countOf = (type) => state.devices.filter((d) => d.type === type).length;
  const filter = (type, label, count) =>
    el(
      "button",
      {
        type: "button",
        class: "type" + (ui.typeFilter === type ? " on" : ""),
        "aria-pressed": String(ui.typeFilter === type),
        onclick: () => ((ui.typeFilter = ui.typeFilter === type || type === null ? null : type), render()),
      },
      label,
      " ",
      el("b", { class: "count" }, String(count)),
    );
  return el(
    "div",
    { class: "devhead" },
    el("h1", {}, t("Equipos")),
    el(
      "div",
      { class: "types", role: "group", "aria-label": t("Filtrar por tipo") },
      filter(null, t("Todos"), state.devices.length),
      TYPES.filter(countOf).map((type) => filter(type, typeLabel(type), countOf(type))),
    ),
    el("span", { class: "spacer" }),
    el("button", { type: "button", class: "btn primary", onclick: () => openDevice("new") }, "＋ ", t("Nuevo equipo")),
  );
}

// ---------- Lista ----------

function matchesDevice(state, d) {
  const q = ui.q.toLowerCase();
  if (ui.typeFilter && d.type !== ui.typeFilter) return false;
  if (!q) return true;
  return [d.name, d.os, d.note, d.platform].some((v) => (v || "").toLowerCase().includes(q)) || deviceIps(state, d.id).some((a) => a.includes(q));
}

function deviceList(state) {
  if (!state.devices.length) {
    return el(
      "div",
      { class: "dev-list empty" },
      el("p", {}, t("Todavía no hay equipos. Créalos aquí o directamente desde una IP del mapa.")),
      el("button", { type: "button", class: "btn primary", onclick: () => openDevice("new") }, "＋ ", t("Nuevo equipo")),
    );
  }
  const nodes = deviceTree(state, (d) => matchesDevice(state, d));
  if (!nodes.length) return el("div", { class: "dev-list empty" }, el("p", {}, t("Ningún equipo coincide con la búsqueda.")));
  return el("div", { class: "dev-list", role: "list" }, nodes.map((node) => deviceRow(state, node)));
}

function deviceRow(state, { device: d, depth, guests }) {
  const ips = deviceIps(state, d.id);
  const meta = [typeLabel(d.type), d.os].filter(Boolean).join(" · ");
  return el(
    "div",
    { class: `dev-row depth-${Math.min(depth, 3)}` + (ui.editDev === d.id ? " on" : ""), role: "listitem", "data-device": d.id },
    el(
      "button",
      { type: "button", class: "dev-main", title: t("Editar {name}", { name: d.name }), onclick: () => openDevice(d.id) },
      typeIcon(d.type),
      el("span", { class: "dev-text" }, el("span", { class: "dev-title" }, d.name), el("span", { class: "dev-meta" }, meta)),
    ),
    el(
      "div",
      { class: "dev-side" },
      d.platform ? el("span", { class: "platform" }, d.platform) : null,
      guests ? el("span", { class: "guests" }, guests === 1 ? t("1 equipo dentro") : t("{n} equipos dentro", { n: guests })) : null,
      el(
        "div",
        { class: "chips" },
        ips.length
          ? ips.map((a) => el("button", { type: "button", class: "ipc", title: t("Ver en el mapa"), onclick: () => goto(a) }, pingDot(state, a), a))
          : el("span", { class: "muted small" }, t("Sin IPs")),
      ),
    ),
  );
}

const ICONS = {
  // VM: ventanas apiladas · Física: servidor de rack · Contenedor: cubo · Otro: nodo
  vm: "M4 7h11v9H4zM8 4h12v9h-2",
  fisica: "M4 5h16v5H4zM4 14h16v5H4zM7 7.5h.01M7 16.5h.01",
  contenedor: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  otro: "M12 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8M12 3v5M12 16v5M3 12h5M16 12h5",
};

function typeIcon(type) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `type-ico ${type}`);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", ICONS[type] || ICONS.otro);
  svg.append(path);
  return svg;
}

function pingDot(state, address) {
  const info = pingInfo(state, address);
  return info.up === null ? null : el("i", { class: "ld " + (info.up ? "up" : "down") });
}

function ipChip(state, address, extra = null) {
  const info = pingInfo(state, address);
  const title = info.up === null ? t("Sin datos de ping todavía") : info.up ? t("Responde al ping") : t("No responde");
  return el("span", { class: "ipc", title }, pingDot(state, address), address, extra);
}

// ---------- Panel ----------

function devicePanel(state) {
  let d = null;
  if (ui.editDev != null && ui.editDev !== "new") {
    d = deviceById(state, ui.editDev);
    if (!d) ui.editDev = null; // borrado desde otra pestaña
  }
  const open = ui.editDev != null;
  const panel = el("aside", { class: "panel" + (open ? " open tone-multi" : ""), id: "dev-panel", "aria-label": t("Detalles") });
  if (!open) {
    panel.append(idle(state));
    return panel;
  }
  panel.append(el("button", { type: "button", class: "icon-btn sheet-close", "aria-label": t("Cerrar"), onclick: closePanel }, "×"), deviceForm(state, d));
  return panel;
}

function idle(state) {
  const hosts = new Set(state.devices.map((d) => d.host_id).filter((id) => id != null));
  const assigned = state.ips.filter((ip) => ip.device_id != null).length;
  return el(
    "div",
    { class: "idle" },
    el("h2", {}, t("Elige un equipo")),
    el("p", { class: "muted" }, t("Haz clic en un equipo para editarlo, o crea uno nuevo. La lista no se mueve mientras editas.")),
    el(
      "div",
      { class: "stats" },
      el("div", {}, el("b", {}, String(state.devices.length)), el("span", {}, t("equipos"))),
      el("div", {}, el("b", {}, String(hosts.size)), el("span", {}, t("anfitriones"))),
      el("div", {}, el("b", {}, String(assigned)), el("span", {}, t("IPs asignadas"))),
    ),
  );
}

// div y no label: un label con botones dentro pulsaría el primero (p. ej. la × de una IP) al hacer clic en su texto.
function field(label, ...children) {
  return el("div", { class: "field" }, el("span", { class: "lbl" }, label), ...children);
}

function deviceForm(state, d) {
  const addresses = d ? deviceIps(state, d.id) : ui.newDevAddress ? [ui.newDevAddress] : [];
  // Lo que había al abrir: al guardar se envían solo altas y bajas, para no deshacer cambios de otra pestaña.
  const original = d ? [...addresses] : [];
  const name = el("input", { class: "in", value: d ? d.name : "", maxlength: 120, placeholder: t("Nombre, p. ej. glpi"), "aria-label": t("Nombre"), oninput: markDirty });
  const type = el(
    "select",
    { class: "in", "aria-label": t("Tipo"), onchange: markDirty },
    TYPES.map((k) => el("option", { value: k, selected: d ? d.type === k : k === "vm" }, typeLabel(k))),
  );
  const os = el("input", { class: "in", value: d ? d.os : "", maxlength: 120, autocomplete: "off", placeholder: t("Sistema operativo"), "aria-label": t("Sistema operativo"), oninput: markDirty });
  const note = el("textarea", { class: "in", rows: 2, maxlength: 2000, value: d ? d.note : "", placeholder: t("Nota"), "aria-label": t("Nota"), oninput: markDirty });

  // Anfitrión: uno existente o un nombre nuevo (se crea con su plataforma).
  const candidates = hostCandidates(state, d ? d.id : null);
  const currentHost = d && d.host_id != null ? deviceById(state, d.host_id) : null;
  const hostList = el("datalist", { id: "host-list" }, candidates.map((c) => el("option", { value: c.name }, c.platform || typeLabel(c.type))));
  const host = el("input", { class: "in", list: "host-list", autocomplete: "off", maxlength: 120, value: currentHost ? currentHost.name : "", placeholder: t("Sin anfitrión: escribe o elige uno"), "aria-label": t("Anfitrión"), oninput: markDirty });
  const hostPlatform = el("input", { class: "in", maxlength: 60, autocomplete: "off", placeholder: t("Plataforma, p. ej. Proxmox VE"), "aria-label": t("Plataforma del anfitrión nuevo") });
  const hostHint = el("div", { class: "hint" });
  const hostNew = el("div", { class: "new-device", hidden: true }, hostHint, hostPlatform, choicePicker(state.platform_choices, hostPlatform, forgetPlatform));
  const findHost = () => candidates.find((c) => c.name.toLowerCase() === host.value.trim().toLowerCase());
  const syncHost = () => {
    const value = host.value.trim();
    const existing = findHost();
    hostNew.hidden = !value || !!existing;
    hostHint.textContent = existing
      ? ""
      : value
        ? t("Se creará el anfitrión “{name}”. ¿Con qué plataforma?", { name: value })
        : "";
  };
  host.addEventListener("input", syncHost);
  const readHost = () => {
    const value = host.value.trim();
    if (!value) return null;
    const existing = findHost();
    return existing ? { id: existing.id } : { name: value, platform: hostPlatform.value.trim() };
  };

  // Plataforma propia, para los equipos que alojan VMs.
  const platform = el("input", { class: "in", maxlength: 60, autocomplete: "off", value: d ? d.platform : "", placeholder: t("Plataforma, p. ej. Proxmox VE"), "aria-label": t("Plataforma"), oninput: markDirty });
  const hostBlock = field(t("Anfitrión"), host, hostList, hostNew);
  const platformBlock = field(t("Plataforma de virtualización"), platform, choicePicker(state.platform_choices, platform, forgetPlatform));
  const syncType = () => {
    hostBlock.hidden = !HAS_HOST.has(type.value);
    platformBlock.hidden = !IS_HOST.has(type.value);
  };
  type.addEventListener("change", syncType);

  const chips = el("div", { class: "chips form-ips" });
  const warnings = el("div", {});
  const picker = el("select", { class: "in", "aria-label": t("Añadir una de tus IPs reservadas") });
  const paintIps = () => {
    chips.replaceChildren(
      ...(addresses.length
        ? addresses.map((a) =>
            ipChip(
              state,
              a,
              el(
                "button",
                {
                  type: "button",
                  class: "x",
                  title: t("Quitar del equipo (queda reservada)"),
                  "aria-label": t("Quitar {ip}", { ip: a }),
                  onclick: () => {
                    addresses.splice(addresses.indexOf(a), 1);
                    chips.setAttribute("data-dirty", "");
                    paintIps();
                  },
                },
                "×",
              ),
            ),
          )
        : [el("span", { class: "muted small" }, t("Sin IPs todavía"))]),
    );
    const moving = addresses.map((a) => [a, deviceOf(state, a)]).filter(([, owner]) => owner && (!d || owner.id !== d.id));
    warnings.replaceChildren(...moving.map(([a, owner]) => el("p", { class: "warn" }, t("{ip} pasará de {name} a este equipo.", { ip: a, name: owner.name }))));
    picker.replaceChildren(...pickerOptions(state, addresses));
    picker.disabled = picker.options.length <= 1;
  };
  picker.addEventListener("change", () => {
    if (picker.value) addIps([picker.value]);
  });
  const typed = el("input", { class: "in mono", placeholder: t("o escribe una IP o rango"), "aria-label": t("Escribir IP o rango") });
  // Devuelve false si el texto no es válido, para que Guardar no siga sin esa IP.
  const addTyped = () => {
    const text = typed.value.trim();
    if (!text) return true;
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    const bad = parts.filter((p) => !/^\d{1,3}(\.\d{1,3}){3}(-\d{1,3}(\.\d{1,3}){0,3})?(\/\d{1,2})?$/.test(p));
    if (bad.length) {
      toast(t("«{text}» no parece una IP válida.", { text: bad[0] }), "error");
      typed.focus();
      return false;
    }
    typed.value = "";
    addIps(parts);
    return true;
  };
  typed.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTyped();
    }
  });
  const addIps = (list) => {
    for (const a of list) if (!addresses.includes(a)) addresses.push(a);
    addresses.sort((x, y) => (/^[\d.]+$/.test(x) && /^[\d.]+$/.test(y) ? byIp(x, y) : x.localeCompare(y)));
    chips.setAttribute("data-dirty", "");
    paintIps();
  };

  const save = async () => {
    if (!name.value.trim()) {
      toast(t("El nombre es obligatorio."), "error");
      name.focus();
      return;
    }
    if (!addTyped()) return;
    const body = {
      name: name.value,
      type: type.value,
      os: os.value,
      note: note.value,
      platform: IS_HOST.has(type.value) ? platform.value : "",
      host: HAS_HOST.has(type.value) ? readHost() : null,
    };
    const add = addresses.filter((a) => !original.includes(a));
    const remove = original.filter((a) => !addresses.includes(a));
    const savedName = name.value.trim();
    const ok = d
      ? await act("devices/update", { id: d.id, ...body, add, remove }, t("{name} guardado", { name: savedName }))
      : await act("devices/create", { ...body, addresses }, t("{name} creado", { name: savedName }));
    if (ok) {
      const saved = d || liveState.devices.find((x) => x.name.toLowerCase() === savedName.toLowerCase());
      closePanel();
      if (saved) flashDevice(saved.id);
    }
  };
  name.addEventListener("keydown", (e) => e.key === "Enter" && save());
  paintIps();
  syncHost();
  syncType();

  const remove = d
    ? confirmButton({
        label: t("Eliminar"),
        sureLabel: deviceIps(state, d.id).length ? t("¿Eliminar? Sus {n} IPs quedan reservadas", { n: deviceIps(state, d.id).length }) : t("¿Eliminar?"),
        onConfirm: () => {
          const n = deviceIps(state, d.id).length;
          act("devices/delete", { id: d.id }, n ? t("{name} eliminado · sus IPs quedan reservadas", { name: d.name }) : t("{name} eliminado", { name: d.name })).then(
            (ok) => ok && closePanel(),
          );
        },
        className: "btn danger",
      })
    : null;

  return el(
    "div",
    { class: "dev-form" },
    el("h2", { class: "form-title" }, d ? t("Editar {name}", { name: d.name }) : t("Nuevo equipo")),
    field(t("Nombre"), name),
    el("div", { class: "two" }, field(t("Tipo"), type), field(t("Sistema operativo"), os)),
    osPicker(state, os, forgetOs),
    hostBlock,
    platformBlock,
    field(t("IPs de este equipo"), chips),
    warnings,
    el("div", { class: "add-ip" }, picker),
    el("div", { class: "add-ip" }, typed, el("button", { type: "button", class: "btn", onclick: addTyped }, t("Añadir"))),
    field(t("Nota"), note),
    el(
      "div",
      { class: "row" },
      el("button", { type: "button", class: "btn primary", onclick: save }, d ? t("Guardar") : t("Crear equipo")),
      el("button", { type: "button", class: "btn ghost", onclick: closePanel }, t("Cancelar")),
      remove ? el("span", { class: "spacer" }) : null,
      remove,
    ),
  );
}

// Desplegable de mis IPs reservadas, agrupadas por red.
function pickerOptions(state, chosen) {
  const groups = new Map();
  for (const ip of state.ips) {
    if (ip.device_id != null || chosen.includes(ip.address)) continue;
    const net = networkOf(state, ip.address);
    const label = net ? (net.name ? `${net.name} · ${net.cidr}` : net.cidr) : t("Otras");
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(ip);
  }
  const total = [...groups.values()].reduce((n, list) => n + list.length, 0);
  const options = [el("option", { value: "" }, total ? t("＋ Añadir una IP reservada ({n})", { n: total }) : t("No tienes IPs reservadas libres"))];
  for (const [label, list] of groups) {
    options.push(el("optgroup", { label }, list.map((ip) => el("option", { value: ip.address }, ip.note ? `${ip.address} — ${ip.note}` : ip.address))));
  }
  return options;
}
