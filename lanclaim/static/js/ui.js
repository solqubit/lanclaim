// Utilidades de interfaz. Todo el contenido del usuario se inserta como texto.
import { t, typeLabel } from "./i18n.js";
import { findDeviceByName, osSuggestions } from "./model.js";

const PROPS = new Set(["value", "checked", "selected", "disabled", "hidden", "open"]);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "style") {
      // CSSOM (permitido por la CSP); las variables --x necesitan setProperty.
      for (const [prop, v] of Object.entries(value)) prop.startsWith("--") ? node.style.setProperty(prop, v) : (node.style[prop] = v);
    }
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (PROPS.has(key)) node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else node.append(child instanceof Node ? child : String(child));
  }
}

let toastTimer;
export function toast(message, kind = "ok") {
  const box = document.getElementById("toast");
  if (!box) return;
  box.textContent = message;
  box.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.className = "toast"), kind === "error" ? 5000 : 2600);
}

// Botón de dos pasos para acciones que pierden información.
export function confirmButton({ label, sureLabel, onConfirm, className = "btn danger" }) {
  let timer;
  const button = el("button", { type: "button", class: className }, label);
  const disarm = () => {
    clearTimeout(timer);
    button.classList.remove("sure");
    button.textContent = label;
  };
  button.addEventListener("click", () => {
    if (button.classList.contains("sure")) {
      disarm();
      onConfirm();
      return;
    }
    button.classList.add("sure");
    button.textContent = sureLabel;
    timer = setTimeout(disarm, 4000);
  });
  button.addEventListener("blur", () => setTimeout(disarm, 150));
  return button;
}

// Botones con valores ya usados (SO, plataformas): un clic rellena el campo; × lo quita de la lista.
export function osPicker(state, input, onForget) {
  return choicePicker(state.os_choices, input, onForget);
}

// onForget nulo: botones sin × (p. ej. anfitriones existentes, que no se «olvidan»).
export function choicePicker(saved, input, onForget) {
  const box = el("div", { class: "os-picker" });
  let choices = [...(saved || [])];
  const paint = () => {
    const names = osSuggestions(choices, input.value);
    box.replaceChildren(
      ...names.map((name) =>
        el(
          "span",
          { class: "os-chip" },
          el(
            "button",
            {
              type: "button",
              class: "os-pick",
              title: t("Usar {name}", { name }),
              onclick: () => {
                input.value = name;
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.focus();
              },
            },
            name,
          ),
          onForget &&
          el(
            "button",
            {
              type: "button",
              class: "x",
              title: t("Quitar de la lista"),
              "aria-label": t("Quitar {name} de la lista", { name }),
              onclick: () => {
                choices = choices.filter((c) => c !== name);
                paint();
                onForget?.(name);
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

let inputSeq = 0;
// Campo de equipo: elige uno existente o escribe un nombre nuevo (con su tipo y SO).
export function deviceInput(state, { placeholder, value = "", onForgetOs } = {}) {
  const id = `dev-${++inputSeq}`;
  const list = el("datalist", { id: `${id}-list` }, state.devices.map((d) => el("option", { value: d.name })));
  const input = el("input", {
    class: "in",
    id,
    list: `${id}-list`,
    placeholder: placeholder || t("Nombre del equipo (existente o nuevo)"),
    autocomplete: "off",
    maxlength: 120,
    value,
  });
  const type = el(
    "select",
    { class: "in", "aria-label": t("Tipo") },
    ["vm", "fisica", "contenedor", "otro"].map((k) => el("option", { value: k }, typeLabel(k))),
  );
  const os = el("input", { class: "in", maxlength: 120, autocomplete: "off", placeholder: t("Sistema operativo (opcional)"), "aria-label": t("Sistema operativo") });
  const extra = el("div", { class: "new-device", hidden: true }, type, os, osPicker(state, os, onForgetOs));
  const hint = el("div", { class: "hint" });
  const sync = () => {
    const name = input.value.trim();
    const existing = findDeviceByName(state, name);
    extra.hidden = !name || !!existing;
    hint.textContent = !name
      ? ""
      : existing
        ? t("Se asignará a {name}", { name: existing.name })
        : t("Se creará el equipo “{name}”", { name });
  };
  input.addEventListener("input", sync);
  sync();
  return {
    node: el("div", { class: "device-input" }, input, list, hint, extra),
    input,
    read() {
      const name = input.value.trim();
      if (!name) return null;
      const existing = findDeviceByName(state, name);
      return existing ? { id: existing.id } : { name, type: type.value, os: os.value.trim() };
    },
    focus() {
      input.focus();
    },
  };
}
