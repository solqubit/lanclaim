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

assert.equal(vm.runInContext("t('Escanear red')", en), "Scan network");
assert.equal(vm.runInContext("t('Red del servidor')", en), "Server network");
assert.equal(vm.runInContext("t('Sin respuesta')", en), "No response");
assert.equal(vm.runInContext("t('Direcciones IP')", en), "IP addresses");
assert.equal(vm.runInContext("t('Ya hay un escaneo en curso.')", en), "A scan is already running.");

assert.equal(vm.runInContext("t('Guardar IP y equipo')", en), "Save IP and device");
assert.equal(vm.runInContext("t('Reclamar IP')", en), "Claim IP");
assert.equal(vm.runInContext("t('Eliminar definitivamente')", en), "Delete permanently");
assert.equal(vm.runInContext("t('Escribe el nombre del equipo para confirmar')", en), "Type the device name to confirm");
assert.equal(vm.runInContext("t('Reclamar sin equipo')", en), "Claim without a device");
assert.equal(vm.runInContext("t('Reclamar y añadir equipo')", en), "Claim and add device");
assert.equal(
  vm.runInContext("t('El servicio no tiene permisos para usar ping. Actualiza LanClaim para reparar los permisos del servicio.')", en),
  "The service does not have permission to use ping. Update LanClaim to repair service permissions.",
);
assert.equal(
  vm.runInContext("t('Ping no terminó a tiempo. Revisa la carga y la red del servidor.')", en),
  "Ping did not finish in time. Check server load and networking.",
);
assert.equal(
  vm.runInContext("t('El servidor no tiene una ruta hacia esa red. Revisa su interfaz, gateway o red virtual.')", en),
  "The server has no route to that network. Check its interface, gateway or virtual network.",
);
assert.equal(vm.runInContext("t('Voy a formatear este equipo')", en), "I am reinstalling this device");
assert.equal(vm.runInContext("t('El equipo de esta IP cambió. Actualiza antes de guardar.')", en), "The device using this IP changed. Refresh before saving.");
