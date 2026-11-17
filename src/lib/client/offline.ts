"use client";
/**
 * Device-local store (IndexedDB "note-local"):
 *   drafts  — the unsaved state of a page being edited (title/content + the server version it was based on);
 *   outbox  — mutations created while offline or not yet confirmed (quick captures, page saves), each with its idempotency key.
 * Retention: an entry is deleted as soon as the server confirms it; anything older than 30 days is purged at startup; everything is
 * erased by "Lock this device" / sign-out everywhere. It is NOT encrypted: a key readable by the same JavaScript would add nothing against
 * XSS or someone holding the unlocked device, so the protection is the device lock + the short retention. A session that merely expires
 * does not erase drafts (that would lose text); they are replayed after the next sign-in.
 */
const DB = "note-local", VERSION = 1, RETENTION_MS = 30 * 86_400_000;
export interface Draft { pageId: string; baseVersion: number; patch: Record<string, unknown>; updatedAt: number }
export interface OutboxItem { id: string; kind: "capture"; body: { kind: string; text?: string; url?: string }; files?: File[]; uploadedIds?: string[]; createdAt: number; attempts: number; lastError?: string }

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("drafts")) d.createObjectStore("drafts", { keyPath: "pageId" }); if (!d.objectStoreNames.contains("outbox")) d.createObjectStore("outbox", { keyPath: "id" }); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => { dbp = null; reject(r.error); }; r.onblocked = () => { dbp = null; reject(new Error("blocked")); };
  });
  return dbp;
}
function tx<T>(store: "drafts" | "outbox", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then((d) => new Promise<T | undefined>((resolve, reject) => { const t = d.transaction(store, mode); const req = fn(t.objectStore(store)); t.oncomplete = () => resolve(req ? (req as IDBRequest<T>).result : undefined); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); }));
}
const notify = () => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("note:local-changed")); };

export const getDraft = (pageId: string) => tx<Draft>("drafts", "readonly", (s) => s.get(pageId)).catch(() => undefined);
export const putDraft = (d: Draft) => tx("drafts", "readwrite", (s) => s.put(d)).then(notify).catch(() => { /* private mode / quota: the in-memory copy still exists */ });
export const deleteDraft = (pageId: string) => tx("drafts", "readwrite", (s) => s.delete(pageId)).then(notify).catch(() => {});
export const listDrafts = () => tx<Draft[]>("drafts", "readonly", (s) => s.getAll()).then((r) => r ?? []).catch(() => [] as Draft[]);
export const listOutbox = () => tx<OutboxItem[]>("outbox", "readonly", (s) => s.getAll()).then((r) => (r ?? []).sort((a, b) => a.createdAt - b.createdAt)).catch(() => [] as OutboxItem[]);
export const putOutbox = (i: OutboxItem) => tx("outbox", "readwrite", (s) => s.put(i)).then(notify);
export const deleteOutbox = (id: string) => tx("outbox", "readwrite", (s) => s.delete(id)).then(notify).catch(() => {});

/** Startup hygiene: drop anything older than the retention period. */
export async function purgeExpired() {
  const now = Date.now();
  for (const d of await listDrafts()) if (now - d.updatedAt > RETENTION_MS) await deleteDraft(d.pageId);
  for (const o of await listOutbox()) if (now - o.createdAt > RETENTION_MS) await deleteOutbox(o.id);
}
/** Lock / sign-out: erase every private byte this app left on the device (drafts, outbox, legacy localStorage copies, runtime caches). */
export async function wipeLocalData() {
  try { const d = await open(); await new Promise<void>((res) => { const t = d.transaction(["drafts", "outbox"], "readwrite"); t.objectStore("drafts").clear(); t.objectStore("outbox").clear(); t.oncomplete = () => res(); t.onerror = () => res(); t.onabort = () => res(); }); } catch { /* nothing stored */ }
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("note-pending-") || k.startsWith("note-draft-") || k.startsWith("note-search") || k === "note-recent-searches") localStorage.removeItem(k); } catch { /* storage disabled */ }
  try { sessionStorage.clear(); } catch { /* ignore */ }
  try { if (typeof caches !== "undefined") for (const k of await caches.keys()) if (k.startsWith("note-rt-")) await caches.delete(k); } catch { /* ignore */ }
  notify();
}
