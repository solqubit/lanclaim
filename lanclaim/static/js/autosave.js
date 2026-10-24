// Keep the last acknowledged value separate from a write that may fail.
export function createAutosave({ initial, read, write, onDirty, onStatus = () => {} }) {
  let saved = initial;
  let pending = null;
  let queued = false;
  const dirty = () => read().trim() !== saved;

  async function persist(value) {
    let ok = false;
    onStatus("saving");
    try {
      ok = await write(value);
      if (ok) saved = value;
    } catch {
      // The caller reports the error; keep the draft available for another try.
    }
    pending = null;
    onDirty(dirty());
    onStatus(ok ? dirty() ? "draft" : "saved" : "failed");
    const again = queued;
    queued = false;
    return ok && again && dirty() ? flush() : ok;
  }

  function flush() {
    if (pending) {
      queued = true;
      return pending;
    }
    if (!dirty()) {
      onDirty(false);
      onStatus("saved");
      return Promise.resolve(true);
    }
    onDirty(true);
    const value = read().trim();
    pending = Promise.resolve().then(() => persist(value));
    return pending;
  }

  return { flush, isDirty: dirty, isPending: () => !!pending };
}
