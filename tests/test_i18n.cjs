const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("lanclaim/static/i18n.js", "utf8");
function context(language) {
  const ctx = vm.createContext({
    localStorage: { getItem: () => language },
    document: { addEventListener() {} },
  });
  vm.runInContext(source, ctx);
  return ctx;
}
const es = context("es"),
  en = context("en");
assert.equal(
  vm.runInContext("t('Mi espacio de IPs')", es),
  "Mi espacio de IPs",
);
assert.equal(vm.runInContext("t('Mi espacio de IPs')", en), "My IP space");
assert.equal(
  vm.runInContext("t('Reinstalar / formatear')", en),
  "Reinstall / format",
);
assert.equal(
  vm.runInContext(
    "t('La asignación ha cambiado. Actualiza antes de liberar.')",
    en,
  ),
  "The assignment changed. Refresh before releasing it.",
);
// User content is an interpolation: it must not be translated as interface text.
en.userName = "Máquina registrada — Notas de mi red";
assert.equal(
  vm.runInContext("html`<p>Asignada a ${userName}</p>`", en),
  "<p>Assigned to Máquina registrada — Notas de mi red</p>",
);
assert.equal(vm.runInContext("html`Página ${2} de ${4}`", en), "Page 2 of 4");
assert.equal(vm.runInContext("t('Disponibles')", en), "Available");
assert.equal(vm.runInContext("t('Planificadas')", en), "Planned");
en.multiline =
  "La disponibilidad es administrativa. Una máquina apagada\n        conserva su IP.";
assert.equal(
  vm.runInContext("t(multiline)", en),
  "Availability is administrative. An offline machine keeps its IP.",
);
console.log(
  "PASS: ES/EN labels, validation errors, template interpolation and unmodified user content.",
);
