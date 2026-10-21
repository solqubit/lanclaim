import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EN, setLang, t } from "../lanclaim/static/js/i18n.js";

const dir = "lanclaim/static/js";
const keys = new Set();
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const source = fs.readFileSync(path.join(dir, file), "utf8");
  assert.doesNotMatch(source, /\bt\(`/, `${file}: t() must use a literal string, not a template`);
  for (const match of source.matchAll(/\bt\((["'])((?:\\.|(?!\1).)+)\1/g)) {
    keys.add(match[2].replace(/\\(["'])/g, "$1"));
  }
}
assert.ok(keys.size > 100, `expected many translated strings, found ${keys.size}`);
const missing = [...keys].filter((k) => !(typeof EN[k] === "string" && EN[k].trim()));
assert.deepEqual(missing, [], "missing English translations");

setLang("en");
assert.equal(t("hace {n} min", { n: 5 }), "5 min ago");
assert.equal(t("Libre"), "Free");
setLang("es");
assert.equal(t("hace {n} min", { n: 5 }), "hace 5 min");
assert.equal(t("texto sin traducir"), "texto sin traducir");

console.log(`i18n: ok (${keys.size} strings)`);
