// Vista Equipos: lista fija (máquinas físicas con sus VMs y VMs por plataforma) y formulario en el panel lateral.
import { t, typeLabel } from "./i18n.js";
import { act, goto, isBusy, markDirty, render, state as liveState, ui } from "./main.js";
import { deviceIcon, osIcon } from "./icons.js";
import { byIp, device as deviceById, deviceIps, deviceOf, deviceTree, effectivePlatform, labelUsage, machineForPlatform, machines, networkOf, pingInfo, platformLabels } from "./model.js";
import { osSelect } from "./ossel.js";
import { confirmButton, el, toast } from "./ui.js";

const TYPES = ["vm", "fisica", "contenedor", "otro"];
const VIRTUAL = new Set(["vm", "contenedor", "otro"]); // corren en una plataforma y, opcionalmente, en una máquina física

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
    el("button", { type: "button", class: "btn" + (ui.editDev === "labels" ? " on" : ""), onclick: () => openDevice("labels") }, t("Etiquetas")),
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
  return el("div", { class: "dev-list", role: "list" }, nodes.map((node) => (node.group ? groupRow(node) : deviceRow(state, node))));
}

// Cabecera de las VMs que tienen plataforma pero no máquina física indicada.
function groupRow({ group, count }) {
  return el(
    "div",
    { class: "dev-group", role: "listitem" },
    el("span", { class: "platform" }, group),
    el("span", { class: "muted small" }, count === 1 ? t("1 equipo sin máquina física indicada") : t("{n} equipos sin máquina física indicada", { n: count })),
  );
}

function deviceRow(state, { device: d, depth, guests }) {
  const ips = deviceIps(state, d.id);
  const own = d.type !== "fisica" && d.platform && !effectivePlatform(state, d).inherited && d.host_id != null;
  const quietNoIps = d.dhcp || guests > 0; // una máquina que solo aloja VMs no «pide» IPs
  const meta = [typeLabel(d.type), d.os].filter(Boolean).join(" · ");
  return el(
    "div",
    { class: `dev-row depth-${Math.min(depth, 3)}` + (ui.editDev === d.id ? " on" : ""), role: "listitem", "data-device": d.id },
    el(
      "button",
      { type: "button", class: "dev-main", title: t("Editar {name}", { name: d.name }), onclick: () => openDevice(d.id) },
      deviceIcon(d),
      el("span", { class: "dev-text" }, el("span", { class: "dev-title" }, d.name), el("span", { class: "dev-meta" }, meta)),
    ),
    el(
      "div",
      { class: "dev-side" },
      (d.type === "fisica" && d.platform) || own ? el("span", { class: "platform" }, d.platform) : null,
      d.dhcp ? el("span", { class: "dhcp", title: t("Usa IP dinámica (DHCP)") }, "DHCP") : null,
      guests ? el("span", { class: "guests" }, guests === 1 ? t("1 equipo dentro") : t("{n} equipos dentro", { n: guests })) : null,
      el(
        "div",
        { class: "chips" },
        ips.length
          ? ips.map((a) => el("button", { type: "button", class: "ipc", title: t("Ver en el mapa"), onclick: () => goto(a) }, pingDot(state, a), a))
          : quietNoIps
            ? null
            : el("span", { class: "muted small" }, t("Sin IPs")),
      ),
    ),
  );
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
  if (ui.editDev != null && ui.editDev !== "new" && ui.editDev !== "labels") {
    d = deviceById(state, ui.editDev);
    if (!d) ui.editDev = null; // borrado desde otra pestaña
  }
  const open = ui.editDev != null;
  const panel = el("aside", { class: "panel" + (open ? " open tone-multi" : ""), id: "dev-panel", "aria-label": t("Detalles") });
  if (!open) {
    panel.append(idle(state));
    return panel;
  }
  panel.append(
    el("button", { type: "button", class: "icon-btn sheet-close", "aria-label": t("Cerrar"), onclick: closePanel }, "×"),
    ui.editDev === "labels" ? labelsPanel(state) : deviceForm(state, d),
  );
  return panel;
}

function idle(state) {
  const physical = machines(state).length;
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
      el("div", {}, el("b", {}, String(physical)), el("span", {}, t("máquinas físicas"))),
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
  // Sistema operativo: de la biblioteca, con la versión aparte.
  const osSel = osSelect(d ? d.os : "", { onDirty: () => osSel.node.setAttribute("data-dirty", "") });
  const note = el("textarea", { class: "in", rows: 2, maxlength: 2000, value: d ? d.note : "", placeholder: t("Nota"), "aria-label": t("Nota"), oninput: markDirty });

  // Plataforma de virtualización: para una VM, dónde se virtualiza; para una máquina física, qué ejecuta.
  const deviceId = d ? d.id : null;
  const platform = el("input", { class: "in", maxlength: 60, autocomplete: "off", value: d ? d.platform : "", placeholder: t("p. ej. Vates XCP-ng, VMware Workstation Pro"), "aria-label": t("Plataforma de virtualización"), oninput: markDirty });
  // Máquina física (opcional): una existente o un nombre nuevo, que se crea al guardar.
  const machineList = machines(state).filter((m) => m.id !== deviceId);
  const currentMachine = d && d.host_id != null ? deviceById(state, d.host_id) : null;
  const machine = el("input", { class: "in", list: "machine-list", autocomplete: "off", maxlength: 120, value: currentMachine ? currentMachine.name : "", placeholder: t("Opcional, p. ej. Cubito o Mi PC"), "aria-label": t("Máquina física"), oninput: markDirty });
  const machineOptions = el("datalist", { id: "machine-list" }, machineList.map((m) => el("option", { value: m.name }, m.platform)));
  const machineHint = el("div", { class: "hint" });
  const findMachine = () => machineList.find((m) => m.name.toLowerCase() === machine.value.trim().toLowerCase());
  const syncMachine = () => {
    const value = machine.value.trim();
    machineHint.textContent = value && !findMachine() ? t("Se creará la máquina física “{name}”.", { name: value }) : "";
  };
  machine.addEventListener("input", syncMachine);
  // Atajos: una plataforma que solo ejecuta una máquina rellena la máquina, y una máquina rellena su plataforma.
  platform.addEventListener("input", () => {
    const only = machineForPlatform(state, platform.value);
    if (VIRTUAL.has(type.value) && only && only.id !== deviceId && !machine.value.trim()) {
      machine.value = only.name;
      machine.dispatchEvent(new Event("input", { bubbles: true }));
      machineHint.textContent = t("Es la única máquina con {platform}.", { platform: only.platform });
    }
  });
  // Con una máquina física que tiene plataforma, la VM la hereda: no se elige.
  const inherited = el("div", { class: "inherited" });
  const platformControls = el("div", {}, platform);
  const inheritedFrom = () => (VIRTUAL.has(type.value) ? findMachine() : null);
  const syncPlatform = () => {
    const from = inheritedFrom();
    const inheriting = !!(from && from.platform);
    platformControls.hidden = inheriting;
    inherited.hidden = !inheriting;
    inherited.replaceChildren(
      ...(inheriting ? [el("span", { class: "platform" }, from.platform), el("span", { class: "muted small" }, t("heredada de {name}", { name: from.name }))] : []),
    );
  };
  machine.addEventListener("input", syncPlatform);
  const readMachine = () => {
    const value = machine.value.trim();
    if (!value) return null;
    const existing = findMachine();
    return existing ? { id: existing.id } : { name: value };
  };
  platformControls.append(platformPicker(state, platform));
  const platformBlock = field(t("Plataforma de virtualización"), inherited, platformControls);
  const machineBlock = field(t("Máquina física (opcional)"), machine, machineOptions, machineHint, machinePicker(machineList, machine));
  const syncType = () => {
    machineBlock.hidden = !VIRTUAL.has(type.value);
    syncPlatform();
    platformBlock.querySelector(".lbl").textContent = VIRTUAL.has(type.value)
      ? t("Plataforma de virtualización")
      : t("Plataforma que ejecuta (opcional)");
  };
  type.addEventListener("change", syncType);

  const dhcp = el("input", { type: "checkbox", checked: !!(d && d.dhcp), onchange: (e) => (markDirty(e), syncDhcp()) });
  const dhcpWarn = el("p", { class: "warn", hidden: true });
  const ipSection = el("div", {});
  const syncDhcp = () => {
    ipSection.hidden = dhcp.checked;
    dhcpWarn.hidden = !(dhcp.checked && addresses.length);
    dhcpWarn.textContent = t("Al guardar, sus IPs ({ips}) pasarán a reservadas.", { ips: addresses.join(", ") });
  };
  const dhcpBlock = el(
    "label",
    { class: "check" },
    dhcp,
    el("span", {}, el("b", {}, t("Usa IP dinámica (DHCP)")), el("span", { class: "muted small" }, t("No se le reserva IP. Las VMs que contiene pueden tener IPs fijas."))),
  );
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
      os: osSel.read(),
      note: note.value,
      platform: inheritedFrom()?.platform ? "" : platform.value,
      host: VIRTUAL.has(type.value) ? readMachine() : null,
      dhcp: dhcp.checked,
    };
    const add = addresses.filter((a) => !original.includes(a));
    const remove = original.filter((a) => !addresses.includes(a));
    const savedName = name.value.trim();
    const ok = d
      ? await act("devices/update", { id: d.id, created_at: d.created_at, ...body, add, remove }, t("{name} guardado", { name: savedName }))
      : await act("devices/create", { ...body, addresses }, t("{name} creado", { name: savedName }));
    if (ok) {
      const saved = d || liveState.devices.find((x) => x.name.toLowerCase() === savedName.toLowerCase());
      closePanel();
      if (saved) flashDevice(saved.id);
    }
  };
  name.addEventListener("keydown", (e) => e.key === "Enter" && save());
  paintIps();
  syncMachine();
  syncType();
  syncDhcp();

  const remove = d
    ? confirmButton({
        label: t("Eliminar"),
        sureLabel: deviceIps(state, d.id).length ? t("¿Eliminar? Sus {n} IPs quedan reservadas", { n: deviceIps(state, d.id).length }) : t("¿Eliminar?"),
        onConfirm: () => {
          const n = deviceIps(state, d.id).length;
          act("devices/delete", { id: d.id, created_at: d.created_at }, n ? t("{name} eliminado · sus IPs quedan reservadas", { name: d.name }) : t("{name} eliminado", { name: d.name })).then(
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
    field(t("Tipo"), type),
    field(t("Sistema operativo"), osSel.node),
    machineBlock,
    platformBlock,
    dhcpBlock,
    dhcpWarn,
    (ipSection.append(
      field(t("IPs de este equipo"), chips),
      warnings,
      el("div", { class: "add-ip" }, picker),
      el("div", { class: "add-ip" }, typed, el("button", { type: "button", class: "btn", onclick: addTyped }, t("Añadir"))),
    ),
    ipSection),
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

// ---------- Etiquetas: renombrar en todos los equipos o eliminar las que nadie usa ----------

function labelsPanel(state) {
  const usage = labelUsage(state);
  return el(
    "div",
    { class: "labels" },
    el("h2", { class: "form-title" }, t("Etiquetas")),
    el("p", { class: "muted small" }, t("Renombrar cambia la etiqueta en todos los equipos que la usan. Solo se pueden eliminar las que no usa nadie.")),
    labelSection(t("Plataformas de virtualización"), usage.platforms, "platforms", null),
    labelSection(t("Sistemas operativos"), usage.os, "os", (name) => osIcon(name, "sm")),
  );
}

function labelSection(title, items, kind, iconFor) {
  return el(
    "section",
    { class: "label-group" },
    el("h3", {}, title, " ", el("b", { class: "count" }, String(items.length))),
    items.length ? el("ul", { class: "label-list" }, items.map((item) => labelRow(item, kind, iconFor))) : el("p", { class: "muted small" }, t("Ninguna todavía.")),
  );
}

function labelRow({ name, count }, kind, iconFor) {
  const input = el("input", { class: "in", value: name, maxlength: kind === "os" ? 120 : 60, "aria-label": t("Renombrar {name}", { name }) });
  let sent = false; // Enter y después blur no deben renombrar dos veces
  const rename = () => {
    const next = input.value.trim();
    input.removeAttribute("data-dirty");
    if (sent || !next || next === name) return (input.value = sent ? input.value : name);
    sent = true;
    act(`${kind}/rename`, { name, new: next }, t("«{old}» ahora es «{name}»", { old: name, name: next }));
  };
  input.addEventListener("input", markDirty);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") rename();
    if (e.key === "Escape") (input.value = name), input.removeAttribute("data-dirty"), input.blur();
  });
  input.addEventListener("blur", rename);
  return el(
    "li",
    { class: "label-row" },
    iconFor ? iconFor(name) || el("span", { class: "os-ico sm blank" }) : null,
    input,
    el("span", { class: "uses" + (count ? "" : " none") }, count === 1 ? t("1 equipo") : t("{n} equipos", { n: count })),
    count
      ? el("span", { class: "x-spacer" })
      : el(
          "button",
          {
            type: "button",
            class: "icon-btn",
            title: t("Eliminar etiqueta"),
            "aria-label": t("Eliminar {name}", { name }),
            onclick: () => act(`${kind === "os" ? "os" : "platforms"}/forget`, { name }, t("«{name}» quitado de la lista", { name })),
          },
          "×",
        ),
  );
}

// Botones que rellenan un campo; con × solo los que se pueden quitar (onRemove recibe el elemento).
function buttonPicker(items, input, onRemove) {
  let list = [...items];
  const box = el("div", { class: "os-picker" });
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    const shown = list.filter((i) => i.value.toLowerCase() !== q && `${i.label} ${i.detail || ""}`.toLowerCase().includes(q));
    box.replaceChildren(
      ...shown.map((i) =>
        el(
          "span",
          { class: "os-chip" + (i.removable ? "" : " in-use"), title: i.hint || null },
          el(
            "button",
            {
              type: "button",
              class: "os-pick",
              onclick: () => {
                input.value = i.value;
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.focus();
              },
            },
            i.label,
            i.detail ? el("span", { class: "os-detail" }, i.detail) : null,
          ),
          i.removable &&
            el(
              "button",
              {
                type: "button",
                class: "x",
                title: t("Quitar de la lista"),
                "aria-label": t("Quitar {name} de la lista", { name: i.label }),
                onclick: () => {
                  list = list.filter((x) => x !== i);
                  paint();
                  onRemove(i);
                },
              },
              "×",
            ),
        ),
      ),
    );
  };
  input.addEventListener("input", paint);
  paint();
  return box;
}

// Plataformas guardadas: × mientras ningún equipo las use.
function platformPicker(state, input) {
  const items = platformLabels(state).map((l) => ({
    label: l.name,
    value: l.name,
    removable: l.removable,
    hint: l.removable ? null : t("En uso por algún equipo, no se puede quitar"),
  }));
  return buttonPicker(items, input, (i) =>
    act("platforms/forget", { name: i.value }, t("«{name}» quitado de la lista", { name: i.value }), { quiet: true }),
  );
}

// Máquinas físicas existentes (se borran desde su ficha, no desde aquí).
function machinePicker(list, input) {
  return buttonPicker(
    list.map((m) => ({ label: m.name, detail: m.platform, value: m.name, removable: false })),
    input,
    () => {},
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
