import assert from "node:assert/strict";
import { createAutosave } from "../lanclaim/static/js/autosave.js";

// A rejected write must remain dirty and retry on blur without another edit.
{
  let value = "draft", dirty, calls = 0;
  const statuses = [];
  const save = createAutosave({ initial: "saved", read: () => value, write: async () => ++calls > 1, onDirty: (v) => dirty = v, onStatus: (status) => statuses.push(status) });
  assert.equal(await save.flush(), false);
  assert.equal(dirty, true);
  assert.equal(await save.flush(), true);
  assert.equal(calls, 2);
  assert.equal(dirty, false);
  assert.deepEqual(statuses, ["saving", "failed", "saving", "saved"], "Saved is shown only after acknowledgement");
}

// A transport exception behaves like a rejected write.
{
  let calls = 0, dirty;
  const save = createAutosave({ initial: "saved", read: () => "draft", write: async () => { if (++calls === 1) throw Error("offline"); return true; }, onDirty: (v) => dirty = v });
  assert.equal(await save.flush(), false);
  assert.equal(dirty, true);
  assert.equal(await save.flush(), true);
  assert.equal(dirty, false);
}

// A second flush while saving must retain the newest draft, without duplicate writes.
{
  let value = "first", dirty, resolveFirst;
  const writes = [];
  const save = createAutosave({ initial: "saved", read: () => value, write: (v) => {
    writes.push(v);
    return writes.length === 1 ? new Promise((resolve) => resolveFirst = resolve) : Promise.resolve(true);
  }, onDirty: (v) => dirty = v });
  const first = save.flush();
  assert.equal(save.flush(), first);
  value = "second";
  save.flush();
  await Promise.resolve();
  resolveFirst(true);
  assert.equal(await first, true);
  assert.deepEqual(writes, ["first", "second"]);
  assert.equal(dirty, false);
}

// Blur during a failed write must not cause an endless retry loop.
{
  let value = "first", dirty, resolveFirst, calls = 0;
  const save = createAutosave({ initial: "saved", read: () => value, write: () => { calls++; return new Promise((resolve) => resolveFirst = resolve); }, onDirty: (v) => dirty = v });
  const first = save.flush();
  value = "second";
  save.flush();
  await Promise.resolve();
  resolveFirst(false);
  assert.equal(await first, false);
  assert.equal(calls, 1);
  assert.equal(dirty, true);
}

console.log("autosave: ok (retry, exceptions, concurrent writes and latest draft)");
