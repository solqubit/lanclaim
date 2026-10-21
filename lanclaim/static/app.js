"use strict";
const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const labels = {
  available: t("Disponible"),
  assigned: t("Asignada"),
  planned: t("Planificada"),
  review: t("Pendiente de revisión"),
  active: t("Activa"),
  reinstalling: t("En reinstalación"),
  retired: t("Retirada"),
};
const eventLabels = {
  claimed: t("IP reclamada"),
  machine_created: t("Máquina registrada"),
  machine_edited: t("Ficha actualizada"),
  assigned: t("IP asignada"),
  released: t("IP liberada"),
  planned: t("IP planificada"),
  plan_executed: t("Plan ejecutado"),
  cancel_plan: t("Plan cancelado"),
  review_opened: t("Revisión abierta"),
  resolve_review: t("Revisión resuelta"),
  retire: t("Máquina retirada"),
  reinstall: t("Reinstalación iniciada"),
  finish_reinstall: t("Reinstalación finalizada"),
  restore_machine: t("Máquina reactivada"),
  ip_edited: t("Notas actualizadas"),
};
const fieldLabels = {
  name: t("Nombre"),
  description: t("Descripción"),
  os: t("Sistema operativo"),
  hostname: "Hostname",
  mac: t("Dirección MAC"),
  platform: t("Plataforma de virtualización"),
  vm_id: t("Identificador de VM"),
  tags: t("Etiquetas"),
  notes: t("Notas"),
};
let state,
  view = "network",
  filter = "all",
  query = "",
  historyRows = [],
  historyFilter = {},
  historyMore = false,
  toastTimer,
  submitting = false,
  detailKey = null,
  pageGeneration = 0;
let networks = [],
  networkAddresses = [],
  networkSelected = new Set(),
  networkQuery = "",
  networkPage = 0,
  networkBusy = false;
let scan = { status: "idle" },
  observations = new Map(),
  scanTimer;
const scanRunning = () => ["running", "cancelling"].includes(scan.status);
const machine = (id) => state.machines.find((m) => m.id === id);
const ipById = (id) => state.ips.find((ip) => ip.id === id);
const badge = (status) =>
  `<span class="badge ${esc(status)}">${esc(labels[status])}</span>`;
const date = (value) =>
  value
    ? new Date(value).toLocaleString(language, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : t("Actual");
const machineLink = (id) =>
  `<button class="link-button" data-action="machine-detail" data-id="${id}">${esc(machine(id)?.name || t("Máquina"))}</button>`;
const ipLink = (id) =>
  `<button class="link-button ip-address" data-action="ip-detail" data-id="${id}">${esc(ipById(id)?.address || "IP")}</button>`;

function addressIdentity(address, ip) {
  const device = ip?.assignment && machine(ip.assignment.machine_id);
  const name = device?.name || ip?.plan?.target;
  return `<button class="link-button address-identity" data-open-address="${esc(address)}">${name ? `<span class="device-name">${esc(name)}</span><span class="address-secondary">${esc(address)}</span>` : `<span class="ip-address">${esc(address)}</span><span class="subtext">${esc(t("Sin equipo asignado"))}</span>`}</button>`;
}

async function api(path, body) {
  const options =
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": state?.csrf || "",
          },
          body: JSON.stringify(body),
        };
  const response = await fetch("/api/" + path, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error ? t(data.error) : t("No se pudo completar la operación."),
    );
  return data;
}
function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 4500);
}
async function refresh() {
  try {
    state = await api("state");
    $("#global-error").hidden = true;
    $("#nav-count").textContent = state.counts.claimed;
    $("#version").textContent = "v" + state.version;
    renderStats();
    if (view === "history") await loadHistory();
    else renderView();
  } catch (error) {
    $("#global-error").textContent =
      error.message + t(" Comprueba el servidor y pulsa Actualizar.");
    $("#global-error").hidden = false;
    if (!state)
      $("#content").innerHTML = empty(
        t("No pudimos abrir tu espacio"),
        t(
          "Tus datos permanecen en el servidor. Vuelve a intentar la conexión.",
        ),
      );
    throw error;
  }
}
function renderStats() {
  $("#stats").innerHTML = [
    ["claimed", t("Reclamadas")],
    ["available", t("Disponibles")],
    ["assigned", t("Asignadas")],
    ["planned", t("Planificadas")],
    ["review", t("Por revisar")],
  ]
    .map(
      ([key, label]) =>
        `<button class="stat" data-stat="${key}"><strong>${state.counts[key]}</strong> ${label}</button>`,
    )
    .join("");
}
function empty(title, text, buttons = "") {
  return `<div class="empty"><span class="empty-symbol" aria-hidden="true">▦</span><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="actions">${buttons}</div></div>`;
}
function navigate(next, nextFilter = "all") {
  closeInspector();
  pageGeneration++;
  view = next;
  filter = nextFilter;
  query = "";
  historyRows = [];
  historyFilter = {};
  const titles = {
    ips: [
      t("Mi espacio de IPs"),
      t("Tus direcciones, asignaciones y planes."),
      t("ESPACIO DE IPS"),
    ],
    network: [
      t("Mi red"),
      t("Escanea, revisa y reclama tus direcciones."),
      t("MI RED"),
    ],
    machines: [
      t("Mis máquinas"),
      t("Equipos, direcciones y ciclo de vida."),
      t("MÁQUINAS"),
    ],
    history: [
      t("Historial"),
      t("Registro de cambios y asignaciones."),
      t("HISTORIAL"),
    ],
  };
  const [title, subtitle] = titles[view];
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;
  $("#claim").hidden = view === "history" || view === "machines";
  $("#stats").hidden = view !== "ips";
  document.title = title + " · LanClaim";
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === view);
    el.setAttribute("aria-current", el.dataset.nav === view ? "page" : "false");
  });
  if (view === "history") loadHistory().catch(showGlobalError);
  else {
    renderView();
    if (view === "network" && !networks.length) discoverNetworks();
  }
}
function showGlobalError(error) {
  $("#global-error").textContent = error.message;
  $("#global-error").hidden = false;
}
function tabs(items) {
  return html`<div class="tabs" role="group" aria-label="Filtrar inventario">
    ${items.map(([key, label]) => `<button class="tab ${filter === key ? "active" : ""}" data-filter="${key}" aria-pressed="${filter === key}">${label}</button>`).join("")}
  </div>`;
}
function toolbar(items, placeholder) {
  return `<div class="toolbar">${tabs(items)}<input class="search" id="search" type="search" value="${esc(query)}" placeholder="${placeholder}" aria-label="${placeholder}"></div>`;
}
function renderView() {
  if (!state) return;
  if (view === "ips") renderIps();
  else if (view === "machines") renderMachines();
  else if (view === "network") renderNetwork();
  else renderHistory();
}
async function discoverNetworks() {
  try {
    const result = await api("networks");
    networks = result.networks;
    if (view !== "network") return;
    const saved = (() => {
      try {
        return localStorage.getItem("lanclaim.network") || "";
      } catch {
        return "";
      }
    })();
    if (!networkQuery)
      networkQuery =
        saved ||
        (networks.length === 1 && networks[0].size <= 4096
          ? networks[0].cidr
          : "");
    renderNetwork();
    if (networkQuery && !networkAddresses.length) await listNetwork();
  } catch (error) {
    toast(error.message);
  }
}
function networkVisible() {
  const claimed = new Map(state.ips.map((ip) => [ip.address, ip]));
  return networkAddresses.filter(
    (a) =>
      `${a} ${machine(claimed.get(a)?.assignment?.machine_id)?.name || ""} ${claimed.get(a)?.plan?.target || ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (filter === "all" ||
        (filter === "responding"
          ? observations.get(a)?.status === "responding"
          : filter === "mine"
            ? claimed.has(a)
            : !claimed.has(a))),
  );
}
function observationCell(address) {
  const result = observations.get(address);
  if (!result) return html`<span class="muted">Sin comprobar</span>`;
  return `<span class="connection ${result.status}">${result.status === "responding" ? t("Activa") : t("Sin respuesta")}</span><small class="checked-at">${esc(date(result.checked_at))}</small>`;
}
function scanSummary() {
  const names = {
    idle: t("Sin escaneo en curso"),
    running: t("Escaneando…"),
    cancelling: t("Deteniendo…"),
    completed: t("Escaneo terminado"),
    cancelled: t("Escaneo detenido"),
    failed: t("Error de escaneo"),
  };
  return `${names[scan.status]}${scan.range ? ` · ${scan.range}` : ""}${scan.total ? ` · ${scan.completed}/${scan.total} · ${scan.responding} ${t("activas")}` : ""}${scan.error ? ` · ${t(scan.error)}` : ""}`;
}
async function pollScan() {
  clearTimeout(scanTimer);
  try {
    const result = await api("scans");
    scan = result.scan;
    observations = new Map(
      result.observations.map((item) => [item.address, item]),
    );
    if (view === "network") {
      // Keep typing and selections stable while checks arrive.
      if (
        !document.activeElement?.matches("input,select") &&
        $("#inspector").hidden
      ) {
        const focused = document.activeElement;
        const focusSelector =
          focused?.closest("#content") && focused.tagName === "BUTTON"
            ? focused.id
              ? `#${focused.id}`
              : focused.dataset.filter
                ? `[data-filter="${focused.dataset.filter}"]`
                : null
            : null;
        renderNetwork();
        if (focusSelector)
          ($(focusSelector) || $("#scan-start"))?.focus({
            preventScroll: true,
          });
      } else {
        const summary = $("#scan-summary");
        if (summary) summary.textContent = scanSummary();
        document.querySelectorAll("[data-observation]").forEach((cell) => {
          cell.innerHTML = observationCell(cell.dataset.observation);
        });
        const start = $("#scan-start"),
          stop = $("#scan-stop");
        if (start) start.disabled = networkBusy || scanRunning();
        if (stop) {
          stop.hidden = !scanRunning();
          stop.disabled = scan.status === "cancelling";
        }
      }
    }
    if (scanRunning()) scanTimer = setTimeout(pollScan, 1000);
  } catch (error) {
    showGlobalError(error);
    if (scanRunning()) scanTimer = setTimeout(pollScan, 3000);
  }
}
function renderNetwork() {
  renderWithInspector(renderNetworkContent);
}
function renderNetworkContent() {
  const claimed = new Map(state.ips.map((ip) => [ip.address, ip]));
  networkSelected = new Set(
    [...networkSelected].filter((a) => !claimed.has(a)),
  );
  const visible = networkVisible(),
    pages = Math.max(1, Math.ceil(visible.length / 64));
  networkPage = Math.min(networkPage, pages - 1);
  const page = visible.slice(networkPage * 64, (networkPage + 1) * 64);
  const selectable = page.filter((a) => !claimed.has(a));
  $("#content").innerHTML = html` <form id="network-form" class="scan-controls">
      <label class="network-picker"
        >Red del servidor
        <select id="network-choice" aria-label="Red del servidor">
          <option value="">Elegir red / rango manual</option>
          ${networks.map((n) => `<option value="${esc(n.cidr)}" ${n.cidr === networkQuery ? "selected" : ""}>${esc(n.cidr)} · ${esc(n.interface)}</option>`).join("")}
        </select>
      </label>
      <label class="range-picker"
        >Red o rango
        <input
          id="network-range"
          value="${esc(networkQuery)}"
          placeholder="192.168.1.0/24"
          required
          maxlength="200"
        />
      </label>
      <button
        class="primary"
        id="scan-start"
        type="submit"
        ${networkBusy || scanRunning() ? "disabled" : ""}
      >
        Escanear red
      </button>
      <button
        class="secondary"
        type="button"
        data-action="list-network"
        ${networkBusy ? "disabled" : ""}
      >
        Ver rango
      </button>
    </form>
    <div class="scan-feedback">
      <span id="scan-summary" role="status">${esc(scanSummary())}</span>
      <button
        id="scan-stop"
        class="quiet"
        data-action="stop-scan"
        ${scanRunning() ? "" : "hidden"}
        ${scan.status === "cancelling" ? "disabled" : ""}
      >
        Detener
      </button>
    </div>
    <section class="panel network-table">
      <div class="network-toolbar">
        ${tabs([
          ["all", t("Todas")],
          ["responding", t("Activas")],
          ["mine", t("Mis IPs")],
          ["outside", t("Sin reclamar")],
        ])}
        <input
          class="search"
          id="search"
          type="search"
          value="${esc(query)}"
          placeholder="Buscar IP o equipo…"
          aria-label="Buscar IP o equipo…"
        />
        <button
          class="secondary"
          data-action="claim-selected"
          ${networkSelected.size ? "" : "disabled"}
        >
          Reclamar (${networkSelected.size})
        </button>
      </div>
      ${
        page.length
          ? html`<div class="table-wrap">
                <table class="network-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          id="select-network-page"
                          aria-label="Seleccionar IPs sin reclamar de esta página"
                          ${selectable.length && selectable.every((a) => networkSelected.has(a)) ? "checked" : ""}
                          ${selectable.length ? "" : "disabled"}
                        />
                      </th>
                      <th>Equipo / IP</th>
                      <th>Conectividad</th>
                      <th>Mi inventario</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${page
                      .map((address) => {
                        const ip = claimed.get(address);
                        return html`<tr
                          data-address="${esc(address)}"
                          class="${networkSelected.has(address) ? "selected-row" : ""}"
                        >
                          <td>
                            <input
                              type="checkbox"
                              data-network-address="${esc(address)}"
                              aria-label="Reclamar ${esc(address)}"
                              ${ip ? "disabled checked" : networkSelected.has(address) ? "checked" : ""}
                            />
                          </td>
                          <td>${addressIdentity(address, ip)}</td>
                          <td data-observation="${esc(address)}">
                            ${observationCell(address)}
                          </td>
                          <td>
                            ${ip ? badge(ip.status) : html`<span class="muted">Sin reclamar</span>`}
                          </td>
                          <td>
                            ${ip ? html`<button class="row-action" data-action="ip-detail" data-id="${ip.id}">Ver IP</button>` : html`<button class="row-action" data-open-address="${esc(address)}">Añadir equipo</button>`}
                          </td>
                        </tr>`;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>
              <div class="panel-bottom">
                <span
                  >${visible.length} direcciones · ${networkSelected.size}
                  seleccionadas</span
                >
                <div class="actions">
                  <button
                    class="quiet"
                    data-action="network-prev"
                    ${networkPage === 0 ? "disabled" : ""}
                  >
                    ← Anterior
                  </button>
                  <span>${networkPage + 1} / ${pages}</span
                  ><button
                    class="quiet"
                    data-action="network-next"
                    ${networkPage + 1 >= pages ? "disabled" : ""}
                  >
                    Siguiente →
                  </button>
                </div>
              </div>`
          : empty(
              networkAddresses.length
                ? t("Sin direcciones con este filtro")
                : t("Elige tu red para empezar"),
              networkAddresses.length
                ? t("Cambia el filtro para ver otras direcciones.")
                : t(
                    "Escanea para ver qué IPs responden, o abre el rango para reclamarlas.",
                  ),
            )
      }
    </section>
    <details class="scan-help">
      <summary>Acerca del escaneo</summary>
      <p>
        Comprueba respuestas ICMP desde el servidor. Un firewall puede
        impedirlas. Hasta 1024 IPv4 por escaneo; no modifica tus asignaciones.
        Los resultados muestran la fecha de la última comprobación.
      </p>
      <p>
        En VM o WSL2, elige la red que el servidor puede alcanzar. Ver rango
        admite hasta 4096 direcciones e incluye los extremos de una subred; el
        escaneo CIDR omite red y broadcast.
      </p>
    </details>`;
  $("#network-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (networkBusy || scanRunning()) return;
    networkQuery = $("#network-range").value.trim();
    try {
      // Validate the scan before changing the visible range.
      const result = await api("scans/start", { addresses: networkQuery });
      scan = result.scan;
      await listNetwork();
      await pollScan();
    } catch (error) {
      toast(error.message);
      await pollScan();
    }
  });
}
async function listNetwork() {
  if (networkBusy) return;
  networkBusy = true;
  renderNetwork();
  try {
    const result = await api("commands/preview_claim", {
      addresses: networkQuery,
    });
    networkAddresses = result.addresses;
    networkSelected.clear();
    networkPage = 0;
    try {
      localStorage.setItem("lanclaim.network", networkQuery);
    } catch {
      /* Browser storage is optional. */
    }
    $("#global-error").hidden = true;
  } catch (error) {
    networkAddresses = [];
    networkSelected.clear();
    throw error;
  } finally {
    networkBusy = false;
    if (view === "network") renderNetwork();
  }
}
function matchingIps() {
  return state.ips.filter((ip) => {
    const matches =
      filter === "all" ||
      (filter === "assigned"
        ? !!ip.assignment
        : filter === "planned"
          ? !!ip.plan
          : filter === "reusable"
            ? ip.reusable
            : ip.status === filter);
    const m = ip.assignment && machine(ip.assignment.machine_id);
    return (
      matches &&
      `${ip.address} ${ip.notes} ${m?.name || ""} ${m?.tags || ""} ${ip.plan?.target || ""}`
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  });
}
function ipRows(ips) {
  return ips
    .map((ip) => {
      const m = ip.assignment && machine(ip.assignment.machine_id);
      return html`<tr data-address="${esc(ip.address)}">
        <td>
          ${addressIdentity(ip.address, ip)}${ip.reusable ? `<span class="subtext">${t("Reutilizable")}</span>` : ""}
        </td>
        <td>
          ${badge(ip.status)}${ip.review && (ip.assignment || ip.plan) ? `<span class="subtext">${ip.assignment ? t("Asignación conservada") : t("Plan conservado")}</span>` : ""}
        </td>
        <td>
          ${m ? esc(m.os || m.hostname || t("Sin sistema registrado")) + (m.lifecycle === "reinstalling" ? `<span class="subtext">${t("En reinstalación")}</span>` : "") : ip.plan ? t("Destino previsto") : "—"}
        </td>
        <td class="ip-tags-column">
          ${
            m?.tags
              ? m.tags
                  .split(",")
                  .filter(Boolean)
                  .slice(0, 3)
                  .map((t) => `<span class="tag">${esc(t.trim())}</span>`)
                  .join("")
              : '<span class="muted">—</span>'
          }
        </td>
        <td>
          <button class="row-action" data-action="ip-detail" data-id="${ip.id}">
            Ver IP
          </button>
        </td>
      </tr>`;
    })
    .join("");
}
function renderIps() {
  renderWithInspector(renderIpsContent);
}
function renderIpsContent() {
  const ips = matchingIps();
  $("#content").innerHTML = html`<section class="panel">
    <div class="panel-title">
      <div>
        <h2>
          Direcciones de mi espacio
          <span class="count-pill">${state.ips.length}</span>
        </h2>
        <p>
          Reclamar una IP la incorpora a tu inventario; no la ocupa en la red.
        </p>
      </div>
    </div>
    ${toolbar(
      [
        ["all", t("Todas")],
        ["available", t("Disponibles")],
        ["assigned", t("Asignadas")],
        ["planned", t("Planificadas")],
        ["review", t("Por revisar")],
        ["reusable", t("Reutilizables")],
      ],
      t("Buscar IP, máquina o etiqueta…"),
    )}${
      ips.length
        ? html`<div class="table-wrap">
              <table class="ip-table">
                <thead>
                  <tr>
                    <th>Equipo / IP</th>
                    <th>Estado</th>
                    <th>Detalles</th>
                    <th class="ip-tags-column">Etiquetas</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  ${ipRows(ips)}
                </tbody>
              </table>
            </div>
            <div class="panel-bottom">
              <span>${ips.length} direcciones en esta vista</span
              ><span>Asignaciones e historial persistentes</span>
            </div>`
        : empty(
            state.ips.length
              ? t("Sin resultados en esta vista")
              : t("Tu próximo proyecto empieza con una IP"),
            state.ips.length
              ? t("Prueba otro filtro o cambia la búsqueda.")
              : t(
                  "Añade una dirección o un rango. Puedes mantenerlo disponible, planificarlo o asignarlo cuando quieras.",
                ),
            state.ips.length
              ? ""
              : t(
                  '<button class="primary" data-action="claim">＋ Reclamar mis primeras IPs</button>',
                ),
          )
    }
  </section> `;
}
function renderMachines() {
  renderWithInspector(renderMachinesContent);
}
function renderMachinesContent() {
  const list = state.machines.filter(
    (m) =>
      (filter === "all" || m.lifecycle === filter) &&
      Object.values(m).join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  $("#content").innerHTML = html`<section class="panel">
    <div class="panel-title">
      <div>
        <h2>
          Inventario de máquinas
          <span class="count-pill">${state.machines.length}</span>
        </h2>
        <p>
          ${state.counts.retired} retiradas · Sus direcciones e historial siguen
          disponibles.
        </p>
      </div>
    </div>
    ${toolbar(
      [
        ["all", t("Todas")],
        ["active", t("Activas")],
        ["reinstalling", t("En reinstalación")],
        ["retired", t("Retiradas")],
      ],
      t("Buscar nombre, hostname, etiqueta…"),
    )}${
      list.length
        ? html`<div class="table-wrap">
            <table class="machine-table">
              <thead>
                <tr>
                  <th>Máquina</th>
                  <th>Sistema operativo</th>
                  <th>Direcciones IP</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${list
                  .map((m) => {
                    const ips = state.ips.filter(
                      (ip) => ip.assignment?.machine_id === m.id,
                    );
                    return html`<tr data-machine="${m.id}">
                      <td>
                        ${machineLink(m.id)}<small class="checked-at"
                          >${esc(m.hostname)}</small
                        >
                      </td>
                      <td>${esc(m.os || "—")}</td>
                      <td>
                        ${ips.length ? ips.map((ip) => ipLink(ip.id)).join(" · ") : "—"}
                      </td>
                      <td>${badge(m.lifecycle)}</td>
                      <td>
                        <button
                          class="row-action"
                          data-action="machine-detail"
                          data-id="${m.id}"
                        >
                          Administrar
                        </button>
                      </td>
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>`
        : empty(
            state.machines.length
              ? t("Sin máquinas en esta vista")
              : t("Dale nombre a tu infraestructura"),
            t(
              "Abre una IP en Red o Mis IPs y añade su equipo. Aparecerá aquí automáticamente.",
            ),
            t(
              '<button class="primary" data-nav="network">Añadir equipo desde una IP</button>',
            ),
          )
    }
  </section>`;
}
function detailText(detail) {
  return Object.entries(detail)
    .map(([key, value]) => {
      if (value && typeof value === "object")
        return `${fieldLabels[key] || key}: ${value.before || "—"} → ${value.after || "—"}`;
      const label =
        {
          address: "IP",
          machine: t("Máquina"),
          reason: t("Motivo"),
          target: t("Destino"),
          previous: t("Estado anterior"),
          record_id: t("Registro"),
          assignment_id: t("Asignación"),
          before: t("Anterior"),
        }[key] ||
        fieldLabels[key] ||
        key;
      return `${label}: ${value || "—"}`;
    })
    .join(" · ");
}
function timeline(rows) {
  return `<div class="timeline">${rows.map((e) => `<article class="event"><span class="event-dot" aria-hidden="true"></span><div><strong>${esc(eventLabels[e.kind] || e.kind)}</strong><p>${esc(detailText(e.detail))}</p><div class="event-links">${e.ip_id ? ipLink(e.ip_id) : ""}${e.machine_id ? machineLink(e.machine_id) : ""}</div></div><time datetime="${esc(e.at)}">${esc(date(e.at))}</time></article>`).join("")}</div>`;
}
async function loadHistory(append = false) {
  const generation = ++pageGeneration;
  const params = new URLSearchParams(historyFilter);
  if (append && historyRows.length) params.set("before", historyRows.at(-1).id);
  const { events } = await api("history?" + params);
  if (generation !== pageGeneration || view !== "history") return;
  historyRows = append ? [...historyRows, ...events] : events;
  historyMore = events.length === 100;
  renderHistory();
}
function renderHistory() {
  renderWithInspector(renderHistoryContent);
}
function renderHistoryContent() {
  const title = historyFilter.ip_id
    ? t("Historial de ") + ipById(Number(historyFilter.ip_id))?.address
    : historyFilter.machine_id
      ? t("Historial de ") + machine(Number(historyFilter.machine_id))?.name
      : t("Actividad del inventario");
  $("#content").innerHTML = html`<section class="panel">
    <div class="panel-title">
      <div>
        <h2>${esc(title)}</h2>
        <p>Reclamaciones, cambios, asignaciones y ciclos de vida.</p>
      </div>
      ${Object.keys(historyFilter).length ? t('<button class="quiet" data-action="all-history">Ver todo</button>') : ""}
    </div>
    ${historyRows.length ? timeline(historyRows) : empty(t("Todavía no hay movimientos"), t("Aquí aparecerá la historia de tu inventario."))}${historyMore ? t('<button class="secondary load-more" data-action="more-history">Cargar anteriores</button>') : ""}
  </section>`;
}
let inspectorHistory = [],
  inspectorTrigger = null,
  inspectorAnchor = null;

// Keep the live form outside table rendering so filters and refreshes preserve drafts.
function renderWithInspector(render) {
  const panel = $("#inspector");
  const focused = panel.contains(document.activeElement)
    ? document.activeElement
    : null;
  $("#workspace-layout").append(panel);
  render();
  placeInspector();
  if (focused?.isConnected) focused.focus({ preventScroll: true });
}
function placeInspector() {
  const panel = $("#inspector");
  if (panel.hidden) return;
  const rows = [
    ...document.querySelectorAll(
      "#content tr[data-address], #content tr[data-machine]",
    ),
  ];
  const row = rows.find((row) =>
    inspectorAnchor?.address
      ? row.dataset.address === inspectorAnchor.address
      : inspectorAnchor?.machine &&
        row.dataset.machine === inspectorAnchor.machine,
  );
  const oldRow = $("#expanded-ip-row");
  if (oldRow && oldRow.previousElementSibling === row && oldRow.contains(panel))
    return;
  $("#workspace-layout").prepend(panel);
  oldRow?.remove();
  document
    .querySelectorAll(".inspected-row")
    .forEach((row) => row.classList.remove("inspected-row"));
  if (row) {
    const expanded = document.createElement("tr"),
      cell = document.createElement("td");
    expanded.id = "expanded-ip-row";
    cell.colSpan = row.cells.length;
    cell.append(panel);
    expanded.append(cell);
    row.after(expanded);
    row.classList.add("inspected-row");
  }
}

function openInspector(title, content, { root = false } = {}) {
  const panel = $("#inspector"),
    body = $("#inspector-body");
  if (root || panel.hidden) inspectorHistory = [];
  else
    inspectorHistory.push({
      title: $("#inspector-title").textContent,
      nodes: [...body.childNodes],
      detailKey,
      scroll: panel.scrollTop,
      focus: panel.contains(document.activeElement)
        ? document.activeElement
        : null,
    });
  if (!panel.contains(document.activeElement)) {
    inspectorTrigger = document.activeElement;
    const row = inspectorTrigger?.closest("tr[data-address], tr[data-machine]");
    if (row && !inspectorAnchor)
      inspectorAnchor = {
        address: row.dataset.address,
        machine: row.dataset.machine,
      };
  }
  if (root || panel.hidden) panel.style.removeProperty("--inspector-height");
  else
    panel.style.setProperty(
      "--inspector-height",
      `${Math.ceil(body.getBoundingClientRect().height)}px`,
    );
  detailKey = null;
  $("#inspector-title").textContent = title;
  body.innerHTML = content;
  panel.hidden = false;
  $("#workspace-layout").classList.add("inspector-open");
  panel.scrollTop = 0;
  placeInspector();
  updateInspectorBack();
  $("#inspector-title").focus({ preventScroll: true });
  const bounds = $(".inspector-heading").getBoundingClientRect();
  if (bounds.top < 0 || bounds.bottom > window.innerHeight)
    panel.scrollIntoView({ block: "start", behavior: "instant" });
}
function updateInspectorBack() {
  const previous = inspectorHistory.at(-1);
  $("#inspector-back").hidden = false;
  $("#inspector-back").textContent = previous?.detailKey?.startsWith("ip:")
    ? t("← Volver a la IP")
    : previous
      ? t("← Volver")
      : t("← Volver a la lista");
}
async function backInspector() {
  if (submitting) return;
  const previous = inspectorHistory.pop();
  if (!previous) {
    closeInspector();
    return;
  }
  $("#inspector-title").textContent = previous.title;
  $("#inspector-body").replaceChildren(...previous.nodes);
  detailKey = previous.detailKey;
  $("#inspector").scrollTop = previous.scroll;
  updateInspectorBack();
  (previous.focus?.isConnected ? previous.focus : $("#inspector-title")).focus({
    preventScroll: true,
  });
  if (detailKey && $("#detail-events")) {
    const [kind, id] = detailKey.split(":");
    await loadDetailHistory(
      { [kind === "ip" ? "ip_id" : "machine_id"]: Number(id) },
      detailKey,
    );
  }
}
function closeInspector(force = false) {
  if ((submitting && !force) || $("#inspector").hidden) return;
  const restoreFocus = $("#inspector").contains(document.activeElement);
  $("#inspector").hidden = true;
  $("#workspace-layout").classList.remove("inspector-open");
  inspectorHistory = [];
  detailKey = null;
  $("#inspector-body").replaceChildren();
  $("#workspace-layout").append($("#inspector"));
  $("#expanded-ip-row")?.remove();
  document
    .querySelectorAll(".inspected-row")
    .forEach((row) => row.classList.remove("inspected-row"));
  inspectorAnchor = null;
  if (restoreFocus && inspectorTrigger?.isConnected)
    inspectorTrigger.focus({ preventScroll: true });
}
function field(name, label, value = "", options = {}) {
  const { required = false, area = false, wide = false } = options;
  return `<label class="${wide ? "wide" : ""}">${esc(label)}${required ? " *" : ""}${area ? `<textarea name="${name}" maxlength="4000" ${required ? "required" : ""}>${esc(value)}</textarea>` : `<input name="${name}" value="${esc(value)}" maxlength="200" ${required ? "required" : ""}>`}</label>`;
}
function form(content, submit = t("Guardar"), danger = false) {
  return html`<form id="action-form">
    ${content}
    <div class="form-error" role="alert" hidden></div>
    <div class="inspector-actions">
      <button type="button" class="secondary" data-action="close">
        Cancelar</button
      ><button class="${danger ? "danger" : "primary"}" type="submit">
        ${submit}
      </button>
    </div>
  </form>`;
}
function bindForm(handler) {
  $("#action-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;
    const formEl = event.currentTarget;
    const data = Object.fromEntries(new FormData(formEl));
    submitting = true;
    const button = $("[type=submit]", formEl);
    button.disabled = true;
    $(".form-error", formEl).hidden = true;
    try {
      await handler(data);
    } catch (error) {
      $(".form-error", formEl).textContent = error.message;
      $(".form-error", formEl).hidden = false;
    } finally {
      submitting = false;
      button.disabled = false;
    }
  });
}
async function mutate(action, data, message) {
  const result = await api("commands/" + action, data);
  closeInspector(true);
  toast(message || t("Cambio guardado."));
  try {
    await refresh();
  } catch {
    /* The write succeeded; the global banner offers a refresh. */
  }
  return result;
}
function claimForm() {
  openInspector(
    t("Reclamar direcciones IP"),
    form(
      html`<p class="help">
          Añade IPs individuales, rangos inclusivos o redes CIDR. Máximo 4096
          direcciones por operación. Una red CIDR incluye todas sus direcciones,
          también los extremos.
        </p>
        ${field("addresses", t("Direcciones o rangos"), "", { required: true, area: true })}
        <p class="help">
          Ejemplos: 192.168.1.20 · 192.168.1.30-192.168.1.40 · 10.0.0.0/28<br />Separa
          entradas con espacios, comas o saltos de línea.
        </p>
        <div id="claim-preview"></div>`,
      t("Revisar direcciones"),
    ),
  );
  $("textarea[name=addresses]").maxLength = 100000;
  let reviewed = "";
  $("textarea").addEventListener("input", () => {
    reviewed = "";
    $("#claim-preview").innerHTML = "";
    $("[type=submit]", $("#action-form")).textContent = t(
      "Revisar direcciones",
    );
  });
  bindForm(async (data) => {
    if (reviewed === data.addresses) {
      const result = await mutate(
        "claim",
        data,
        t("Direcciones incorporadas a tu espacio."),
      );
      toast(
        html`${result.added} IPs nuevas · ${result.existing} ya estaban
        reclamadas.`,
      );
    } else {
      const result = await api("commands/preview_claim", data);
      reviewed = data.addresses;
      $("#claim-preview").innerHTML = html`<div class="notice">
        <strong
          >${result.added} nuevas · ${result.existing} ya reclamadas</strong
        ><br />${result.addresses.slice(0, 20).map(esc).join(", ")}${result.addresses.length > 20 ? html` … y ${result.addresses.length - 20} más` : ""}<br />Las
        existentes conservarán su estado e historial.
      </div>`;
      $("[type=submit]", $("#action-form")).textContent = t(
        "Confirmar reclamación",
      );
    }
  });
}
function machineForm(id) {
  const m = id ? machine(id) : {};
  openInspector(
    id ? t("Editar máquina") : t("Nueva máquina"),
    form(
      html`<p class="help">
          Registra su identidad una vez. Sus IPs y su historial la acompañarán
          durante todo su ciclo de vida.
        </p>
        <div class="form-grid">
          ${Object.entries(fieldLabels)
            .map(([key, label]) =>
              field(key, label, m[key] || "", {
                required: key === "name",
                area: ["description", "notes"].includes(key),
                wide: ["description", "notes"].includes(key),
              }),
            )
            .join("")}
        </div>`,
    ),
  );
  bindForm((data) =>
    mutate(
      id ? "edit_machine" : "create_machine",
      { ...data, ...(id ? { id } : {}) },
      id
        ? t("Ficha actualizada. Las asignaciones se conservan.")
        : t("Máquina registrada."),
    ),
  );
}
function ipAction(action, id, title, description, tone = "") {
  return `<button class="ip-action ${tone}" data-action="${action}" data-id="${id}"><span><strong>${esc(title)}</strong><small>${esc(description)}</small></span><span aria-hidden="true">→</span></button>`;
}
function openAddress(address) {
  const ip = state.ips.find((item) => item.address === address);
  if (ip) return showIp(ip.id);
  ipMachineForm(address);
}
function ipMachineForm(address, { edit = false, replace = false } = {}) {
  const ip = state.ips.find((item) => item.address === address);
  const current = ip?.assignment && machine(ip.assignment.machine_id);
  const existing = state.machines.filter(
    (m) => m.lifecycle === "active" && m.id !== current?.id,
  );
  const values = edit ? current : {};
  const extraFields = Object.entries(fieldLabels).filter(
    ([key]) => !["name", "os"].includes(key),
  );
  inspectorAnchor = { address };
  openInspector(
    current?.name ? `${current.name} · ${address}` : address,
    form(
      html`
        <div class="ip-form-intro">
          <h3>
            ${edit ? t("Datos del equipo") : replace ? t("Cambiar el equipo de esta IP") : t("¿Qué equipo usa esta IP?")}
          </h3>
          <p>
            ${edit ? t("Actualiza su ficha. La IP y el historial se conservan.") : replace ? html`Equipo actual: <strong>${esc(current?.name)}</strong>. El cambio afecta solo a esta IP; las demás asignaciones se conservan.` : ip ? t("Escribe un nombre y guarda. El equipo se registrará aquí mismo.") : t("Al guardar, la IP quedará reclamada y vinculada al equipo. No se cambia la configuración de red del equipo.")}
          </p>
        </div>
        ${
          !edit && existing.length
            ? html`<label
                >Equipo<select id="ip-machine-mode" name="mode">
                  <option value="create">Registrar uno nuevo</option>
                  <option value="existing">Elegir uno que ya registré</option>
                </select></label
              >`
            : ""
        }
        ${!ip ? html`<button type="button" class="row-action save-ip-only" data-claim-address="${esc(address)}">Guardar solo la IP, sin equipo</button>` : ""}
        <div id="ip-new-machine">
          <div class="form-grid">
            ${field("name", t("Nombre del equipo"), values?.name || (!replace && ip?.plan?.target) || "", { required: true })}${field("os", t("Sistema operativo"), values?.os || "")}
          </div>
          <details class="optional-fields">
            <summary>Más datos del equipo (opcional)</summary>
            <div class="form-grid">
              ${extraFields.map(([key, label]) => field(key, label, values?.[key] || "", { area: ["description", "notes"].includes(key), wide: ["description", "notes"].includes(key) })).join("")}
            </div>
          </details>
        </div>
        ${
          !edit && existing.length
            ? html`<label id="ip-existing-machine" hidden
                >Equipo registrado<select name="machine_id" disabled required>
                  <option value="">Selecciona un equipo</option>
                  ${existing.map((m) => `<option value="${m.id}">${esc(m.name)}${m.hostname ? " · " + esc(m.hostname) : ""}</option>`).join("")}
                </select></label
              >`
            : ""
        }
        ${replace ? field("reason", t("Nota del cambio (opcional)"), "") : ""}
        ${edit && state.ips.filter((i) => i.assignment?.machine_id === current?.id).length > 1 ? html`<p class="help">Este equipo tiene varias IPs. Los datos de su ficha se actualizan para todas; sus asignaciones se conservan.</p>` : ""}
      `,
      edit
        ? t("Guardar datos")
        : replace
          ? t("Guardar cambio de equipo")
          : t("Guardar IP y equipo"),
    ),
  );
  $("#ip-machine-mode")?.addEventListener("change", (event) => {
    const useExisting = event.target.value === "existing";
    $("#ip-new-machine").hidden = useExisting;
    $("#ip-existing-machine").hidden = !useExisting;
    $("#ip-new-machine")
      .querySelectorAll("input,textarea")
      .forEach((input) => (input.disabled = useExisting));
    $("#ip-existing-machine select").disabled = !useExisting;
  });
  bindForm(async (data) => {
    const result = await mutate(
      "save_ip_machine",
      {
        address,
        mode: edit ? "edit" : data.mode || "create",
        assignment_id: ip?.assignment?.id ?? null,
        machine: Object.fromEntries(
          Object.keys(fieldLabels).map((key) => [key, data[key] || ""]),
        ),
        machine_id: data.machine_id ? Number(data.machine_id) : undefined,
        plan_id: ip?.plan?.id,
        reason:
          data.reason || (replace ? t("Cambio de equipo desde la IP.") : ""),
      },
      t("IP y equipo guardados."),
    );
    await showIp(result.ip_id);
  });
}
async function showIp(id) {
  const ip = ipById(id);
  if (!ip) return;
  const a = ip.assignment,
    p = ip.plan,
    m = a && machine(a.machine_id);
  const reviews = state.reviews.filter((r) => r.ip_id === id && !r.closed_at);
  const currentIps = m
    ? state.ips.filter((i) => i.assignment?.machine_id === m.id)
    : [];
  const mainActions = [];
  if (m) {
    mainActions.push(
      ipAction(
        "edit-ip-machine",
        id,
        t("Editar datos del equipo"),
        t("Nombre, sistema operativo y otros datos de este equipo."),
      ),
    );
    mainActions.push(
      ipAction(
        m.lifecycle === "reinstalling" ? "finish_reinstall" : "reinstall",
        m.id,
        m.lifecycle === "reinstalling"
          ? t("Ya terminé de formatear")
          : t("Voy a formatear este equipo"),
        m.lifecycle === "reinstalling"
          ? t("Vuelve a activo conservando sus IPs y su historial.")
          : t(
              "Conserva esta IP y las demás del equipo durante la reinstalación.",
            ),
      ),
    );
    mainActions.push(
      ipAction(
        "release",
        id,
        t("Dejar esta IP disponible"),
        t("Desvincula el equipo de esta IP. La dirección sigue siendo tuya."),
      ),
    );
    if (!ip.review)
      mainActions.push(
        ipAction(
          "replace-ip-machine",
          id,
          t("Esta IP ahora es de otro equipo"),
          t("Guarda el equipo anterior en el historial y asigna el nuevo."),
        ),
      );
  } else if (!ip.review) {
    mainActions.push(
      ipAction(
        "assign",
        id,
        p ? t("Ya tengo el equipo para esta IP") : t("Añadir equipo a esta IP"),
        t("Regístralo aquí o elige uno existente, sin salir de la IP."),
        "emphasized",
      ),
    );
    if (!p)
      mainActions.push(
        ipAction(
          "plan",
          id,
          t("Guardar para más adelante"),
          t("Reserva esta IP en tu inventario para un uso futuro."),
        ),
      );
  }
  if (p)
    mainActions.push(
      ipAction(
        "cancel-plan",
        p.id,
        t("Quitar la reserva"),
        t(
          "La IP sigue reclamada y vuelve a estar disponible si no tiene incidencias.",
        ),
      ),
    );
  const history = state.assignments.filter((r) => r.ip_id === id).reverse();
  inspectorAnchor = { address: ip.address };
  openInspector(
    m?.name ? `${m.name} · ${ip.address}` : ip.address,
    html`
      <div class="ip-overview">
        <div class="ip-state-line">
          ${badge(ip.status)}${m?.lifecycle === "reinstalling" ? badge("reinstalling") : ""}
        </div>
        <span class="detail-label"
          >${m ? t("Equipo actual") : p ? t("Reservada para") : t("Equipo")}</span
        >
        <h3>${esc(m?.name || p?.target || t("Sin equipo asignado"))}</h3>
        <p>
          ${esc(m ? [m.os, m.hostname].filter(Boolean).join(" · ") || t("Puedes completar sus datos cuando quieras.") : p?.notes || t("Puedes usarla ahora o guardarla para después."))}
        </p>
        ${observations.has(ip.address) ? `<div class="ip-connectivity">${observationCell(ip.address)}</div>` : ""}
        ${ip.notes ? `<p>${esc(ip.notes)}</p>` : ""}
      </div>
      ${reviews
        .map(
          (r) =>
            html`<div class="review-item">
              <p>${esc(r.reason)}</p>
              <button
                class="row-action"
                data-action="resolve-review"
                data-id="${r.id}"
              >
                Marcar incidencia como resuelta
              </button>
            </div>`,
        )
        .join("")}
      <div class="ip-actions">${mainActions.join("")}</div>
      <details class="ip-more">
        <summary>Notas y otras opciones</summary>
        <div class="ip-actions">
          ${ipAction("ip-notes", id, t("Notas de esta IP"), t("Guarda información útil sobre esta dirección."))}
          ${ipAction("review", id, t("Hay un problema con esta IP"), t("Anota un posible conflicto para revisarlo sin perder la asignación."))}
          ${m ? ipAction("retire", m.id, t("Ya no uso este equipo"), html`Retira el equipo y libera sus ${currentIps.length} IPs. Se conservan las direcciones y el historial.`, "destructive") : ""}
        </div>
      </details>
      <details class="ip-more">
        <summary>Historial de esta IP</summary>
        <div class="detail-section">
          ${history.map((r) => `<div class="assignment-line"><strong>${esc(machine(r.machine_id)?.name)}</strong><span class="subtext">${esc(date(r.started_at))} → ${esc(date(r.ended_at))}${r.end_reason ? " · " + esc(r.end_reason) : ""}</span></div>`).join("") || html`<p class="help">Todavía no se ha asignado a ninguna máquina.</p>`}
          <div id="detail-events">Cargando…</div>
          <button class="row-action" data-action="ip-history" data-id="${id}">
            Consultar todo el historial →
          </button>
        </div>
      </details>
      <p class="ip-footnote">
        Esta IP permanece en tu inventario aunque el equipo esté apagado.
      </p>
    `,
    { root: true },
  );
  detailKey = "ip:" + id;
  await loadDetailHistory({ ip_id: id }, detailKey);
}
async function showMachine(id) {
  inspectorAnchor = { machine: String(id) };
  const m = machine(id);
  if (!m) return;
  const ips = state.ips.filter((ip) => ip.assignment?.machine_id === id);
  const assignments = state.assignments.filter(
    (a) => a.machine_id === id && a.ended_at,
  );
  const actions = html`<button
      class="secondary"
      data-action="edit-machine"
      data-id="${id}"
    >
      Editar ficha</button
    >${m.lifecycle === "active" ? html`<button class="primary" data-action="reinstall" data-id="${id}">Reinstalar / formatear</button>` : m.lifecycle === "reinstalling" ? html`<button class="primary" data-action="finish_reinstall" data-id="${id}">Finalizar reinstalación</button>` : html`<button class="secondary" data-action="restore_machine" data-id="${id}">Reactivar máquina</button>`}${m.lifecycle !== "retired" ? html`<button class="danger" data-action="retire" data-id="${id}">Retirar máquina</button>` : ""}`;
  openInspector(
    m.name,
    html`${badge(m.lifecycle)}${m.lifecycle === "reinstalling" ? t('<div class="notice">Las IPs siguen asignadas a esta máquina durante el formateo. Al terminar puedes editar el SO, hostname y demás datos sin perder su historia.</div>') : ""}
      <div class="detail-section details-grid">
        ${Object.entries(fieldLabels)
          .filter(([k]) => k !== "name")
          .map(
            ([k, label]) =>
              `<div class="detail-item"><small>${label}</small><span>${esc(m[k] || "—")}</span></div>`,
          )
          .join("")}
      </div>
      <section class="detail-section">
        <h3>IPs actuales · ${ips.length}</h3>
        ${ips.map((ip) => `<div class="assignment-line">${ipLink(ip.id)} ${badge(ip.status)}</div>`).join("") || t('<p class="help">Esta máquina no tiene IPs asignadas.</p>')}
      </section>
      <div class="actions detail-section">${actions}</div>
      <section class="detail-section">
        <h3>Asignaciones anteriores</h3>
        ${
          assignments
            .reverse()
            .map(
              (a) =>
                `<div class="assignment-line">${ipLink(a.ip_id)}<span class="subtext">${esc(date(a.started_at))} → ${esc(date(a.ended_at))} · ${esc(a.end_reason)}</span></div>`,
            )
            .join("") ||
          t('<p class="help">No hay asignaciones anteriores.</p>')
        }
      </section>
      <section class="detail-section detail-history">
        <h3>Movimientos recientes</h3>
        <div id="detail-events">Cargando…</div>
        <button
          class="row-action"
          data-action="machine-history"
          data-id="${id}"
        >
          Consultar todo el historial →
        </button>
      </section>`,
  );
  detailKey = "machine:" + id;
  await loadDetailHistory({ machine_id: id }, detailKey);
}
async function loadDetailHistory(params, key) {
  try {
    const { events } = await api("history?" + new URLSearchParams(params));
    if (detailKey === key && $("#detail-events"))
      $("#detail-events").innerHTML = events.length
        ? timeline(events.slice(0, 8))
        : t('<p class="help">Sin movimientos.</p>');
  } catch (error) {
    if (detailKey === key && $("#detail-events"))
      $("#detail-events").textContent = error.message;
  }
}
function assignForm(id) {
  ipMachineForm(ipById(id).address);
}
function reasonForm(
  title,
  explanation,
  action,
  payload,
  label = t("Confirmar"),
  danger = false,
) {
  const requiresDetails = ["review", "resolve_review"].includes(action);
  const returnIp = detailKey?.startsWith("ip:")
    ? Number(detailKey.slice(3))
    : null;
  openInspector(
    title,
    form(
      `<div class="notice ${danger ? "warning" : ""}">${explanation}</div>${field("reason", requiresDetails ? t("Motivo o detalle") : t("Nota (opcional)"), "", { required: requiresDetails, area: true })}`,
      label,
      danger,
    ),
  );
  bindForm(async (data) => {
    await mutate(action, {
      ...payload,
      ...data,
      reason: data.reason?.trim() || (requiresDetails ? "" : label),
    });
    if (returnIp) await showIp(returnIp);
  });
}
async function dispatch(action, id) {
  const ip = ipById(id);
  switch (action) {
    case "list-network":
      networkQuery = $("#network-range").value.trim();
      await listNetwork();
      break;
    case "stop-scan":
      await api("scans/cancel", {});
      await pollScan();
      break;
    case "network-prev":
      networkPage--;
      renderNetwork();
      break;
    case "network-next":
      networkPage++;
      renderNetwork();
      break;
    case "claim-selected": {
      const selected = [...networkSelected];
      openInspector(
        t("Reclamar IPs seleccionadas"),
        form(
          html`<div class="notice">
              Se incorporarán <strong>${selected.length} direcciones</strong> a
              tu espacio.<br />${selected.slice(0, 20).map(esc).join(", ")}${selected.length > 20 ? " …" : ""}
            </div>
            <p class="help">
              Quedarán disponibles administrativamente. Reclamar no reserva
              estas direcciones en el router ni comprueba si otro equipo las
              usa.
            </p>`,
          t("Confirmar reclamación"),
        ),
      );
      bindForm(async () => {
        const result = await mutate("claim", { addresses: selected.join(",") });
        networkSelected.clear();
        if (view === "network") renderNetwork();
        toast(html`${result.added} direcciones incorporadas a tu espacio.`);
      });
      break;
    }
    case "close":
      await backInspector();
      break;
    case "claim":
      claimForm();
      break;
    case "create-machine":
      machineForm();
      break;
    case "edit-machine":
      machineForm(id);
      break;
    case "ip-detail":
      await showIp(id);
      break;
    case "machine-detail":
      await showMachine(id);
      break;
    case "edit-ip-machine":
      ipMachineForm(ip.address, { edit: true });
      break;
    case "replace-ip-machine":
      ipMachineForm(ip.address, { replace: true });
      break;
    case "assign":
      assignForm(id);
      break;
    case "plan":
      openInspector(
        t("Guardar para después: ") + ip.address,
        form(
          html`<p class="help">
              Guarda esta dirección para una máquina futura. No estará
              disponible para otra asignación hasta ejecutar o cancelar el plan.
            </p>
            ${field("target", t("¿Para qué la quieres guardar?"), "", { required: true })}${field("notes", t("Notas"), "", { area: true })}`,
          t("Guardar reserva"),
        ),
      );
      bindForm(async (data) => {
        await mutate("plan", { ...data, ip_id: id }, t("IP planificada."));
        await showIp(id);
      });
      break;
    case "release":
      reasonForm(
        t("Dejar disponible: ") + ip.address,
        html`Se cerrará la asignación a
          <strong>${esc(machine(ip.assignment.machine_id)?.name)}</strong>. La
          dirección permanecerá reclamada y conservará su
          historial.${ip.review ? t(" Seguirá pendiente de revisión hasta resolver sus discrepancias.") : t(" Volverá a estar disponible.")}`,
        "release",
        { ip_id: id, assignment_id: ip.assignment.id },
        t("Dejar esta IP disponible"),
      );
      break;
    case "cancel-plan":
      reasonForm(
        t("Quitar la reserva"),
        t(
          "La IP seguirá reclamada y quedará disponible si no tiene revisiones abiertas.",
        ),
        "cancel_plan",
        { id },
        t("Quitar la reserva"),
      );
      break;
    case "review":
      reasonForm(
        t("Anotar problema: ") + ip.address,
        t(
          "La asignación o planificación existente se conservará. Documenta la posible discrepancia.",
        ),
        "review",
        { ip_id: id },
        t("Guardar incidencia"),
      );
      break;
    case "resolve-review":
      reasonForm(
        t("Resolver revisión"),
        t(
          "Documenta qué verificaste. Resolver esta revisión no modifica la asignación ni cancela planes.",
        ),
        "resolve_review",
        { id },
        t("Resolver revisión"),
      );
      break;
    case "ip-notes":
      openInspector(
        t("Notas de ") + ip.address,
        form(field("notes", t("Notas"), ip.notes, { area: true })),
      );
      bindForm(async (data) => {
        await mutate("ip_notes", { ...data, ip_id: id });
        await showIp(id);
      });
      break;
    case "reinstall":
      reasonForm(
        t("Voy a formatear este equipo"),
        html`<strong>${esc(machine(id).name)}</strong> pasará a «En
          reinstalación». Todas sus IPs seguirán asignadas. Esta acción registra
          tu mantenimiento; no formatea ni apaga el equipo.`,
        "reinstall",
        { id },
        t("Conservar IPs durante el formateo"),
      );
      break;
    case "finish_reinstall":
      reasonForm(
        t("Ya terminé de formatear"),
        t(
          "La máquina volverá a activa con las mismas IPs. Puedes actualizar su SO, hostname y notas con «Editar ficha».",
        ),
        "finish_reinstall",
        { id },
        t("Finalizar reinstalación"),
      );
      break;
    case "restore_machine":
      reasonForm(
        t("Reactivar máquina"),
        t(
          "La ficha volverá a activa. Sus asignaciones anteriores seguirán cerradas; podrás asignarle las IPs que estén disponibles.",
        ),
        "restore_machine",
        { id },
        t("Reactivar"),
      );
      break;
    case "retire": {
      const ips = state.ips.filter((i) => i.assignment?.machine_id === id);
      reasonForm(
        t("Retirar ") + machine(id).name,
        html`Se liberarán <strong>${ips.length} IPs</strong>:
          ${ips.map((i) => esc(i.address)).join(", ") || t("ninguna")}. Se
          conservarán la máquina, las reclamaciones y su historial. Las
          revisiones abiertas continuarán pendientes. Si solo vas a formatear,
          utiliza «Reinstalar / formatear» para conservar las asignaciones.`,
        "retire",
        {
          id,
          assignment_ids: ips.map((i) => i.assignment.id).sort((a, b) => a - b),
        },
        t("Retirar y liberar IPs"),
        true,
      );
      break;
    }
    case "machines":
      navigate("machines");
      break;
    case "reusable":
      navigate("ips", "reusable");
      break;
    case "more-history":
      await loadHistory(true);
      break;
    case "all-history":
      historyFilter = {};
      await loadHistory();
      break;
    case "ip-history":
    case "machine-history":
      closeInspector();
      navigate("history");
      historyFilter =
        action === "ip-history" ? { ip_id: id } : { machine_id: id };
      await loadHistory();
      break;
  }
}
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || submitting) return;
  try {
    if (
      !button.closest("#inspector") &&
      (button.dataset.openAddress ||
        [
          "ip-detail",
          "machine-detail",
          "claim-selected",
          "claim",
          "assign",
          "edit-machine",
        ].includes(button.dataset.action))
    )
      closeInspector();
    if (button.dataset.openAddress) {
      await openAddress(button.dataset.openAddress);
    } else if (button.dataset.claimAddress) {
      networkSelected = new Set([button.dataset.claimAddress]);
      await dispatch("claim-selected");
    } else if (button.dataset.network) {
      networkQuery = button.dataset.network;
      await listNetwork();
    } else if (button.dataset.nav) navigate(button.dataset.nav);
    else if (button.dataset.stat)
      navigate(
        "ips",
        { claimed: "all" }[button.dataset.stat] || button.dataset.stat,
      );
    else if (button.dataset.filter) {
      filter = button.dataset.filter;
      networkPage = 0;
      renderView();
    } else if (button.dataset.action)
      await dispatch(button.dataset.action, Number(button.dataset.id));
  } catch (error) {
    toast(error.message);
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "network-range") networkQuery = event.target.value;
  if (event.target.id !== "search") return;
  query = event.target.value;
  const start = event.target.selectionStart;
  renderView();
  $("#search").focus();
  try {
    $("#search").setSelectionRange(start, start);
  } catch {
    /* search inputs may not expose selection */
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "network-choice") {
    if (event.target.value) {
      networkQuery = event.target.value;
      listNetwork().catch(showGlobalError);
    } else $("#network-range").focus();
  } else if (event.target.dataset.networkAddress) {
    if (event.target.checked)
      networkSelected.add(event.target.dataset.networkAddress);
    else networkSelected.delete(event.target.dataset.networkAddress);
    renderNetwork();
  } else if (event.target.id === "select-network-page") {
    const claimed = new Set(state.ips.map((ip) => ip.address));
    const page = networkVisible()
      .slice(networkPage * 64, (networkPage + 1) * 64)
      .filter((a) => !claimed.has(a));
    for (const address of page) {
      if (event.target.checked) networkSelected.add(address);
      else networkSelected.delete(address);
    }
    renderNetwork();
  }
});
$("#claim").addEventListener("click", () => {
  if (!submitting) {
    closeInspector();
    claimForm();
  }
});
$("#close-inspector").addEventListener("click", () => closeInspector());
$("#inspector-back").addEventListener("click", () =>
  backInspector().catch(showGlobalError),
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#inspector").hidden && !submitting) {
    event.preventDefault();
    backInspector().catch(showGlobalError);
  }
});
$("#refresh").addEventListener("click", () =>
  refresh()
    .then(pollScan)
    .then(() => toast(t("Inventario actualizado.")))
    .catch(() => {}),
);
$(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  if (state && !submitting) navigate("network");
});
refresh()
  .then(() => {
    navigate("network");
    return pollScan();
  })
  .catch(() => {});
