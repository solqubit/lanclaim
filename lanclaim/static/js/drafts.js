// Drafts belong to this browser tab and never change the server until acknowledged.
const prefix = "lanclaim.draft.";
const memory = new Map();
const unstored = new Set();

export function readDraft(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const value = JSON.parse(globalThis.sessionStorage?.getItem(prefix + key) || "null");
    if (value && typeof value === "object") return value;
  } catch { /* Unavailable or damaged storage must not affect the inventory. */ }
  return null;
}

export function saveDraft(key, value) {
  memory.set(key, value);
  try {
    if (!globalThis.sessionStorage) throw Error("unavailable");
    globalThis.sessionStorage.setItem(prefix + key, JSON.stringify(value));
    unstored.delete(key);
    return true;
  } catch {
    unstored.add(key);
    return false;
  }
}

export function clearDraft(key) {
  memory.delete(key);
  unstored.delete(key);
  try { globalThis.sessionStorage?.removeItem(prefix + key); } catch { /* memory fallback */ }
}

export const hasUnstoredDrafts = () => unstored.size > 0;
