import assert from "node:assert/strict";
import { load, post } from "../lanclaim/static/js/api.js";

const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
globalThis.fetch = async (path, options) => {
  assert.ok(options.signal instanceof AbortSignal);
  return response(200, { csrf: "token" });
};
assert.deepEqual(await load(), { csrf: "token" });
globalThis.fetch = async () => response(409, { error: "Conflict" });
await assert.rejects(post("devices/update", { revision: 1 }), (error) => error.status === 409);

// A malformed response must not replace the application state with an empty object.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw Error("bad JSON"); } });
await assert.rejects(load(), /No se pudo conectar/);

// CSRF renewal retries the original revision; it must never silently accept a newer revision.
const calls = [];
globalThis.fetch = async (path, options) => {
  calls.push({ path, body: options.body });
  if (calls.length === 1) return response(403, {});
  if (path === "/api/state") return response(200, { csrf: "new-token", devices: [{ id: 1, revision: 2 }] });
  assert.equal(JSON.parse(options.body).revision, 1);
  assert.equal(options.headers["X-CSRF-Token"], "new-token");
  return response(409, { error: "Conflict" });
};
await assert.rejects(post("devices/update", { id: 1, revision: 1 }), (error) => error.status === 409);
assert.equal(calls.length, 3);

const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback) => realTimeout(callback, 0);
globalThis.fetch = (path, { signal }) => new Promise((resolve, reject) => {
  signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
});
await assert.rejects(load(), /No se pudo conectar/);
globalThis.setTimeout = realTimeout;
console.log("api: ok (conflicts, invalid JSON, original revision after CSRF renewal and timeout)");
