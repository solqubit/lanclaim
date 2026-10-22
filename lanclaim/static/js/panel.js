// Panel lateral: acciones según lo seleccionado en el mapa.
import { t, typeLabel } from "./i18n.js";
import { act, editDevice, forgetOs, goto, markDirty, render, ui } from "./main.js";
import { agoText, byIp, deviceIps, deviceOf, ipRecord, ipStatus, minutesSince, networkHosts, isEdge, pingInfo } from "./model.js";
import { confirmButton, deviceInput, el, toast } from "./ui.js";

const PILL = { use: "Asignada", res: "Reservada", occ: "Ocupada por otro", free: "Libre" };

// Firma de lo que muestra el panel: si no cambia, el refresco suave conserva el panel actual.
function panelSig(state, ui) {
  const now = Date.now();
  const rows = [...ui.sel].sort(byIp).map((a) => {
    const ip = ipRecord(state, a);
    const d = deviceOf(state, a);
    const p = pingInfo(state, a, now);
    const checked = state.observations[a]?.checked_at;
    return [a, ipStatus(state, a), ip?.note, d && [d.id, d.name, d.type, d.os, d.host_id], p.up, p.recent, agoText(p.lastUpAgoMin ?? 0), checked && agoText(minutesSince(checked))];
  });
  const reserved = ui.sel.size ? 0 : state.ips.filter((ip) => ip.device_id == null).map((ip) => ip.address + ip.note).join();
  return JSON.stringify([ui.net, rows, reserved, state.devices.length]);
}

export function renderPanel(state, ui) {
  const tone = ui.sel.size === 1 ? " tone-" + ipStatus(state, [...ui.sel][0]) : ui.sel.size > 1 ? " tone-multi" : "";
  const panel = el("aside", { class: "panel" + tone + (ui.sel.size ? " open" : ""), id: "panel", "aria-label": t("Detalles"), "data-sig": panelSig(state, ui) });
  if (ui.sel.size === 0) {
    panel.append(idle(state));
    return panel;
  }
  panel.append(
    el(
      "button",
      { type: "button", class: "icon-btn sheet-close", "aria-label": t("Cerrar"), onclick: () => (ui.sel.clear(), render()) },
      "×",
    ),
  );
  if (ui.sel.size > 1) panel.append(...multi(state));
  else panel.append(...single(state, [...ui.sel][0]));
  return panel;
}

function pingLine(state, address) {
  const info = pingInfo(state, address);
  const obs = state.observations[address];
  if (info.up === null) return t("Sin datos de ping todavía");
  const checked = agoText(minutesSince(obs.checked_at));
  if (info.up) return t("Responde al ping · comprobado {ago}", { ago: checked });
  if (info.lastUpAgoMin != null) return t("No responde · respondió por última vez {ago}", { ago: agoText(info.lastUpAgoMin) });
  return t("No responde · nunca ha respondido");
}

function header(status, address) {
  return [
    el("span", { class: `pill ${status}` }, t(PILL[status])),
    el(
      "div",
      { class: "ip-head" },
      el("h2", { class: "ip mono" }, address),
      el(
        "button",
        { type: "button", class: "icon-btn", title: t("Copiar IP"), "aria-label": t("Copiar IP"), onclick: () => copy(address) },
        "⧉",
      ),
    ),
  ];
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = el("textarea", { value: text, class: "offscreen" });
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(t("{ip} copiada", { ip: text }));
}

// «Vates XCP-ng · en Cubito», con enlace a la máquina física.
function hostLine(state, d) {
  const machine = d.host_id != null ? state.devices.find((x) => x.id === d.host_id) : null;
  if (!d.platform && !machine) return null;
  return el(
    "div",
    { class: "host-line" },
    d.platform && d.type !== "fisica" ? el("span", { class: "platform" }, d.platform) : null,
    machine ? t("en") : null,
    machine ? el("button", { type: "button", class: "link", onclick: () => editDevice(machine.id) }, machine.name) : null,
  );
}

function noteBox(state, address) {
  const ip = ipRecord(state, address);
  const area = el("textarea", {
    class: "in",
    rows: 2,
    maxlength: 2000,
    placeholder: t("Nota de esta IP…"),
    value: ip.note,
    "aria-label": t("Nota"),
    oninput: markDirty,
  });
  // Se guarda sola al dejar de escribir y al salir del campo, sin repintar el panel.
  let saved = ip.note;
  let timer;
  const save = () => {
    clearTimeout(timer);
    const note = area.value.trim();
    if (note === saved) return area.removeAttribute("data-dirty");
    saved = note;
    act("ips/note", { address, note }, t("Nota guardada"), { quiet: true }).then((ok) => ok && area.removeAttribute("data-dirty"));
  };
  area.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(save, 900);
  });
  area.addEventListener("blur", save);
  return el("label", { class: "field" }, el("span", { class: "lbl" }, t("Nota")), area);
}

function assignForm(state, addresses, { label, button, claim }) {
  const input = deviceInput(state, { onForgetOs: forgetOs });
  const submit = () => {
    const device = input.read();
    if (!device) {
      toast(t("Escribe el nombre de un equipo."), "error");
      input.focus();
      return;
    }
    const name = device.name || state.devices.find((d) => d.id === device.id).name;
    act("ips/claim", { addresses, device }, claim ? t("{n} IP(s) para {name}", { n: addresses.length, name }) : t("Asignada a {name}", { name }));
  };
  input.input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  input.input.addEventListener("input", markDirty);
  return el(
    "div",
    { class: "field" },
    el("span", { class: "lbl" }, label),
    input.node,
    el("div", { class: "row" }, el("button", { type: "button", class: "btn primary", onclick: submit }, button)),
  );
}

function releaseButton(state, addresses) {
  const risky = addresses.length > 1 || addresses.some((a) => { const ip = ipRecord(state, a); return ip.device_id != null || ip.note; });
  const message = addresses.length > 1 ? t("{n} IPs liberadas", { n: addresses.length }) : t("{ip} liberada, ya no es tuya", { ip: addresses[0] });
  const run = () => act("ips/release", { addresses }, message).then((ok) => ok && (ui.sel.clear(), render()));
  const label = addresses.length > 1 ? t("Liberar {n}", { n: addresses.length }) : t("Liberar");
  if (!risky) return el("button", { type: "button", class: "btn danger", onclick: run, title: t("Deja de ser tuya") }, label);
  return confirmButton({ label, sureLabel: t("¿Seguro? Deja de ser tuya"), onConfirm: run });
}

function single(state, address) {
  const status = ipStatus(state, address);
  const out = header(status, address);
  out.push(el("p", { class: "sub" }, pingLine(state, address)));

  if (status === "use") {
    const d = deviceOf(state, address);
    const others = deviceIps(state, d.id).filter((a) => a !== address);
    if (pingInfo(state, address).up === false) out.push(el("p", { class: "warn" }, t("El equipo no responde: puede estar apagado.")));
    out.push(
      el(
        "div",
        { class: "dev-card" },
        el("button", { type: "button", class: "dev-name", title: t("Editar equipo"), onclick: () => editDevice(d.id) }, d.name),
        el("div", { class: "muted" }, [typeLabel(d.type), d.os].filter(Boolean).join(" · ")),
        hostLine(state, d),
        others.length
          ? el(
              "div",
              { class: "chips" },
              el("span", { class: "muted small" }, t("También usa:")),
              others.map((a) => el("button", { type: "button", class: "ipc", onclick: () => goto(a) }, a)),
            )
          : null,
      ),
    );
    out.push(noteBox(state, address));
    const change = el("div", { class: "change", hidden: true }, assignForm(state, [address], { label: t("Nuevo equipo para esta IP"), button: t("Cambiar") }));
    out.push(
      el(
        "div",
        { class: "row" },
        el(
          "button",
          {
            type: "button",
            class: "btn",
            onclick: () => {
              change.hidden = !change.hidden;
              if (!change.hidden) change.querySelector("input").focus();
            },
          },
          t("Cambiar equipo"),
        ),
        el(
          "button",
          { type: "button", class: "btn", onclick: () => act("ips/unassign", { addresses: [address] }, t("{ip} vuelve a estar reservada", { ip: address })) },
          t("Quitar equipo"),
        ),
        el("span", { class: "spacer" }),
        releaseButton(state, [address]),
      ),
      change,
    );
  } else if (status === "res") {
    if (pingInfo(state, address).up) out.push(el("p", { class: "warn" }, t("Responde al ping aunque no le has asignado equipo.")));
    out.push(assignForm(state, [address], { label: t("Asignar a un equipo"), button: t("Asignar") }));
    out.push(noteBox(state, address));
    out.push(el("div", { class: "row end" }, releaseButton(state, [address])));
  } else {
    const info = pingInfo(state, address);
    if (status === "occ") out.push(el("p", { class: "warn" }, t("Alguien la está usando. Puedes reclamarla igualmente.")));
    else if (info.recent) out.push(el("p", { class: "warn" }, t("Respondió hace poco: quizá es un equipo apagado.")));
    out.push(
      el(
        "div",
        { class: "row" },
        el(
          "button",
          { type: "button", class: "btn claim", onclick: () => act("ips/claim", { addresses: [address] }, t("{ip} reclamada y reservada para ti", { ip: address })) },
          t("Reclamar"),
        ),
        el("span", { class: "muted small" }, t("queda reservada para ti")),
      ),
    );
    out.push(assignForm(state, [address], { label: t("…o reclamar y asignar a un equipo"), button: t("Reclamar y asignar"), claim: true }));
  }
  return out;
}

function multi(state) {
  const addresses = [...ui.sel].sort(byIp);
  const mine = addresses.filter((a) => ipRecord(state, a));
  const notMine = addresses.filter((a) => !ipRecord(state, a));
  const assigned = mine.filter((a) => ipRecord(state, a).device_id != null);
  const shown = addresses.slice(0, 24).map((a) => el("span", { class: "ipc " + ipStatus(state, a) }, a.split(".").slice(-1)[0]));
  const owners = [...new Set(assigned.map((a) => deviceOf(state, a).name))];
  const out = [
    el("span", { class: "pill res" }, t("{n} seleccionadas", { n: addresses.length })),
    el("div", { class: "chips sel-list" }, shown, addresses.length > 24 ? el("span", { class: "muted small" }, t("y {n} más", { n: addresses.length - 24 })) : null),
    el("p", { class: "sub" }, t("{a} sin reclamar · {b} tuyas · {c} con equipo", { a: notMine.length, b: mine.length, c: assigned.length })),
  ];
  const row = el("div", { class: "row" });
  if (notMine.length) {
    row.append(
      el(
        "button",
        { type: "button", class: "btn claim", onclick: () => act("ips/claim", { addresses: notMine }, t("{n} IPs reclamadas", { n: notMine.length })) },
        t("Reclamar {n}", { n: notMine.length }),
      ),
    );
  }
  if (assigned.length) {
    row.append(
      el(
        "button",
        { type: "button", class: "btn", onclick: () => act("ips/unassign", { addresses: assigned }, t("{n} IPs vuelven a estar reservadas", { n: assigned.length })) },
        t("Quitar equipo de {n}", { n: assigned.length }),
      ),
    );
  }
  if (mine.length) row.append(releaseButton(state, mine));
  out.push(row);
  out.push(assignForm(state, addresses, { label: t("Asignar las {n} a un equipo", { n: addresses.length }), button: t("Asignar"), claim: true }));
  if (owners.length) {
    out.push(el("p", { class: "warn" }, t("{n} ya tienen equipo ({names}) y se reasignarán.", { n: assigned.length, names: owners.join(", ") })));
  }
  out.push(
    el("div", { class: "row" }, el("button", { type: "button", class: "btn ghost sm", onclick: () => (ui.sel.clear(), render()) }, t("Quitar selección"))),
  );
  return out;
}

function idle(state) {
  const out = [
    ui.net === "outside"
      ? el("div", { class: "idle" }, el("h2", {}, t("Elige una IP de la lista")), el("p", { class: "muted" }, t("Puedes asignarla a un equipo, quitárselo o liberarla.")))
      : el("div", { class: "idle" }, el("h2", {}, t("Elige una IP del mapa")), el("p", { class: "muted" }, t("Haz clic en una celda para reclamarla, asignarla a un equipo o liberarla."))),
  ];
  if (ui.net && ui.net !== "outside") {
    const hosts = networkHosts(ui.net).filter((a) => !isEdge(ui.net, a));
    const reserved = hosts.filter((a) => ipStatus(state, a) === "res");
    out.push(
      el(
        "div",
        { class: "field" },
        el("span", { class: "lbl" }, t("Tus reservadas en esta red ({n})", { n: reserved.length })),
        reserved.length
          ? el(
              "div",
              { class: "chips" },
              reserved.map((a) => {
                const note = ipRecord(state, a).note;
                return el("button", { type: "button", class: "ipc res", title: note ? `${a} — ${note}` : a, onclick: () => goto(a) }, "." + a.split(".")[3], note ? " ✎" : "");
              }),
            )
          : el("p", { class: "hint" }, t("Ninguna. Reclama una IP libre para guardarla.")),
      ),
    );
  }
  out.push(
    el(
      "ul",
      { class: "tips muted small" },
      el("li", {}, t("Shift+clic o arrastra para elegir varias.")),
      el("li", {}, el("kbd", {}, "/"), " ", t("busca"), " · ", el("kbd", {}, "Esc"), " ", t("limpia la selección")),
    ),
  );
  return el("div", {}, out);
}
