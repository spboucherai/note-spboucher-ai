/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/client/offline.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

"use client";
/**
 * file: src/lib/client/offline.ts
 * description: device-local store (IndexedDB "note-local"). Version 2 (SP Note Next Generation, offline-first):
 *   drafts       — the unsaved state of a page being edited (title/content + the server version it was based on);
 *   outbox       — quick captures not yet confirmed, each with its idempotency key;
 *   pages        — the local replica: every page of the workspace, content included, as GET /api/sync delivers them;
 *   tasks        — the replica of the tasks table (GET /api/sync?kinds=task);
 *   attachments  — attachment metadata (never the files themselves);
 *   journal      — ordered mutation journal (create / rename / move / pin / archive / trash / tags / tasks / queued uploads);
 *   blobs        — images added offline, waiting to be uploaded (bounded, see IMAGE_MAX / BLOBS_MAX in journal-core.ts);
 *   meta         — sync cursor, last sync time, conflicts, integrity report.
 * Retention: a queue entry is deleted as soon as the server confirms it; drafts and captures older than 30 days are purged at startup;
 * EVERYTHING is erased by "Lock this device" / sign-out everywhere (wipeLocalData). It is NOT encrypted: a key readable by the same
 * JavaScript would add nothing against XSS or someone holding the unlocked device, so the protection is the device lock + the wipe.
 * A session that merely expires does not erase drafts (that would lose text); they are replayed after the next sign-in.
 * Nothing private is ever put in the HTTP cache (see public/sw.js): this database is the only offline store.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
const DB = "note-local", VERSION = 2, RETENTION_MS = 30 * 86_400_000;
export interface Draft { pageId: string; baseVersion: number; patch: Record<string, unknown>; updatedAt: number }
export interface OutboxItem { id: string; kind: "capture"; body: { kind: string; text?: string; url?: string }; files?: File[]; uploadedIds?: string[]; createdAt: number; attempts: number; lastError?: string }
export type StoreName = "drafts" | "outbox" | "pages" | "tasks" | "attachments" | "journal" | "blobs" | "meta";
export const STORES: StoreName[] = ["drafts", "outbox", "pages", "tasks", "attachments", "journal", "blobs", "meta"];

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result; const has = (n: string) => d.objectStoreNames.contains(n);
      if (!has("drafts")) d.createObjectStore("drafts", { keyPath: "pageId" });
      if (!has("outbox")) d.createObjectStore("outbox", { keyPath: "id" });
      if (!has("pages")) d.createObjectStore("pages", { keyPath: "id" });
      if (!has("tasks")) d.createObjectStore("tasks", { keyPath: "id" });
      if (!has("attachments")) d.createObjectStore("attachments", { keyPath: "id" });
      if (!has("journal")) d.createObjectStore("journal", { keyPath: "seq", autoIncrement: true });
      if (!has("blobs")) d.createObjectStore("blobs", { keyPath: "id" });
      if (!has("meta")) d.createObjectStore("meta", { keyPath: "k" });
    };
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; resolve(d); };
    r.onerror = () => { dbp = null; reject(r.error); }; r.onblocked = () => { dbp = null; reject(new Error("blocked")); };
  });
  return dbp;
}
function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then((d) => new Promise<T | undefined>((resolve, reject) => { const t = d.transaction(store, mode); const req = fn(t.objectStore(store)); t.oncomplete = () => resolve(req ? (req as IDBRequest<T>).result : undefined); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); }));
}
const notify = () => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("note:local-changed")); };

// ── generic helpers used by the replica and the journal (they reject when IndexedDB is unavailable; callers decide) ──
export const idbGet = <T>(store: StoreName, key: IDBValidKey) => tx<T>(store, "readonly", (s) => s.get(key));
export const idbAll = <T>(store: StoreName) => tx<T[]>(store, "readonly", (s) => s.getAll()).then((r) => r ?? []);
export const idbCount = (store: StoreName) => tx<number>(store, "readonly", (s) => s.count()).then((r) => r ?? 0);
export const idbPut = <T>(store: StoreName, value: T) => tx<IDBValidKey>(store, "readwrite", (s) => s.put(value));
export const idbDelete = (store: StoreName, key: IDBValidKey) => tx(store, "readwrite", (s) => { s.delete(key); });
/** Several writes in ONE transaction (all or nothing): rows to put, keys to delete. */
export const idbBatch = (store: StoreName, puts: unknown[], deletes: IDBValidKey[] = []) => tx(store, "readwrite", (s) => { for (const v of puts) s.put(v); for (const k of deletes) s.delete(k); });
export const idbClear = (store: StoreName) => tx(store, "readwrite", (s) => { s.clear(); });
export const getMeta = <T>(k: string) => idbGet<{ k: string; v: T }>("meta", k).then((r) => r?.v).catch(() => undefined);
export const setMeta = (k: string, v: unknown) => idbPut("meta", { k, v }).then(() => {}).catch(() => {});
export const deleteMeta = (k: string) => idbDelete("meta", k).catch(() => {});

export const getDraft = (pageId: string) => tx<Draft>("drafts", "readonly", (s) => s.get(pageId)).catch(() => undefined);
export const putDraft = (d: Draft) => tx("drafts", "readwrite", (s) => s.put(d)).then(notify).catch(() => { /* private mode / quota: the in-memory copy still exists */ });
export const deleteDraft = (pageId: string) => tx("drafts", "readwrite", (s) => s.delete(pageId)).then(notify).catch(() => {});
export const listDrafts = () => tx<Draft[]>("drafts", "readonly", (s) => s.getAll()).then((r) => r ?? []).catch(() => [] as Draft[]);
export const listOutbox = () => tx<OutboxItem[]>("outbox", "readonly", (s) => s.getAll()).then((r) => (r ?? []).sort((a, b) => a.createdAt - b.createdAt)).catch(() => [] as OutboxItem[]);
export const putOutbox = (i: OutboxItem) => tx("outbox", "readwrite", (s) => s.put(i)).then(notify);
export const deleteOutbox = (id: string) => tx("outbox", "readwrite", (s) => s.delete(id)).then(notify).catch(() => {});

/** Startup hygiene: drop anything older than the retention period. (The replica is not aged out: it is refreshed by every sync.) */
export async function purgeExpired() {
  const now = Date.now();
  for (const d of await listDrafts()) if (now - d.updatedAt > RETENTION_MS) await deleteDraft(d.pageId);
  for (const o of await listOutbox()) if (now - o.createdAt > RETENTION_MS) await deleteOutbox(o.id);
}
/** Lock / sign-out: erase every private byte this app left on the device (replica, journal, queued images, drafts, outbox, legacy localStorage copies, runtime caches). */
export async function wipeLocalData() {
  try { const d = await open(); const names = STORES.filter((n) => d.objectStoreNames.contains(n)); await new Promise<void>((res) => { const t = d.transaction(names, "readwrite"); for (const n of names) t.objectStore(n).clear(); t.oncomplete = () => res(); t.onerror = () => res(); t.onabort = () => res(); }); } catch { /* nothing stored */ }
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("note-pending-") || k.startsWith("note-draft-") || k.startsWith("note-search") || k === "note-recent-searches" || k === "note-sync-state") localStorage.removeItem(k); } catch { /* storage disabled */ }
  try { sessionStorage.clear(); } catch { /* ignore */ }
  try { if (typeof caches !== "undefined") for (const k of await caches.keys()) if (k.startsWith("note-rt-")) await caches.delete(k); } catch { /* ignore */ }
  notify(); if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("note:journal-changed"));
}
