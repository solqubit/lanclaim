// Vista Equipos: tarjetas con sus IPs y formulario con gestión de IPs.
import { t, typeLabel } from "./i18n.js";
import { act, goto, isBusy, markDirty, render, ui } from "./main.js";
import { byIp, deviceIps, deviceOf, networkOf, pingInfo } from "./model.js";
import { confirmButton, el, toast } from "./ui.js";

const TYPES = ["vm", "fisica", "contenedor", "otro"];

export function renderDevices(root, state, ui, opts = {}) {
  const old = root.querySelector("section.devices");
  if (opts.soft && old && isBusy(old.querySelector(".card.form"))) return;
  const section = el("section", { class: "devices" }, header(state), cards(state));
  if (opts.soft && old && old.textContent === section.textContent) return;
  root.replaceChildren(section);
}

function header(state) {
  const countOf = (type) => state.devices.filter((d) => d.type === type).length;
  return el(
    "div",
    { class: "devhead" },
    el("h1", {}, t("Equipos")),
    el(
      "div",
      { class: "types", role: "group", "aria-label": t("Filtrar por tipo") },
      el(
        "button",
        { type: "button", class: "type" + (!ui.typeFilter ? " on" : ""), "aria-pressed": String(!ui.typeFilter), onclick: () => ((ui.typeFilter = null), render()) },
        t("Todos"),
        " ",
        el("b", { class: "count" }, String(state.devices.length)),
      ),
      TYPES.filter(countOf).map((type) =>
        el(
          "button",
          {
            type: "button",
            class: "type" + (ui.typeFilter === type ? " on" : ""),
            "aria-pressed": String(ui.typeFilter === type),
            onclick: () => ((ui.typeFilter = ui.typeFilter === type ? null : type), render()),
          },
          typeLabel(type),
          " ",
          el("b", { class: "count" }, String(countOf(type))),
        ),
      ),
    ),
  );
}

function matchesDevice(state, d) {
  const q = ui.q.toLowerCase();
  if (ui.typeFilter && d.type !== ui.typeFilter) return false;
  if (!q) return true;
  return [d.name, d.os, d.note].some((v) => v.toLowerCase().includes(q)) || deviceIps(state, d.id).some((a) => a.includes(q));
}

function cards(state) {
  const box = el("div", { class: "cards" });
  box.append(
    ui.editDev === "new"
      ? deviceForm(state, null)
      : el("button", { type: "button", class: "card new", onclick: () => ((ui.editDev = "new"), (ui.newDevAddress = null), render()) }, "＋ ", t("Nuevo equipo")),
  );
  const list = state.devices.filter((d) => matchesDevice(state, d));
  for (const d of list) box.append(ui.editDev === d.id ? deviceForm(state, d) : card(state, d));
  if (!state.devices.length) {
    box.append(el("p", { class: "empty-devices" }, t("Todavía no hay equipos. Créalos aquí o directamente desde una IP del mapa.")));
  } else if (!list.length) {
    box.append(el("p", { class: "empty-devices" }, t("Ningún equipo coincide con la búsqueda.")));
  }
  return box;
}

function ipChip(state, address, extra = null) {
  const info = pingInfo(state, address);
  const dot = info.up === null ? null : el("i", { class: "ld " + (info.up ? "up" : "down") });
  const title = info.up === null ? t("Sin datos de ping todavía") : info.up ? t("Responde al ping") : t("No responde");
  return el("span", { class: "ipc", title }, dot, address, extra);
}

function card(state, d) {
  const ips = deviceIps(state, d.id);
  const remove = () =>
    act("devices/delete", { id: d.id }, ips.length ? t("{name} eliminado · sus IPs quedan reservadas", { name: d.name }) : t("{name} eliminado", { name: d.name }));
  return el(
    "article",
    { class: "card", "data-device": d.id },
    el("div", { class: "card-head" }, el("span", { class: "card-name" }, d.name), el("span", { class: "badge" }, typeLabel(d.type))),
    el("div", { class: "card-os" }, d.os || "—"),
    d.note ? el("div", { class: "card-note" }, d.note) : null,
    el(
      "div",
      { class: "chips" },
      ips.length
        ? ips.map((a) =>
            el(
              "button",
              { type: "button", class: "ipc", title: t("Ver en el mapa"), onclick: () => goto(a) },
              pingDot(state, a),
              a,
            ),
          )
        : el("span", { class: "muted small" }, t("Sin IPs")),
    ),
    el(
      "div",
      { class: "card-acts" },
      el("button", { type: "button", class: "btn sm", onclick: () => ((ui.editDev = d.id), render(), focusForm()) }, t("Editar")),
      el("span", { class: "spacer" }),
      confirmButton({
        label: t("Eliminar"),
        sureLabel: ips.length ? t("¿Eliminar? Sus {n} IPs quedan reservadas", { n: ips.length }) : t("¿Eliminar?"),
        onConfirm: remove,
        className: "btn sm danger",
      }),
    ),
  );
}

function pingDot(state, address) {
  const info = pingInfo(state, address);
  return info.up === null ? null : el("i", { class: "ld " + (info.up ? "up" : "down") });
}

function focusForm() {
  document.querySelector(".card.form input")?.focus();
}

// ---------- Formulario ----------

function deviceForm(state, d) {
  const addresses = d ? deviceIps(state, d.id) : ui.newDevAddress ? [ui.newDevAddress] : [];
  const name = el("input", { class: "in", value: d ? d.name : "", maxlength: 120, placeholder: t("Nombre, p. ej. glpi"), "aria-label": t("Nombre"), oninput: markDirty });
  const type = el(
    "select",
    { class: "in", "aria-label": t("Tipo"), onchange: markDirty },
    TYPES.map((k) => el("option", { value: k, selected: d ? d.type === k : k === "vm" }, typeLabel(k))),
  );
  const osValues = [...new Set(state.devices.map((x) => x.os).filter(Boolean))].sort();
  const osList = el("datalist", { id: "os-values" }, osValues.map((v) => el("option", { value: v })));
  const os = el("input", { class: "in", value: d ? d.os : "", maxlength: 120, list: "os-values", placeholder: t("Sistema operativo"), "aria-label": t("Sistema operativo"), oninput: markDirty });
  const note = el("textarea", { class: "in", rows: 2, maxlength: 2000, value: d ? d.note : "", placeholder: t("Nota"), "aria-label": t("Nota"), oninput: markDirty });

  const chips = el("div", { class: "chips form-ips" });
  const warnings = el("div", {});
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
    const moving = addresses
      .map((a) => [a, deviceOf(state, a)])
      .filter(([, owner]) => owner && (!d || owner.id !== d.id));
    warnings.replaceChildren(
      ...moving.map(([a, owner]) => el("p", { class: "warn" }, t("{ip} pasará de {name} a este equipo.", { ip: a, name: owner.name }))),
    );
    picker.replaceChildren(...pickerOptions(state, addresses));
    picker.disabled = picker.options.length <= 1;
  };

  const picker = el("select", { class: "in", "aria-label": t("Añadir una de tus IPs reservadas") });
  picker.addEventListener("change", () => {
    if (picker.value) addIps([picker.value]);
  });
  const typed = el("input", { class: "in mono", placeholder: t("o escribe una IP o rango"), "aria-label": t("Escribir IP o rango") });
  const addTyped = () => {
    const text = typed.value.trim();
    if (!text) return;
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    const bad = parts.filter((p) => !/^\d{1,3}(\.\d{1,3}){3}(-\d{1,3}(\.\d{1,3}){0,3})?(\/\d{1,2})?$/.test(p));
    if (bad.length) {
      toast(t("«{text}» no parece una IP válida.", { text: bad[0] }), "error");
      return;
    }
    typed.value = "";
    addIps(parts);
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
    if (typed.value.trim()) addTyped();
    const body = { name: name.value, type: type.value, os: os.value, note: note.value, addresses };
    const ok = d
      ? await act("devices/update", { id: d.id, ...body }, t("{name} guardado", { name: name.value.trim() }))
      : await act("devices/create", body, t("{name} creado", { name: name.value.trim() }));
    if (ok) {
      ui.editDev = null;
      ui.newDevAddress = null;
      render();
    }
  };
  name.addEventListener("keydown", (e) => e.key === "Enter" && save());
  paintIps();

  return el(
    "div",
    { class: "card form" },
    el("div", { class: "form-title" }, d ? t("Editar {name}", { name: d.name }) : t("Nuevo equipo")),
    name,
    el("div", { class: "two" }, type, el("div", {}, os, osList)),
    note,
    el("span", { class: "lbl" }, t("IPs de este equipo")),
    chips,
    warnings,
    el("div", { class: "add-ip" }, picker),
    el("div", { class: "add-ip" }, typed, el("button", { type: "button", class: "btn", onclick: addTyped }, t("Añadir"))),
    el(
      "div",
      { class: "row" },
      el("button", { type: "button", class: "btn primary", onclick: save }, d ? t("Guardar") : t("Crear equipo")),
      el("button", { type: "button", class: "btn ghost", onclick: () => ((ui.editDev = null), (ui.newDevAddress = null), render()) }, t("Cancelar")),
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
    options.push(
      el(
        "optgroup",
        { label },
        list.map((ip) => el("option", { value: ip.address }, ip.note ? `${ip.address} — ${ip.note}` : ip.address)),
      ),
    );
  }
  return options;
}

