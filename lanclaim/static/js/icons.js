// Iconos de sistema operativo y de tipo de equipo, dibujados aquí (sin logotipos oficiales ni descargas).
// Cada SO va en una baldosa teñida con su color (--c), como un pequeño sello.
import { osFamily } from "./model.js";

const NS = "http://www.w3.org/2000/svg";
const GAP = "#0f1620"; // color del fondo para separar piezas (huecos)

function svg(children, cls = "") {
  const root = document.createElementNS(NS, "svg");
  root.setAttribute("viewBox", "0 0 24 24");
  root.setAttribute("aria-hidden", "true");
  if (cls) root.setAttribute("class", cls);
  for (const [tag, attrs] of children) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    root.append(node);
  }
  return root;
}

const circle = (cx, cy, r, fill, extra = {}) => ["circle", { cx, cy, r, fill, ...extra }];
const path = (d, fill, extra = {}) => ["path", { d, fill, ...extra }];
const rect = (x, y, w, h, fill, extra = {}) => ["rect", { x, y, width: w, height: h, fill, ...extra }];

// [color de la baldosa, piezas del dibujo]
const OS = {
  windows: ["#3ba4f5", [rect(3.5, 3.5, 7.8, 7.8, "#3ba4f5", { rx: 1 }), rect(12.7, 3.5, 7.8, 7.8, "#3ba4f5", { rx: 1 }),
    rect(3.5, 12.7, 7.8, 7.8, "#3ba4f5", { rx: 1 }), rect(12.7, 12.7, 7.8, 7.8, "#3ba4f5", { rx: 1 })]],
  ubuntu: ["#e95420", [circle(12, 12, 5.7, "none", { stroke: "#e95420", "stroke-width": 2.4 }),
    circle(19.5, 12, 2.9, "#e95420", { stroke: GAP, "stroke-width": 1.7 }),
    circle(8.25, 18.5, 2.9, "#e95420", { stroke: GAP, "stroke-width": 1.7 }),
    circle(8.25, 5.5, 2.9, "#e95420", { stroke: GAP, "stroke-width": 1.7 })]],
  debian: ["#e0336e", [path("M15 5.4a7.2 7.2 0 1 0 3 9.9M14.3 8.6a4 4 0 1 0 1.2 5.5a1.9 1.9 0 1 0-2.9-2.3", "none",
    { stroke: "#e0336e", "stroke-width": 2.2, "stroke-linecap": "round" })]],
  rocky: ["#10b981", [circle(12, 12, 8.8, "#10b981"),
    path("M4.6 16.2 9.6 10.6l3.4 4 2.3-2.6 4.1 4.6", "none", { stroke: GAP, "stroke-width": 2.1, "stroke-linejoin": "round" })]],
  centos: ["#9ccd2a", []], // se dibuja en centos(): cuatro piezas giradas
  redhat: ["#ee0000", [path("M7.4 13.3c.6-3.4 1.7-6.2 4.8-6.2 2.4 0 3.4 1.6 4.1 3.3l1.4 3.6c-3.5 1.3-7.6 1-10.3-.7z", "#ee0000"),
    path("M3.4 13.7c0 2 4.1 4 9.2 4 5 0 8.1-1.6 8.1-3 0-.6-.5-1-1.3-1.3-.3 1.4-3.4 2.3-7.1 2.3-3.8 0-6.8-.9-7.8-2.4-.8.2-1.1.3-1.1.4z", "#ee0000")]],
  fedora: ["#51a2da", [circle(12, 12, 8.8, "#51a2da"),
    path("M14.2 6.8c-1.8 0-3.2 1.3-3.2 3.1V12H8.8v2.1H11v3.6h2.2v-3.6h2.3V12h-2.3V9.9c0-.5.4-.9.9-.9h1.4V6.8z", "#fff")]],
  alma: ["#ffc000", [circle(12, 6.6, 3, "#ff4649"), circle(17.1, 10.3, 3, "#ffc000"), circle(15.2, 16.4, 3, "#86da2f"),
    circle(8.8, 16.4, 3, "#24c2ff"), circle(6.9, 10.3, 3, "#0069da")]],
  alpine: ["#2f9fd0", [circle(12, 12, 8.8, "#1b6c96"),
    path("M4.8 15.6 9.6 9.4l2.6 3.3 2-2.3 5 5.2z", "#fff"), path("M9.6 9.4l1.2 3.9 1.4-.6z", "#1b6c96")]],
  arch: ["#1793d1", [path("M12 3.4c-.9 2.2-1.5 3.7-2.5 5.7.6.6 1.4 1.3 2.6 1.9-1.3-.5-2.2-1.1-2.8-1.6C8.1 12.4 6.2 15.9 3.9 20.6c1.8-1 3.5-1.8 5-2.2a3.2 3.2 0 0 1-.1-1c0-1.7 1.4-3.1 3.2-3.1s3.2 1.4 3.2 3.1c0 .3 0 .7-.1 1 1.5.4 3.2 1.2 5 2.2-.5-.9-.9-1.8-1.4-2.6-.8-.7-1.7-1.5-3.4-2.4 1.1.3 2 .6 2.7 1C15.9 11.5 14.2 7.9 12 3.4z", "#1793d1")]],
  opensuse: ["#73ba25", [path("M3.6 13.2c0-4 3.6-6.6 8.6-6.6 3.6 0 6.2 1.3 7.6 3.3l.8-.6.6.8-.9.7c.3.8.4 1.6.4 2.4 0 3.6-3.6 5.5-8.4 5.5-4.9 0-8.7-1.7-8.7-5.5z", "#73ba25"),
    circle(15.6, 11.2, 2.3, "#fff"), circle(16.1, 11.1, 1.1, GAP)]],
  freebsd: ["#d3373a", [circle(12, 13.4, 7.4, "#d3373a"), path("M4.4 4 8.9 7.4 6 9.6z", "#d3373a"), path("M19.6 4 15.1 7.4 18 9.6z", "#d3373a"),
    path("M8.4 12.2a4 4 0 0 1 3.6-2.6", "none", { stroke: "#ff9a9c", "stroke-width": 1.4, "stroke-linecap": "round" })]],
  truenas: ["#0095d5", [rect(3.5, 4.2, 17, 4.2, "#0095d5", { rx: 1.4 }), rect(3.5, 9.9, 17, 4.2, "#0095d5", { rx: 1.4 }),
    rect(3.5, 15.6, 17, 4.2, "#0095d5", { rx: 1.4 }), circle(17.3, 6.3, 0.9, "#bfefff"), circle(17.3, 12, 0.9, "#bfefff"), circle(17.3, 17.7, 0.9, "#bfefff")]],
  proxmox: ["#e57000", [path("M5 5l14 14M19 5 5 19", "none", { stroke: "#e57000", "stroke-width": 3.4, "stroke-linecap": "round" })]],
  macos: ["#b7bec7", [rect(4.5, 5.5, 15, 10, "none", { rx: 1.8, stroke: "#c9cfd6", "stroke-width": 1.8 }),
    path("M2.8 18.2h18.4c-.3 1-1 1.5-2 1.5H4.8c-1 0-1.7-.5-2-1.5z", "#c9cfd6")]],
  linux: ["#f4c430", [path("M12 3.6c-2.4 0-3.6 2-3.6 4.4 0 1.6-.9 2.6-1.8 4-1 1.6-1.6 3.4-1.1 5.3.6 2.1 3.2 3 6.5 3s5.9-.9 6.5-3c.5-1.9-.1-3.7-1.1-5.3-.9-1.4-1.8-2.4-1.8-4 0-2.4-1.2-4.4-3.6-4.4z", "#15181d"),
    path("M12 10.6c-1.8 0-3.2 2-3.2 4.6 0 2.1 1.4 3.6 3.2 3.6s3.2-1.5 3.2-3.6c0-2.6-1.4-4.6-3.2-4.6z", "#f1f3f5"),
    path("M10.6 8.6 12 9.8l1.4-1.2-1.4-.6z", "#f4c430"), circle(10.8, 6.9, 0.7, "#f1f3f5"), circle(13.2, 6.9, 0.7, "#f1f3f5"),
    path("M6.6 19.4c1-.4 2.6-.3 3.4.4-.8.6-2.4.8-3.4.4zM17.4 19.4c-1-.4-2.6-.3-3.4.4.8.6 2.4.8 3.4.4z", "#f4c430")]],
};

function centos() {
  const root = svg([]);
  const g = document.createElementNS(NS, "g");
  g.setAttribute("transform", "rotate(45 12 12)");
  [["#9ccd2a", 4.9, 4.9], ["#efa724", 12.4, 4.9], ["#262577", 12.4, 12.4], ["#932279", 4.9, 12.4]].forEach(([fill, x, y]) => {
    const r = document.createElementNS(NS, "rect");
    Object.entries({ x, y, width: 6.7, height: 6.7, rx: 1, fill }).forEach(([k, v]) => r.setAttribute(k, v));
    g.append(r);
  });
  root.append(g);
  return root;
}

// Icono de SO en su baldosa, o null si el texto no corresponde a un sistema conocido.
export function osIcon(os, size = "md") {
  const family = osFamily(os);
  if (!family) return null;
  const [color, parts] = OS[family];
  const tile = document.createElement("span");
  tile.className = `os-ico ${size} os-${family}`;
  tile.style.setProperty("--c", color);
  tile.title = os;
  tile.append(family === "centos" ? centos() : svg(parts));
  return tile;
}

const TYPE_PATHS = {
  // VM: ventanas apiladas · Física: servidor de rack · Contenedor: cubo · Otro: nodo
  vm: "M4 7h11v9H4zM8 4h12v9h-2",
  fisica: "M4 5h16v5H4zM4 14h16v5H4zM7 7.5h.01M7 16.5h.01",
  contenedor: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  otro: "M12 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8M12 3v5M12 16v5M3 12h5M16 12h5",
};

export function typeIcon(type) {
  return svg([path(TYPE_PATHS[type] || TYPE_PATHS.otro, "none")], `type-ico ${type}`);
}

// El icono principal de un equipo: su SO si se reconoce; si no, su tipo.
export function deviceIcon(d) {
  return osIcon(d.os) || typeIcon(d.type);
}
