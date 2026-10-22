// Selector de sistema operativo: se elige de la biblioteca (icono + nombre sin versión) y se escribe la versión.
// Se guarda como un solo texto («Ubuntu 24.04»), así que los equipos existentes se reconocen solos.
import { t } from "./i18n.js";
import { osIcon, typeIcon } from "./icons.js";
import { composeOs, OS_LIBRARY, splitOs } from "./model.js";
import { el } from "./ui.js";

const VERSION_HINT = { windows: "p. ej. 11 o Server 2022", ubuntu: "p. ej. 24.04", debian: "p. ej. 13", macos: "p. ej. Sequoia" };

function libraryIcon(entry, size) {
  if (entry.key === "otro") {
    const tile = el("span", { class: `os-ico ${size} os-otro` });
    tile.append(typeIcon("otro"));
    return tile;
  }
  return osIcon(entry.key === "linux" ? "Linux" : entry.name, size);
}

export function osSelect(initial, { onDirty = () => {}, compact = false } = {}) {
  let { key, name, version } = splitOs(initial);
  const entryOf = () => OS_LIBRARY.find((o) => o.key === key) || null;

  const current = el("button", { type: "button", class: "os-current", "aria-haspopup": "true", "aria-expanded": "false" });
  const nameInput = el("input", { class: "in", maxlength: 80, autocomplete: "off", value: name, "aria-label": t("Nombre del sistema") });
  const versionInput = el("input", { class: "in", maxlength: 40, autocomplete: "off", value: version, "aria-label": t("Versión") });
  const details = el("div", { class: "os-details" }, nameInput, versionInput);
  const grid = el("div", { class: "os-grid", role: "listbox", hidden: true, "aria-label": t("Sistemas operativos") });

  const paintCurrent = () => {
    const entry = entryOf();
    current.replaceChildren(
      entry ? libraryIcon(entry, "sm") : el("span", { class: "os-ico sm blank" }),
      el("span", { class: "os-current-name" + (entry ? "" : " muted") }, entry ? t(entry.name) : t("Elegir sistema…")),
      el("span", { class: "caret", "aria-hidden": "true" }, "▾"),
    );
    details.hidden = !entry;
    nameInput.hidden = !(entry && entry.askName);
    nameInput.placeholder = key === "linux" ? t("Distribución, p. ej. Linux Mint") : t("Nombre, p. ej. pfSense");
    versionInput.placeholder = t(VERSION_HINT[key] || "Versión (opcional)");
  };

  const toggle = (open = grid.hidden) => {
    grid.hidden = !open;
    current.setAttribute("aria-expanded", String(open));
    if (open) grid.querySelector(".on, button")?.focus();
  };

  const choose = (nextKey) => {
    if (nextKey !== key) {
      key = nextKey;
      name = "";
      nameInput.value = "";
      onDirty();
    }
    paintCurrent();
    paintGrid();
    toggle(false);
    const entry = entryOf();
    (entry && entry.askName ? nameInput : versionInput).focus();
  };

  const paintGrid = () => {
    grid.replaceChildren(
      ...OS_LIBRARY.map((entry) =>
        el(
          "button",
          { type: "button", class: "os-option" + (entry.key === key ? " on" : ""), role: "option", "aria-selected": String(entry.key === key), onclick: () => choose(entry.key) },
          libraryIcon(entry, "md"),
          el("span", {}, t(entry.name)),
        ),
      ),
      key ? el("button", { type: "button", class: "os-option clear", onclick: () => ((versionInput.value = ""), choose("")) }, t("Sin sistema")) : null,
    );
  };

  current.addEventListener("click", () => toggle());
  grid.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      toggle(false);
      current.focus();
    }
  });
  nameInput.addEventListener("input", onDirty);
  versionInput.addEventListener("input", onDirty);
  paintCurrent();
  paintGrid();

  return {
    node: el("div", { class: "os-select" + (compact ? " compact" : "") }, el("div", { class: "os-row" }, current, details), grid),
    read: () => composeOs(key, nameInput.value, versionInput.value),
  };
}
