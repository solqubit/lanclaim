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
const fieldLabels = {
  name: t("Nombre"),
  os: t("Sistema operativo (SO)"),
  platform: t("Plataforma de virtualización"),
  notes: t("Notas"),
};
let state,
  view = "network",
  filter = "all",
  query = "",
  toastTimer,
  submitting = false,
  detailKey = null;
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
    renderView();
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
  view = next;
  filter = nextFilter;
  query = "";
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
  };
  const [title, subtitle] = titles[view];
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;
  $("#claim").hidden = view === "machines";
  $("#stats").hidden = view !== "ips";
  document.title = title + " · LanClaim";
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === view);
    el.setAttribute("aria-current", el.dataset.nav === view ? "page" : "false");
  });
  renderView();
  if (view === "network" && !networks.length) return discoverNetworks();
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
          ${m ? esc(m.os || m.platform || t("Sin sistema registrado")) + (m.lifecycle === "reinstalling" ? `<span class="subtext">${badge("reinstalling")}</span>` : "") : ip.plan ? t("Destino previsto") : "—"}
        </td>
        <td>${esc(m?.platform || "—")}</td>
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
      t("Buscar IP o equipo…"),
    )}${
      ips.length
        ? html`<div class="table-wrap">
              <table class="ip-table">
                <thead>
                  <tr>
                    <th>Equipo / IP</th>
                    <th>Estado</th>
                    <th>Detalles</th>
                    <th>Plataforma</th>
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
              ><span>Tu espacio de direcciones IP</span>
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
          ${state.counts.retired} retiradas · Sus direcciones siguen
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
      t("Buscar equipo, SO o plataforma…"),
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
                          >${esc(m.platform)}</small
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
        existentes conservarán su estado.
      </div>`;
      $("[type=submit]", $("#action-form")).textContent = t(
        "Confirmar reclamación",
      );
    }
  });
}
function choiceField(key, label, value = "") {
  const choices = state.machine_choices?.[key] || [
    ...new Set(state.machines.map((m) => m[key]).filter(Boolean)),
  ];
  return `<div class="choice-field"><label>${esc(label)}<input aria-label="${esc(label)}" name="${key}" value="${esc(value)}" maxlength="200" autocomplete="off"></label><div class="choice-footer"><span class="field-hint">${t("Escribe un valor nuevo.")}</span>${choices.length ? `<details class="choice-picker"><summary>${t("Elegir guardado")}</summary><div class="choice-options">${choices.map((value) => `<button type="button" data-choice-field="${key}" data-choice-value="${esc(value)}">${esc(value)}</button>`).join("")}</div></details>` : `<span class="field-hint">${t("Se guardará en la lista.")}</span>`}</div></div>`;
}
function deviceFields(values = {}) {
  return `<div class="form-grid">${field("name", t("Nombre del equipo"), values.name || "", { required: true })}${choiceField("os", fieldLabels.os, values.os || "")}${choiceField("platform", fieldLabels.platform, values.platform || "")}${field("notes", t("Notas del equipo"), values.notes || "", { area: true, wide: true })}</div>`;
}
function machineForm(id) {
  const m = id ? machine(id) : {};
  openInspector(
    id ? t("Editar datos del equipo") : t("Nuevo equipo"),
    form(deviceFields(m)),
  );
  bindForm((data) =>
    mutate(id ? "edit_machine" : "create_machine", {
      ...data,
      ...(id ? { id } : {}),
    }),
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
  inspectorAnchor = { address };
  openInspector(
    current?.name ? `${current.name} · ${address}` : address,
    form(
      html`
        <div class="ip-form-intro">
          <h3>
            ${edit ? t("Datos del equipo") : replace ? t("Cambiar equipo asignado") : t("¿Qué equipo usa esta IP?")}
          </h3>
          <p>
            ${edit ? t("Nombre, SO, plataforma y notas. La asignación de IP no cambia.") : replace ? html`Equipo actual: <strong>${esc(current?.name)}</strong>. El cambio afecta solo a esta IP; las demás asignaciones se conservan.` : ip ? t("Escribe un nombre y guarda. El equipo se registrará aquí mismo.") : t("Al guardar, la IP quedará reclamada y vinculada al equipo. No se cambia la configuración de red del equipo.")}
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
          ${deviceFields({ ...values, name: values?.name || (!replace && ip?.plan?.target) || "" })}
        </div>
        ${
          !edit && existing.length
            ? html`<label id="ip-existing-machine" hidden
                >Equipo registrado<select name="machine_id" disabled required>
                  <option value="">Selecciona un equipo</option>
                  ${existing.map((m) => `<option value="${m.id}">${esc(m.name)}${m.platform ? " · " + esc(m.platform) : ""}</option>`).join("")}
                </select></label
              >`
            : ""
        }
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
      .querySelectorAll("input,textarea,select")
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
        t("Nombre, SO, plataforma de virtualización y notas."),
      ),
    );
    mainActions.push(
      ipAction(
        m.lifecycle === "reinstalling" ? "finish_reinstall" : "reinstall",
        m.id,
        m.lifecycle === "reinstalling"
          ? t("Terminar reinstalación")
          : t("Iniciar reinstalación"),
        m.lifecycle === "reinstalling"
          ? t("Vuelve a activo y mantiene todas sus IPs.")
          : t("Marca el equipo en mantenimiento. Sus IPs siguen asignadas."),
      ),
    );
    if (!ip.review)
      mainActions.push(
        ipAction(
          "replace-ip-machine",
          id,
          t("Cambiar equipo asignado"),
          t("Asigna esta IP a otro equipo existente o crea uno nuevo."),
        ),
      );
    mainActions.push(
      ipAction(
        "release",
        id,
        t("Liberar asignación"),
        t("Deja esta IP sin equipo, lista para reutilizar. Sigue reclamada."),
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
          ${esc(m ? [m.os, m.platform].filter(Boolean).join(" · ") || t("Puedes completar sus datos cuando quieras.") : p?.notes || t("Puedes usarla ahora o guardarla para después."))}
        </p>
        ${observations.has(ip.address) ? `<div class="ip-connectivity">${observationCell(ip.address)}</div>` : ""}
        <form id="ip-notes-form" class="ip-notes-card">
          <label for="ip-notes-text">Notas de la IP</label>
          <textarea
            id="ip-notes-text"
            name="notes"
            maxlength="4000"
            placeholder="Añade aquí tus notas sobre esta IP…"
          >
${esc(ip.notes)}</textarea>
          <div class="form-error" role="alert" hidden></div>
          <div class="notes-actions">
            <button type="reset" class="quiet">Descartar</button
            ><button type="submit" class="secondary">Guardar notas</button>
          </div>
        </form>
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
        <summary>Otras opciones</summary>
        <div class="ip-actions">
          ${ipAction("review", id, t("Hay un problema con esta IP"), t("Anota un posible conflicto para revisarlo sin perder la asignación."))}
          ${m ? ipAction("retire", m.id, t("Ya no uso este equipo"), html`Retira el equipo y libera sus ${currentIps.length} IPs. Las direcciones siguen reclamadas.`, "destructive") : ""}
        </div>
      </details>
      <p class="ip-footnote">
        Esta IP permanece en tu inventario aunque el equipo esté apagado.
      </p>
    `,
    { root: true },
  );
  detailKey = "ip:" + id;
  const notesForm = $("#ip-notes-form");
  notesForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    const button = $("[type=submit]", notesForm),
      errorBox = $(".form-error", notesForm),
      input = $("textarea", notesForm);
    button.disabled = true;
    errorBox.hidden = true;
    try {
      await api("commands/ip_notes", { ip_id: id, notes: input.value });
      ipById(id).notes = input.value.trim();
      input.defaultValue = ipById(id).notes;
      input.value = ipById(id).notes;
      toast(t("Notas guardadas."));
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      submitting = false;
      button.disabled = false;
    }
  });
}
async function showMachine(id) {
  inspectorAnchor = { machine: String(id) };
  const m = machine(id);
  if (!m) return;
  const ips = state.ips.filter((ip) => ip.assignment?.machine_id === id);
  const actions = html`<button
      class="secondary"
      data-action="edit-machine"
      data-id="${id}"
    >
      Editar ficha</button
    >${m.lifecycle === "active" ? html`<button class="primary" data-action="reinstall" data-id="${id}">Reinstalar / formatear</button>` : m.lifecycle === "reinstalling" ? html`<button class="primary" data-action="finish_reinstall" data-id="${id}">Finalizar reinstalación</button>` : html`<button class="secondary" data-action="restore_machine" data-id="${id}">Reactivar máquina</button>`}${m.lifecycle !== "retired" ? html`<button class="danger" data-action="retire" data-id="${id}">Retirar máquina</button>` : ""}`;
  openInspector(
    m.name,
    html`${badge(m.lifecycle)}${m.lifecycle === "reinstalling" ? t('<div class="notice">Las IPs siguen asignadas durante la reinstalación. Puedes actualizar los datos del equipo al terminar.</div>') : ""}
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
      <div class="actions detail-section">${actions}</div> `,
  );
  detailKey = "machine:" + id;
}
function assignForm(id) {
  ipMachineForm(ipById(id).address);
}
function stateTransition(action, payload) {
  const transitions = {
    reinstall: ["active", "reinstalling"],
    finish_reinstall: ["reinstalling", "active"],
    release: [
      "assigned",
      ipById(payload.ip_id)?.review ? "review" : "available",
    ],
    retire: [machine(payload.id)?.lifecycle || "active", "retired"],
    restore_machine: ["retired", "active"],
  };
  const states = transitions[action];
  return states
    ? `<div class="state-transition">${badge(states[0])}<span aria-hidden="true">→</span>${badge(states[1])}</div>`
    : "";
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
      `${stateTransition(action, payload)}<div class="notice ${danger ? "warning" : ""}">${explanation}</div>${field("reason", requiresDetails ? t("Motivo o detalle") : t("Nota (opcional)"), "", { required: requiresDetails, area: true })}`,
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
          dirección permanecerá reclamada, sin equipo
          asignado.${ip.review ? t(" Seguirá pendiente de revisión hasta resolver sus discrepancias.") : t(" Volverá a estar disponible.")}`,
        "release",
        { ip_id: id, assignment_id: ip.assignment.id },
        t("Liberar asignación"),
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
    case "reinstall":
      reasonForm(
        t("Iniciar reinstalación"),
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
        t("Terminar reinstalación"),
        t(
          "El equipo volverá a activo con las mismas IPs. Después puedes actualizar su SO, plataforma y notas.",
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
          conservarán la máquina y las reclamaciones. Las revisiones abiertas
          continuarán pendientes. Si solo vas a formatear, utiliza «Reinstalar /
          formatear» para conservar las asignaciones.`,
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
    if (button.dataset.choiceField) {
      const input = $(
        `[name="${button.dataset.choiceField}"]`,
        $("#action-form"),
      );
      input.value = button.dataset.choiceValue;
      button.closest("details").open = false;
      input.focus();
    } else if (button.dataset.openAddress) {
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
const locationStorageKey = "lanclaim.location.v1";
let locationReady = false;

function readLocation() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(locationStorageKey));
    const filters = {
      network: ["all", "responding", "mine", "outside"],
      ips: ["all", "available", "assigned", "planned", "review", "reusable"],
      machines: ["all", "active", "reinstalling", "retired"],
    };
    if (!saved || !Object.hasOwn(filters, saved.view)) return null;
    const boundedText = (value, limit) =>
      typeof value === "string" ? value.slice(0, limit) : "";
    const boundedNumber = (value, limit) =>
      Number.isFinite(value)
        ? Math.max(0, Math.min(limit, Math.floor(value)))
        : 0;
    return {
      view: saved.view,
      filter: filters[saved.view].includes(saved.filter) ? saved.filter : "all",
      query: boundedText(saved.query, 1000),
      networkQuery: boundedText(saved.networkQuery, 100000),
      networkPage: boundedNumber(saved.networkPage, 63),
      address: boundedText(saved.address, 45),
      machine: boundedNumber(saved.machine, Number.MAX_SAFE_INTEGER),
      scroll: boundedNumber(saved.scroll, 10000000),
    };
  } catch {
    // Invalid or disabled browser storage must not prevent opening the inventory.
    return null;
  }
}

function saveLocation() {
  if (!locationReady) return;
  try {
    // Per-tab navigation only: do not store forms or replay pending commands.
    sessionStorage.setItem(
      locationStorageKey,
      JSON.stringify({
        view,
        filter,
        query,
        networkQuery,
        networkPage,
        address: inspectorAnchor?.address,
        machine: Number(inspectorAnchor?.machine) || 0,
        scroll: window.scrollY,
      }),
    );
  } catch {
    /* Browser storage is optional. */
  }
}

async function startWorkspace() {
  const saved = readLocation();
  if (saved) networkQuery = saved.networkQuery;
  await refresh();
  // Await range enumeration before restoring pagination: listing resets its page.
  await navigate(saved?.view || "network", saved?.filter || "all");
  if (saved) query = saved.query;
  await pollScan();
  if (saved) {
    // Connectivity filters need observations before their page can be clamped.
    networkPage = saved.networkPage;
    renderView();
  }
  if (saved?.address) {
    const ip = state.ips.find((item) => item.address === saved.address);
    if (ip) await showIp(ip.id);
    else if (view === "network" && networkAddresses.includes(saved.address))
      await openAddress(saved.address);
  } else if (saved?.machine && machine(saved.machine)) {
    await showMachine(saved.machine);
  }
  if (saved) {
    // Let the restored table and expanded row lay out before positioning the page.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    window.scrollTo({ top: saved.scroll, behavior: "instant" });
  }
  locationReady = true;
}

if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.addEventListener("pagehide", saveLocation);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveLocation();
});
startWorkspace().catch(() => {});
