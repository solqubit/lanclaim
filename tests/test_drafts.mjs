import assert from "node:assert/strict";

const entries = new Map();
globalThis.sessionStorage = {
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => entries.set(key, value),
  removeItem: (key) => entries.delete(key),
};
const drafts = await import("../lanclaim/static/js/drafts.js");
const draft = { fields: { name: "VM draft", note: "Unsaved" }, addresses: ["192.0.2.10"], revision: 7 };
assert.equal(drafts.saveDraft("device:1:creation", draft), true);
const reloaded = await import("../lanclaim/static/js/drafts.js?reload");
assert.deepEqual(reloaded.readDraft("device:1:creation"), draft, "reload restores fields and original revision");
assert.equal(reloaded.readDraft("device:1:another-creation"), null, "draft must not leak to a replacement device");
reloaded.clearDraft("device:1:creation");
assert.equal(reloaded.readDraft("device:1:creation"), null);
entries.set("lanclaim.draft.damaged", "not JSON");
assert.equal(drafts.readDraft("damaged"), null);
assert.equal(entries.get("lanclaim.draft.damaged"), "not JSON", "reading a damaged draft is not destructive");
globalThis.sessionStorage.setItem = () => { throw Error("quota"); };
assert.equal(drafts.saveDraft("offline", draft), false);
assert.deepEqual(drafts.readDraft("offline"), draft, "storage failure keeps a memory copy for navigation");
assert.equal(drafts.hasUnstoredDrafts(), true);
drafts.clearDraft("offline");
assert.equal(drafts.hasUnstoredDrafts(), false);
console.log("drafts: ok (reload, identity, malformed storage, quota fallback and discard)");
