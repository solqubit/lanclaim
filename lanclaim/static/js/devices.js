// Vista Equipos (se completa en la tarea 6).
import { el } from "./ui.js";

export function renderDevices(root) {
  root.replaceChildren(el("section", { class: "devices" }));
}
