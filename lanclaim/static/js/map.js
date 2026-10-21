// Vista Red: barra de redes, resumen, cuadrícula (o lista "Otras") y selección.
import { suggestions } from "./api.js";
import { t } from "./i18n.js";
import { act, flash, isBusy, markDirty, pollScan, render, state as liveState, ui } from "./main.js";
import {
  agoText,
  byIp,
  counts,
  deviceOf,
  inNetwork,
  ipRecord,
  ipStatus,
  isEdge,
  matches,
  minutesSince,
  networkHosts,
  outsideIps,
  pingInfo,
  suggestIp,
} from "./model.js";
import { renderPanel } from "./panel.js";
import { confirmButton, el, toast } from "./ui.js";

const STATUS_LABEL = { use: "asignadas", res: "reservadas", occ: "ocupadas por otros", free: "libres" };

export function renderRed(root, state, ui, opts = {}) {
  const oldNetForm = root.querySelector("#net-form");
  if (!state.networks.length && !outsideIps(state).length) {
    if (opts.soft && isBusy(oldNetForm)) return;
    root.replaceChildren(firstRun(state));
    return;
  }
  const old = root.querySelector("section.red");
  const key = `${ui.net}|${ui.addingNet}|${ui.editNet}`;
  // Refresco suave (ping periódico, otra pestaña): solo se cambia lo que cambió,
  // para no perder clics, foco, hover ni formularios abiertos.
  if (opts.soft && old && old.dataset.key === key) {
    swap(old.querySelector(".bar"), networkBar(state));
    swap(old.querySelector("#banner-slot"), bannerSlot(state));
    swap(old.querySelector("#sum"), ui.net === "outside" ? outsideSummary(state) : summary(state));
    if (ui.net === "outside") swap(old.querySelector(".iplist"), outsideList(state));
    else patchGrid(old.querySelector(".grids"), state);
    const oldPanel = old.querySelector("#panel");
    if (!isBusy(oldPanel)) swap(oldPanel, renderPanel(state, ui));
    old.querySelector(".layout").classList.toggle("has-sel", ui.sel.size > 0);
    return;
  }
  const section = el(
    "section",
    { class: "red", "data-key": key },
    networkBar(state),
    ui.addingNet || ui.editNet != null ? (opts.soft && isBusy(oldNetForm) ? oldNetForm : networkForm(state)) : null,
    bannerSlot(state),
    ui.net === "outside" ? outsideSummary(state) : summary(state),
    el(
      "div",
      { class: "layout" + (ui.sel.size ? " has-sel" : "") },
      el("div", { class: "mapwrap", id: "mapwrap" }, ui.net === "outside" ? outsideList(state) : grid(state), footer(state)),
      renderPanel(state, ui),
    ),
  );
  root.replaceChildren(section);
}

// Sustituye un nodo solo si su contenido visible cambió.
function swap(oldNode, fresh) {
  if (!oldNode) return;
  // Con data-sig manda la firma (así un botón de confirmación armado no se desarma).
  const sig = (n) => n.className + "|" + (n.dataset.sig ?? n.textContent);
  if (sig(oldNode) !== sig(fresh)) oldNode.replaceWith(fresh);
}

function patchGrid(wrap, state) {
  if (!wrap) return;
  wrap.classList.toggle("scanning", !!state.scan.running);
  const cidr = ui.net;
  for (const cell of wrap.querySelectorAll("[data-ip]")) {
    const address = cell.dataset.ip;
    const cls = cellClass(state, address, cidr);
    if (cell.className.replace(" flash", "") !== cls) cell.className = cls;
    const title = cellTitle(state, address, cidr);
    if (cell.title !== title) cell.title = title;
    const dot = cell.disabled ? null : cellDot(state, address);
    const oldDot = cell.querySelector(".dot");
    if ((oldDot?.className || "") !== (dot?.className || "")) {
      oldDot?.remove();
      if (dot) cell.append(dot);
    }
  }
}

// ---------- Barra de redes ----------

function networkBar(state) {
  const bar = el("div", { class: "bar", role: "tablist", "aria-label": t("Redes") });
  for (const n of state.networks) {
    const on = n.cidr === ui.net;
    bar.append(
      el(
        "div",
        { class: "net-chip" + (on ? " on" : "") },
        el(
          "button",
          {
            type: "button",
            class: "net",
            role: "tab",
            "aria-selected": on ? "true" : "false",
            onclick: () => {
              if (ui.net !== n.cidr) {
                ui.net = n.cidr;
                ui.sel.clear();
                ui.filter = null;
                ui.editNet = null;
              }
              render();
            },
          },
          n.name ? el("span", { class: "net-name" }, n.name) : null,
          el("b", {}, n.cidr),
        ),
        on
          ? el(
              "button",
              {
                type: "button",
                class: "net-edit",
                title: t("Editar red"),
                "aria-label": t("Editar red"),
                onclick: () => {
                  ui.editNet = ui.editNet === n.id ? null : n.id;
                  ui.addingNet = false;
                  render();
                },
              },
              "⋯",
            )
          : null,
      ),
    );
  }
  const outside = outsideIps(state);
  if (outside.length) {
    bar.append(
      el(
        "div",
        { class: "net-chip" + (ui.net === "outside" ? " on" : "") },
        el(
          "button",
          {
            type: "button",
            class: "net",
            role: "tab",
            "aria-selected": ui.net === "outside" ? "true" : "false",
            title: t("IPs reclamadas fuera de tus redes"),
            onclick: () => {
              ui.net = "outside";
              ui.sel.clear();
              ui.filter = null;
              render();
            },
          },
          el("span", { class: "net-name" }, t("Otras")),
          el("b", {}, String(outside.length)),
        ),
      ),
    );
  }
  bar.append(
    el(
      "button",
      {
        type: "button",
        class: "net add",
        onclick: () => {
          ui.addingNet = !ui.addingNet;
          ui.editNet = null;
          render();
        },
      },
      "＋ ",
      t("Red"),
    ),
  );
  bar.append(el("span", { class: "spacer" }));
  bar.append(
    el(
      "button",
      { type: "button", class: "btn multi-toggle" + (ui.multi ? " on" : ""), onclick: () => ((ui.multi = !ui.multi), render()) },
      ui.multi ? t("Selección múltiple activa") : t("Seleccionar varias"),
    ),
  );
  bar.append(
    el(
      "button",
      { type: "button", class: "btn primary", disabled: ui.net === "outside", onclick: () => needIp(liveState) },
      "✦ ",
      t("Necesito una IP"),
    ),
  );
  return bar;
}

function needIp(state) {
  const pick = suggestIp(state, ui.net);
  if (!pick) {
    toast(t("No quedan IPs libres en esta red."), "error");
    return;
  }
  ui.sel = new Set([pick.address]);
  ui.anchor = pick.address;
  ui.filter = null;
  render();
  flash(pick.address);
  toast(
    pick.reason === "reserved"
      ? t("Te sugiero {ip}: es tuya y está reservada.", { ip: pick.address })
      : t("Te sugiero {ip}: libre y nadie respondió en 7 días.", { ip: pick.address }),
  );
}

// ---------- Formulario de red (añadir / editar) ----------

function networkForm(state, { firstRun = false } = {}) {
  const editing = ui.editNet != null ? state.networks.find((n) => n.id === ui.editNet) : null;
  const cidr = el("input", {
    class: "in mono",
    placeholder: "192.168.1.0/24",
    value: editing ? editing.cidr : "",
    disabled: !!editing,
    "aria-label": t("Red (CIDR)"),
    oninput: markDirty,
  });
  const name = el("input", {
    class: "in",
    placeholder: t("Nombre (opcional), p. ej. Casa"),
    value: editing ? editing.name : "",
    maxlength: 60,
    "aria-label": t("Nombre de la red"),
    oninput: markDirty,
  });
  const save = async () => {
    const ok = editing
      ? await act("networks/rename", { id: editing.id, name: name.value }, t("Red guardada"))
      : await act("networks/add", { cidr: cidr.value, name: name.value }, t("Red añadida"));
    if (ok) {
      if (!editing) {
        const base = cidr.value.trim().split("/")[0];
        const added = liveState.networks.find((n) => /^\d{1,3}(\.\d{1,3}){3}$/.test(base) && inNetwork(n.cidr, base));
        if (added) ui.net = added.cidr;
        ui.sel.clear();
        ui.addingNet = false;
      }
      ui.editNet = null;
      render();
    }
  };
  const onEnter = (e) => e.key === "Enter" && save();
  cidr.addEventListener("keydown", onEnter);
  name.addEventListener("keydown", onEnter);
  const form = el(
    "div",
    { class: "net-form", id: "net-form" },
    el("div", { class: "form-title" }, editing ? t("Editar red {cidr}", { cidr: editing.cidr }) : t("Añadir una red")),
    el("div", { class: "row" }, cidr, name),
    editing ? null : suggestionChips(cidr, name),
    el(
      "div",
      { class: "row" },
      el("button", { type: "button", class: "btn primary", onclick: save }, editing ? t("Guardar") : t("Añadir red")),
      firstRun
        ? null
        : el(
            "button",
            {
              type: "button",
              class: "btn ghost",
              onclick: () => {
                ui.addingNet = false;
                ui.editNet = null;
                render();
              },
            },
            t("Cancelar"),
          ),
      editing ? el("span", { class: "spacer" }) : null,
      editing ? removeNetworkButton(state, editing) : null,
    ),
    editing ? null : el("div", { class: "hint" }, t("De /22 a /30. No puede solaparse con otra red.")),
  );
  if (!editing) setTimeout(() => cidr.isConnected && !cidr.value && cidr.focus(), 0);
  return form;
}

function removeNetworkButton(state, network) {
  const claimed = state.ips.filter((ip) => inNetwork(network.cidr, ip.address)).length;
  const remove = () =>
    act("networks/remove", { id: network.id }, claimed ? t("Red quitada · sus IPs siguen en «Otras»") : t("Red quitada")).then(
      (ok) => {
        if (ok) {
          ui.editNet = null;
          ui.net = null;
          render();
        }
      },
    );
  if (!claimed) return el("button", { type: "button", class: "btn danger", onclick: remove }, t("Quitar red"));
  return confirmButton({
    label: t("Quitar red"),
    sureLabel: t("¿Quitar? {n} IPs tuyas pasan a «Otras»", { n: claimed }),
    onConfirm: remove,
  });
}

function suggestionChips(cidr, name) {
  const box = el("div", { class: "chips suggestions" });
  suggestions().then((list) => {
    const nets = new Map();
    for (const s of list) {
      // Interfaces muy grandes (p. ej. /16): proponer la /24 que contiene al servidor.
      const prefix = Number(s.cidr.split("/")[1]);
      const cidrText = prefix < 22 ? s.address.split(".").slice(0, 3).join(".") + ".0/24" : s.cidr;
      if (!nets.has(cidrText)) nets.set(cidrText, s.interface);
    }
    if (!nets.size) return;
    box.append(el("span", { class: "hint" }, t("Redes de este servidor:")));
    for (const [c, iface] of nets) {
      box.append(
        el(
          "button",
          {
            type: "button",
            class: "chip",
            title: iface,
            onclick: () => {
              cidr.value = c;
              cidr.setAttribute("data-dirty", "");
              name.focus();
            },
          },
          c,
        ),
      );
    }
  });
  return box;
}

function firstRun() {
  ui.addingNet = true;
  return el(
    "div",
    { class: "first-run" },
    el("div", { class: "logo-grid", "aria-hidden": "true" }, el("i", { class: "use" }), el("i", { class: "res" }), el("i", { class: "occ" }), el("i", {})),
    el("h1", {}, t("Tu inventario de IPs")),
    el(
      "p",
      { class: "lead" },
      t("Añade la red que quieres organizar. Verás cada IP en un mapa: qué está ocupado, qué es tuyo y qué está libre."),
    ),
    networkForm({ networks: [], ips: [] }, { firstRun: true }),
  );
}

// ---------- Resumen y escaneo ----------

function summary(state) {
  const c = counts(state, ui.net);
  const total = c.use + c.res + c.occ + c.free || 1;
  const box = el("div", { class: "sum", id: "sum" });
  // Barra de ocupación: la proporción de la red de un vistazo.
  box.append(
    el(
      "div",
      { class: "occ-bar", role: "img", "aria-label": t("{a} asignadas, {b} reservadas, {c} ocupadas, {d} libres", { a: c.use, b: c.res, c: c.occ, d: c.free }) },
      ["use", "res", "occ", "free"].map((key) => el("i", { class: key + (ui.filter && ui.filter !== key ? " dim" : ""), style: { width: `${(c[key] / total) * 100}%` } })),
    ),
  );
  for (const key of ["use", "res", "occ", "free"]) {
    const on = ui.filter === key;
    box.append(
      el(
        "button",
        {
          type: "button",
          class: "cnt" + (on ? " on" : ""),
          "aria-pressed": on ? "true" : "false",
          title: on ? t("Quitar filtro") : t("Resaltar en el mapa"),
          onclick: () => {
            ui.filter = on ? null : key;
            render({ soft: true });
          },
        },
        el("i", { class: `sw ${key}` }),
        el("b", {}, String(c[key])),
        " ",
        t(STATUS_LABEL[key]),
      ),
    );
  }
  box.append(scanInfo(state));
  return box;
}

function outsideSummary(state) {
  return el(
    "div",
    { class: "sum", id: "sum" },
    el("p", { class: "muted" }, t("IPs tuyas que no pertenecen a ninguna red registrada. Puedes asignarlas o liberarlas igual que en el mapa.")),
    scanInfo(state),
  );
}

function scanInfo(state) {
  const scan = state.scan;
  const box = el("div", { class: "scaninfo" });
  if (scan.running) {
    const pct = scan.total ? Math.round((scan.done / scan.total) * 100) : 0;
    box.append(
      el("span", {}, t("Escaneando… {done}/{total}", { done: scan.done, total: scan.total })),
      el("span", { class: "progress", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100 }, el("i", { style: { width: `${pct}%` } })),
    );
    pollScan();
  } else {
    const min = scan.total ? minutesSince(scan.finished_at) : null;
    box.append(el("span", {}, min == null ? t("Aún sin ping") : t("Último ping {ago}", { ago: agoText(min) })));
    box.append(
      el(
        "button",
        {
          type: "button",
          class: "btn sm ghost",
          onclick: () => act("scan/now", {}, t("Escaneo iniciado")).then(() => pollScan()),
        },
        "↻ ",
        t("Escanear ahora"),
      ),
    );
  }
  return box;
}

function bannerSlot(state) {
  const error = state.scan.error;
  const slot = el("div", { id: "banner-slot" });
  if (!error || ui.dismissedError === error) return slot;
  slot.append(el(
    "div",
    { class: "banner", role: "alert" },
    el("b", {}, t("El ping no funciona: ")),
    el("span", {}, error),
    el("span", { class: "muted" }, " ", t("El inventario sigue funcionando sin datos de ping.")),
    el(
      "button",
      {
        type: "button",
        class: "icon-btn",
        "aria-label": t("Cerrar aviso"),
        onclick: () => {
          ui.dismissedError = error;
          render({ soft: true });
        },
      },
      "×",
    ),
  ));
  return slot;
}

// ---------- Cuadrícula ----------

function cellClass(state, address, cidr) {
  if (isEdge(cidr, address)) return "c edge";
  const status = ipStatus(state, address);
  const info = pingInfo(state, address);
  let cls = `c ${status}`;
  if (status === "free" && info.up === null) cls += " unk";
  if (ui.sel.has(address)) cls += " sel";
  if ((ui.filter && ui.filter !== status) || !matches(state, address, ui.q)) cls += " fade";
  return cls;
}

function cellDot(state, address) {
  const status = ipStatus(state, address);
  const info = pingInfo(state, address);
  if (status === "use") {
    if (info.up === true) return el("i", { class: "dot up" });
    if (info.up === false) return el("i", { class: "dot down" });
    return null;
  }
  // Una reservada que responde es una anomalía: alguien la está usando.
  if (status === "res") return info.up ? el("i", { class: "dot seen" }) : null;
  if (status === "free" && info.recent) return el("i", { class: "dot seen" });
  return null;
}

function cellTitle(state, address, cidr) {
  if (isEdge(cidr, address)) return address === networkHosts(cidr)[0] ? t("Dirección de red") : t("Broadcast");
  const d = deviceOf(state, address);
  return d ? `${address} · ${d.name}` : address;
}

function grid(state) {
  const cidr = ui.net;
  const hosts = networkHosts(cidr);
  const wrap = el("div", { class: "grids" + (state.scan.running ? " scanning" : ""), "aria-label": t("Mapa de {cidr}", { cidr }) });
  for (let i = 0; i < hosts.length; i += 256) {
    const block = hosts.slice(i, i + 256);
    if (hosts.length > 256) {
      wrap.append(el("div", { class: "block-head" }, block[0].replace(/\.\d+$/, ".0/24")));
    }
    // Frontal de switch: orejas de rack, etiqueta de fila (último octeto inicial) y 16 puertos por fila.
    const g = el("div", { class: "grid" });
    block.forEach((address, n) => {
      if (n % 16 === 0) g.append(el("span", { class: "row-label", "aria-hidden": "true" }, "." + address.split(".")[3]));
      const edge = isEdge(cidr, address);
      g.append(
        el(
          "button",
          {
            type: "button",
            class: cellClass(state, address, cidr),
            "data-ip": address,
            title: cellTitle(state, address, cidr),
            disabled: edge,
            "aria-pressed": ui.sel.has(address) ? "true" : "false",
            style: { "--i": String(n) },
          },
          address.split(".")[3],
          edge ? null : cellDot(state, address),
        ),
      );
    });
    wrap.append(el("div", { class: "faceplate" }, el("i", { class: "ear left", "aria-hidden": "true" }), g, el("i", { class: "ear right", "aria-hidden": "true" })));
  }
  attachSelection(wrap, state, hosts.filter((a) => !isEdge(cidr, a)));
  return wrap;
}

function outsideList(state) {
  const list = el("div", { class: "iplist", role: "list" });
  for (const ip of outsideIps(state)) {
    const status = ipStatus(state, ip.address);
    const d = deviceOf(state, ip.address);
    const fade = !matches(state, ip.address, ui.q);
    list.append(
      el(
        "button",
        {
          type: "button",
          class: "iprow" + (ui.sel.has(ip.address) ? " sel" : "") + (fade ? " fade" : ""),
          "data-ip": ip.address,
          role: "listitem",
        },
        el("span", { class: "mono" }, ip.address),
        el("span", { class: `pill ${status}` }, status === "use" ? t("Asignada") : t("Reservada")),
        el("span", { class: "iprow-dev" }, d ? d.name : ip.note || ""),
        cellDot(state, ip.address),
      ),
    );
  }
  attachSelection(list, state, outsideIps(state).map((ip) => ip.address));
  return list;
}

function footer(state) {
  return el(
    "div",
    { class: "mapfoot" },
    el("div", { class: "hover", id: "hover", "aria-live": "off" }, ui.net === "outside" ? "" : t("Pasa el ratón por una IP para ver detalles.")),
    ui.net === "outside"
      ? null
      : el(
          "div",
          { class: "legend" },
          el("span", {}, el("i", { class: "ld up" }), t("equipo responde")),
          el("span", {}, el("i", { class: "ld down" }), t("no responde")),
          el("span", {}, el("i", { class: "ld seen" }), t("respondió hace poco")),
          el("span", {}, el("i", { class: "sw free unk" }), t("sin datos de ping")),
          el("span", { class: "legend-tip" }, t("Shift+clic o arrastra para elegir varias")),
        ),
  );
}

function hoverText(state, address) {
  const status = ipStatus(state, address);
  const ip = ipRecord(state, address);
  const d = deviceOf(state, address);
  const info = pingInfo(state, address);
  const parts = [address];
  if (status === "use") parts.push(d.name);
  else if (status === "res") parts.push(t("reservada") + (ip.note ? ` — ${ip.note}` : ""));
  else if (status === "occ") parts.push(t("responde, alguien la usa"));
  else if (info.recent) parts.push(t("libre · respondió {ago}", { ago: agoText(info.lastUpAgoMin) }));
  else parts.push(info.up === null ? t("libre · sin datos de ping") : t("libre"));
  return parts.join(" · ");
}

// Arrastre con ratón: un único listener global de pointerup.
let drag = null;
let suppressClick = false;
addEventListener("pointerup", () => {
  if (drag?.moved) {
    ui.anchor = drag.start;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    drag = null;
    render();
    return;
  }
  drag = null;
});

// Clic, Shift+clic (rango), Ctrl/⌘+clic o modo táctil (alternar) y arrastre con ratón.
function attachSelection(container, state, selectable) {
  const order = new Map(selectable.map((a, i) => [a, i]));

  const paint = () => {
    for (const node of container.querySelectorAll("[data-ip]")) {
      const on = ui.sel.has(node.dataset.ip);
      node.classList.toggle("sel", on);
      node.setAttribute("aria-pressed", on ? "true" : "false");
    }
  };
  const range = (a, b) => {
    const [x, y] = [order.get(a), order.get(b)].sort((m, n) => m - n);
    return selectable.slice(x, y + 1);
  };
  const commit = () => render({ soft: false });

  container.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest("[data-ip]");
    if (!cell || cell.disabled || e.pointerType !== "mouse" || e.button !== 0) return;
    drag = { start: cell.dataset.ip, base: e.shiftKey || e.ctrlKey || e.metaKey ? new Set(ui.sel) : new Set(), moved: false };
  });
  container.addEventListener("pointerover", (e) => {
    const cell = e.target.closest("[data-ip]");
    if (!cell) return;
    if (ui.net !== "outside") document.getElementById("hover").textContent = hoverText(state, cell.dataset.ip);
    if (!drag || cell.disabled || !(e.buttons & 1) || (cell.dataset.ip === drag.start && !drag.moved)) return;
    drag.moved = true;
    ui.sel = new Set([...drag.base, ...range(drag.start, cell.dataset.ip)]);
    paint();
  });
  container.addEventListener("click", (e) => {
    const cell = e.target.closest("[data-ip]");
    if (!cell || cell.disabled) return;
    if (suppressClick) return;
    const address = cell.dataset.ip;
    if (e.shiftKey && ui.anchor && order.has(ui.anchor)) {
      ui.sel = new Set([...ui.sel, ...range(ui.anchor, address)]);
    } else if (e.ctrlKey || e.metaKey || ui.multi) {
      if (ui.sel.has(address)) ui.sel.delete(address);
      else ui.sel.add(address);
      ui.anchor = address;
    } else {
      ui.sel = ui.sel.size === 1 && ui.sel.has(address) ? new Set() : new Set([address]);
      ui.anchor = address;
    }
    commit();
    if (matchMedia("(max-width: 860px)").matches && ui.sel.size) {
      document.getElementById("panel")?.scrollIntoView({ block: "nearest" });
    }
  });
  container.addEventListener("keydown", (e) => {
    const cell = e.target.closest("[data-ip]");
    if (!cell || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const cells = [...container.querySelectorAll("[data-ip]")];
    const columns = ui.net === "outside" ? 1 : 16;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[e.key];
    const next = cells[cells.indexOf(cell) + step];
    if (next) {
      e.preventDefault();
      next.focus();
      if (ui.net !== "outside") document.getElementById("hover").textContent = hoverText(state, next.dataset.ip);
    }
  });
}

export function sortedSelection() {
  return [...ui.sel].sort(byIp);
}
