/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/client/journal.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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
 * file: src/lib/client/journal.ts
 * description: the persistent mutation journal of the web app (SPEC §10) and the sync engine that drains it.
 *   Every structural mutation — create a page (client id), rename / move / pin / archive / trash / restore, tags, tasks create / update /
 *   complete / delete, an image added offline — goes through `mutate()`: the effect is applied to the device replica at once, then the
 *   request is sent; when the network is not there it is written to the journal (IndexedDB, ordered by an auto-increment `seq`) and
 *   replayed later, oldest first, one at a time, each attempt with the SAME idempotency key and the SAME client id, so an interruption
 *   (closed tab, crash, lost answer) can neither lose nor duplicate it. Page text is not journaled entry by entry: it is the per-page
 *   versioned draft of src/lib/client/page-sync.ts (one coalesced PATCH with `baseVersion`), which this engine also replays for the pages
 *   that are not open, AFTER the journal (a page is created before it is edited). A stale base is never overwritten: the 409 is recorded
 *   as a conflict and settled by the existing conflict screen when the note is opened (both versions are kept).
 *   One engine at a time across tabs (Web Locks). Pure rules live in journal-core.ts.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { api, ApiError, newKey } from "./api";
import { deleteDraft, deleteMeta, getMeta, idbAll, idbBatch, idbDelete, idbGet, idbPut, listDrafts, putDraft, setMeta, type Draft } from "./offline";
import { getReplicaPage, getReplicaTask, listReplicaPages, patchReplicaPage, pullReplica, putReplicaPage, putReplicaTask, type RPage, type RTask } from "./replica";
import { canQueueImage, classify, describe, mergeIntoQueue, requestOf, type JournalEntry, type JournalKind } from "./journal-core";
import { sameJson } from "@/lib/same-json";
export type { JournalEntry, JournalKind } from "./journal-core";
export { describe } from "./journal-core";

const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("note:journal-changed")); };
export const uuid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));
export const listJournal = () => idbAll<JournalEntry>("journal").then((r) => r.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))).catch(() => [] as JournalEntry[]);
/** Pages with an editor open in this tab: their draft is sent by that editor, not by the background replay. */
export const activeEditors = new Set<string>();
const emptyDoc = () => ({ type: "doc", content: [{ type: "paragraph" }] });
const isoNow = () => new Date().toISOString();

// ── local effect of a mutation on the replica (optimistic; re-applied after each pull while the entry is still waiting) ──
async function applyLocal(e: JournalEntry) {
  const b = e.body as Record<string, any>;
  if (e.kind === "page.create") {
    if (await getReplicaPage(e.entityId)) return;
    const siblings = (await listReplicaPages()).filter((p) => (p.parentId ?? null) === (b.parentId ?? null)); const now = new Date(e.createdAt).toISOString();
    await putReplicaPage({ id: e.entityId, parentId: b.parentId ?? null, databaseId: null, type: b.type ?? "page", section: b.section ?? "notes", title: (b.title as string)?.trim() || "Untitled", icon: b.icon ?? null, cover: null, content: b.content ?? emptyDoc(), properties: b.properties ?? {}, position: siblings.reduce((m, p) => Math.max(m, p.position), 0) + 1, pinned: false, archived: false, version: 0, wordCount: 0, createdAt: now, updatedAt: now, lastOpenedAt: null, deletedAt: null, inboxAt: null, captureKind: null, rev: 0, tags: [], local: true });
  } else if (e.kind === "page.update") { const { baseVersion: _b, versionReason: _r, ...patch } = b; await patchReplicaPage(e.entityId, { ...(patch as Partial<RPage>), ...(typeof patch.title === "string" ? { title: patch.title.trim() || "Untitled" } : {}), updatedAt: isoNow() }); }
  else if (e.kind === "page.trash") { const all = await listReplicaPages(); const ids = new Set([e.entityId]); for (let grew = true; grew;) { grew = false; for (const p of all) if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) { ids.add(p.id); grew = true; } } const at = isoNow(); await idbBatch("pages", all.filter((p) => ids.has(p.id) && !p.deletedAt).map((p) => ({ ...p, deletedAt: at }))).catch(() => {}); }
  else if (e.kind === "page.restore") await patchReplicaPage(e.entityId, { deletedAt: null });
  else if (e.kind === "page.tags") await patchReplicaPage(e.entityId, { tags: [...((b.tags as string[]) ?? [])].sort() });
  else if (e.kind === "task.create") { if (await getReplicaTask(e.entityId)) return; const now = new Date(e.createdAt).toISOString(); await putReplicaTask({ id: e.entityId, pageId: b.pageId ?? null, blockId: b.blockId ?? null, title: b.title, status: b.status ?? "todo", priority: b.priority ?? "medium", dueAt: b.dueAt ?? null, completedAt: b.status === "done" ? now : null, project: b.project ?? null, createdAt: now, updatedAt: now, deletedAt: null, rev: 0, local: true }); }
  else if (e.kind === "task.update") { const t = await getReplicaTask(e.entityId); if (t) await putReplicaTask({ ...t, ...(b as Partial<RTask>), ...(b.status !== undefined ? { completedAt: b.status === "done" ? t.completedAt ?? isoNow() : null } : {}), updatedAt: isoNow() }); }
  else if (e.kind === "task.delete") { const t = await getReplicaTask(e.entityId); if (t) await putReplicaTask({ ...t, deletedAt: isoNow() }); }
}
async function applyResult(e: JournalEntry, res: any) {
  if (e.kind === "page.create" && res?.id) {
    const cur = await getReplicaPage(e.entityId); if (cur?.local || !cur) await putReplicaPage({ ...(cur ?? ({} as RPage)), ...res, tags: cur?.tags ?? [], rev: cur?.rev ?? 0, local: false });
    // text typed before the page existed on the server was based on "version 0": it now continues from the created version
    const d = await idbGet<Draft>("drafts", e.entityId).catch(() => undefined); if (d && d.baseVersion === 0) await putDraft({ ...d, baseVersion: res.version });
    try { const ls = JSON.parse(localStorage.getItem(`note-draft-${e.entityId}`) ?? "null"); if (ls && ls.baseVersion === 0) localStorage.setItem(`note-draft-${e.entityId}`, JSON.stringify({ ...ls, baseVersion: res.version })); } catch { /* ignore */ }
  } else if ((e.kind === "task.create" || e.kind === "task.update") && res?.id) { const cur = await getReplicaTask(e.entityId); await putReplicaTask({ ...(cur ?? ({} as RTask)), ...res, rev: cur?.rev ?? 0, local: false }); }
  else if (e.kind === "page.update" && res?.version) await patchReplicaPage(e.entityId, { version: res.version, updatedAt: res.updatedAt });
}

async function send(e: JournalEntry): Promise<any> {
  const rq = requestOf(e);
  if (rq.upload) {
    const blob = await idbGet<{ id: string; file: Blob; name: string; mime: string; pageId: string | null }>("blobs", e.entityId);
    if (!blob) return { id: e.entityId, missing: true }; // nothing left to send (already uploaded and cleaned, or wiped)
    const fd = new FormData(); fd.append("id", e.entityId); fd.append("file", new File([blob.file], blob.name, { type: blob.mime })); if (blob.pageId) { const pg = await getReplicaPage(blob.pageId); if (pg && !pg.local) fd.append("pageId", blob.pageId); }
    let res: Response; try { res = await fetch(rq.url, { method: "POST", body: fd, credentials: "same-origin", headers: { "idempotency-key": e.id, "x-request-id": newKey() } }); } catch { throw new ApiError("Network unreachable", 0, "network"); }
    const body = await res.json().catch(() => null); if (!res.ok) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status, body?.code, body);
    await idbDelete("blobs", e.entityId).catch(() => {}); return body;
  }
  return api(rq.url, { method: rq.method, json: rq.json, idempotencyKey: e.id, timeoutMs: 20_000 });
}

/**
 * Apply a mutation: replica first, then the server. Returns `{ queued: false, result }` when the server confirmed it now, or
 * `{ queued: true }` when it was written to the journal (offline, server unreachable, or older entries still waiting — order is kept).
 * A 4xx from the server is thrown to the caller (and the replica is refreshed) exactly as a direct API call would.
 */
export async function mutate<T = any>(kind: JournalKind, entityId: string, body: Record<string, unknown> = {}): Promise<{ queued: boolean; result?: T }> {
  const entry: JournalEntry = { id: newKey(), kind, entityId, body, createdAt: Date.now(), attempts: 0, state: "pending" };
  let queue: JournalEntry[] = []; let durable = true;
  try { queue = await listJournal(); await applyLocal(entry); } catch { durable = false; }
  const waiting = queue.some((e) => e.state === "pending");
  if (!waiting && (typeof navigator === "undefined" || navigator.onLine)) {
    try { const result = await send(entry); await applyResult(entry, result).catch(() => {}); return { queued: false, result }; }
    catch (e) { const err = e as ApiError; if (classify(kind, err.status ?? 0) !== "retry" || !durable || err.status === 401) { if (durable && err.status !== 401) pullReplica().catch(() => {}); throw e; } }
  }
  if (!durable) throw new ApiError("Network unreachable", 0, "network"); // no IndexedDB (private mode): nothing can be kept
  const m = mergeIntoQueue(queue, entry);
  if ("put" in m) await idbPut("journal", m.put);
  changed(); if (typeof navigator !== "undefined" && navigator.onLine) setTimeout(() => { syncNow().catch(() => {}); }, 50);
  return { queued: true };
}
// ── helpers used by the UI ──
/** Create a page under a client-chosen id. Works offline: the page exists on the device at once (version 0) and is sent later. */
export async function createPage(input: { title?: string; section?: string; parentId?: string | null; type?: string; icon?: string | null; content?: unknown; properties?: Record<string, unknown> } = {}): Promise<{ id: string; queued: boolean }> {
  const id = uuid(); const body: Record<string, unknown> = {}; for (const [k, v] of Object.entries(input)) if (v !== undefined) body[k] = v;
  const r = await mutate("page.create", id, body); return { id, queued: r.queued };
}
export const updatePageMeta = (id: string, patch: { title?: string; parentId?: string | null; section?: string; position?: number; pinned?: boolean; archived?: boolean; icon?: string | null; cover?: string | null }) => mutate("page.update", id, patch);
export const trashPage = (id: string) => mutate<{ ok: boolean; trashed: number }>("page.trash", id);
export const restorePage = (id: string) => mutate("page.restore", id);
export const setPageTags = (id: string, tags: string[]) => mutate<string[]>("page.tags", id, { tags });
export async function createTask(input: { title: string; dueAt?: string | null; priority?: string; project?: string | null; pageId?: string | null; blockId?: string | null; status?: string }): Promise<{ id: string; queued: boolean; task?: RTask }> {
  const id = uuid(); const body: Record<string, unknown> = {}; for (const [k, v] of Object.entries(input)) if (v !== undefined) body[k] = v;
  const r = await mutate<RTask>("task.create", id, body); return { id, queued: r.queued, task: r.result };
}
export const updateTask = (id: string, patch: { title?: string; status?: string; priority?: string; dueAt?: string | null; project?: string | null; pageId?: string | null }) => mutate<RTask>("task.update", id, patch);
export const deleteTask = (id: string) => mutate("task.delete", id);

/** Keep an image on the device to upload it later (bounded: 10 MB per image, 100 MB in total). The note references /api/files/<id> at once. */
export async function queueImageUpload(file: File, pageId?: string | null): Promise<{ id: string; url: string; name: string; size: number; mime: string }> {
  const blobs = await idbAll<{ file: Blob }>("blobs"); const ok = canQueueImage(file, blobs.reduce((n, b) => n + (b.file?.size ?? 0), 0)); if (!ok.ok) throw new Error(ok.reason);
  const id = uuid(); await idbPut("blobs", { id, file, name: file.name || "image", mime: file.type, pageId: pageId ?? null, createdAt: Date.now() });
  await idbPut("journal", { id: newKey(), kind: "upload", entityId: id, body: { name: file.name || "image", size: file.size, pageId: pageId ?? null }, createdAt: Date.now(), attempts: 0, state: "pending" } satisfies JournalEntry);
  changed(); return { id, url: `/api/files/${id}`, name: file.name, size: file.size, mime: file.type };
}

// ── replay ──
let running: Promise<FlushReport> | null = null;
export interface FlushReport { sent: number; failed: number; waiting: number; stopped: boolean }
async function flushJournalLocked(): Promise<FlushReport> {
  const rep: FlushReport = { sent: 0, failed: 0, waiting: 0, stopped: false };
  for (const e of await listJournal()) {
    if (e.state === "failed") { rep.failed++; continue; }
    if (typeof navigator !== "undefined" && !navigator.onLine) { rep.stopped = true; break; }
    try { const res = await send(e); await idbDelete("journal", e.seq!); await applyResult(e, res).catch(() => {}); rep.sent++; changed(); }
    catch (x) {
      const err = x as ApiError; const v = classify(e.kind, err.status ?? 0);
      if (v === "done") { await idbDelete("journal", e.seq!); rep.sent++; changed(); continue; }
      const next: JournalEntry = { ...e, attempts: e.attempts + 1, lastError: err.status === 409 ? `Conflict: ${err.message}` : err.message, state: v === "failed" ? "failed" : "pending" };
      await idbPut("journal", next).catch(() => {}); changed();
      if (v === "retry") { rep.stopped = true; break; } rep.failed++;
    }
  }
  rep.waiting = (await listJournal()).filter((e) => e.state === "pending").length;
  return rep;
}
const withLock = <T,>(fn: () => Promise<T>): Promise<T> => (typeof navigator !== "undefined" && navigator.locks ? (navigator.locks.request("note-journal", fn) as Promise<T>) : fn());
/** Replay the journal, oldest first. Safe to call as often as you like; one run at a time, in one tab at a time. */
export function flushJournal(): Promise<FlushReport> {
  if (running) return running;
  running = withLock(flushJournalLocked).finally(() => { running = null; });
  return running;
}

const VERSIONED = ["title", "content", "properties"];
const lsDraft = (id: string): Draft | null => { try { const v = JSON.parse(localStorage.getItem(`note-draft-${id}`) ?? "null"); return v && v.patch ? v : null; } catch { return null; } };
const dropDraft = async (id: string) => { try { localStorage.removeItem(`note-draft-${id}`); } catch { /* ignore */ } await deleteDraft(id); };
export interface PageConflict { pageId: string; title: string; serverVersion: number; at: string }
export const conflictKey = (pageId: string) => `conflict:${pageId}`;
/**
 * Send the page drafts left on the device (text typed offline, or before a crash) for the pages that are not open in this tab — the
 * open ones are saved by their own editor. Each is one versioned PATCH: accepted, or refused with 409 when the note changed elsewhere;
 * in that case NOTHING is overwritten: the draft stays on the device, the conflict is recorded, and the note shows the existing
 * "two versions" screen the next time it is opened.
 */
export async function flushDrafts(): Promise<{ sent: number; conflicts: number; stopped: boolean }> {
  const rep = { sent: 0, conflicts: 0, stopped: false };
  for (const idb of await listDrafts()) {
    if (activeEditors.has(idb.pageId)) continue;
    // The page of the address bar is saved by its own editor even when that editor is not mounted yet: the shell can start this
    // engine before the page component hydrates (its code arrives in a later chunk). Sending its draft from here made the note show
    // the old text with "Saved" while the server already had the new one (3.0 integration, seen once the shell got lighter).
    if (typeof location !== "undefined" && location.pathname === `/p/${idb.pageId}`) continue;
    const ls = lsDraft(idb.pageId); const d = ls && ls.updatedAt > idb.updatedAt ? ls : idb;
    const page = await getReplicaPage(d.pageId); if (page?.local) continue; // its creation is still waiting in the journal
    if (await getMeta(conflictKey(d.pageId))) { rep.conflicts++; continue; } // already known: waits for the owner
    if (typeof navigator !== "undefined" && !navigator.onLine) { rep.stopped = true; break; }
    const versioned = VERSIONED.some((k) => k in d.patch); const base = d.baseVersion === 0 && page ? page.version : d.baseVersion;
    try {
      const r = await api<{ version: number; updatedAt: string; title: string }>(`/api/pages/${d.pageId}`, { method: "PATCH", json: versioned ? { ...d.patch, baseVersion: base } : d.patch, timeoutMs: 20_000 });
      const now = await idbGet<Draft>("drafts", d.pageId).catch(() => undefined);
      if (!now || now.updatedAt <= d.updatedAt) await dropDraft(d.pageId); // typed again meanwhile (another tab): keep the newer draft
      await patchReplicaPage(d.pageId, { ...(d.patch as Partial<RPage>), title: r.title, version: r.version, updatedAt: r.updatedAt }); rep.sent++;
    } catch (x) {
      const err = x as ApiError;
      if (err.status === 409 && err.body?.server) {
        const s = err.body.server; const same = d.patch.properties === undefined && (d.patch.content === undefined || sameJson(d.patch.content, s.content)) && (d.patch.title === undefined || (String(d.patch.title).trim() || "Untitled") === s.title);
        if (same) { await dropDraft(d.pageId); await patchReplicaPage(d.pageId, { title: s.title, content: s.content, version: s.version, updatedAt: s.updatedAt }); rep.sent++; }
        else { await setMeta(conflictKey(d.pageId), { pageId: d.pageId, title: (d.patch.title as string) || page?.title || s.title || "Untitled", serverVersion: s.version, at: isoNow() } satisfies PageConflict); rep.conflicts++; }
      } else if (err.status === 0 || err.status >= 500 || err.status === 401 || err.status === 429) { rep.stopped = true; break; }
      else await setMeta(`draft-error:${d.pageId}`, { pageId: d.pageId, message: err.message, at: isoNow() });
    }
  }
  changed(); return rep;
}
/** Forget a recorded conflict (called when the conflict screen settled it, or when its draft is gone). */
export const clearConflict = (pageId: string) => Promise.all([deleteMeta(conflictKey(pageId)), deleteMeta(`draft-error:${pageId}`)]).then(changed);

/**
 * Called by a page editor before it saves: when the page was created on this device and its creation is still in the journal, the
 * journal is replayed first (a page must exist before it is edited). Resolves with the server version of the page as the replica knows
 * it (null when unknown); rejects with a network error while the creation cannot be sent — the editor then stays "offline · kept".
 */
export async function ensurePageReady(pageId: string): Promise<number | null> {
  let p: RPage | undefined; try { p = await getReplicaPage(pageId); } catch { return null; }
  if (!p) return null; if (!p.local) return p.version || null;
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new ApiError("Network unreachable", 0, "network");
  await flushJournal(); p = await getReplicaPage(pageId);
  if (!p || p.local) throw new ApiError("Network unreachable", 0, "network");
  return p.version || null;
}

export interface SyncReport { journal: FlushReport; drafts: { sent: number; conflicts: number; stopped: boolean }; pulled: { pages: number; tasks: number; attachments: number; tombstones: number } | null; error: string | null }
let syncing: Promise<SyncReport> | null = null;
/** One full round: journal → drafts → pull → re-apply what is still waiting on top of the fresh replica. */
export function syncNow(): Promise<SyncReport> {
  if (syncing) return syncing;
  syncing = (async () => {
    const rep: SyncReport = { journal: { sent: 0, failed: 0, waiting: 0, stopped: false }, drafts: { sent: 0, conflicts: 0, stopped: false }, pulled: null, error: null };
    window.dispatchEvent(new CustomEvent("note:sync-state", { detail: { syncing: true } }));
    try {
      rep.journal = await flushJournal();
      if (!rep.journal.stopped) rep.drafts = await flushDrafts();
      rep.pulled = await pullReplica();
      for (const e of await listJournal()) if (e.state === "pending") await applyLocal(e).catch(() => {});
      // conflicts whose draft no longer exists were settled elsewhere (conflict screen): forget them
      const drafts = new Set((await listDrafts()).map((d) => d.pageId)); for (const m of await idbAll<{ k: string }>("meta").catch(() => [])) if ((m.k.startsWith("conflict:") || m.k.startsWith("draft-error:")) && !drafts.has(m.k.slice(m.k.indexOf(":") + 1))) await deleteMeta(m.k);
    } catch (e: any) { rep.error = e?.message ?? "Sync failed"; }
    finally { window.dispatchEvent(new CustomEvent("note:sync-state", { detail: { syncing: false } })); changed(); }
    return rep;
  })().finally(() => { syncing = null; });
  return syncing;
}
export interface PendingState { journal: JournalEntry[]; drafts: Draft[]; conflicts: PageConflict[]; draftErrors: { pageId: string; message: string }[]; blobs: number; blobBytes: number; pending: number; failed: number }
/** Everything that is waiting on this device, for the status pill and the inspector (captures are counted by the outbox). */
export async function pendingState(): Promise<PendingState> {
  const [journal, drafts, meta, blobs] = await Promise.all([listJournal(), listDrafts(), idbAll<{ k: string; v: any }>("meta").catch(() => []), idbAll<{ file: Blob }>("blobs").catch(() => [])]);
  const conflicts = meta.filter((m) => m.k.startsWith("conflict:")).map((m) => m.v as PageConflict); const draftErrors = meta.filter((m) => m.k.startsWith("draft-error:")).map((m) => m.v as { pageId: string; message: string });
  return { journal, drafts, conflicts, draftErrors, blobs: blobs.length, blobBytes: blobs.reduce((n, b) => n + (b.file?.size ?? 0), 0), pending: journal.filter((e) => e.state === "pending").length + drafts.length, failed: journal.filter((e) => e.state === "failed").length + conflicts.length + draftErrors.length };
}
export async function retryEntry(seq: number) { const e = await idbGet<JournalEntry>("journal", seq); if (e) { await idbPut("journal", { ...e, state: "pending", lastError: undefined }); changed(); } return syncNow(); }
/** Drop a refused mutation. Its optimistic effect on the replica is undone by the next pull (the server copy wins). */
export async function discardEntry(seq: number) {
  const e = await idbGet<JournalEntry>("journal", seq); await idbDelete("journal", seq);
  if (e?.kind === "upload") await idbDelete("blobs", e.entityId).catch(() => {});
  if (e?.kind === "page.create") { await idbDelete("pages", e.entityId).catch(() => {}); await dropDraft(e.entityId); }
  if (e?.kind === "task.create") await idbDelete("tasks", e.entityId).catch(() => {});
  if (e && e.kind !== "page.create" && e.kind !== "task.create" && e.kind !== "upload") { await setMeta("cursor", 0); } // re-read the server truth for what the discarded entry had changed locally
  changed(); if (navigator.onLine) pullReplica().catch(() => {});
}

let started = false;
/** Start the background engine (once per tab): sync at start, when the network returns, when the tab is shown again, and every 2 minutes. */
export function startSyncEngine(): () => void {
  if (started || typeof window === "undefined") return () => {}; started = true;
  const kick = () => { if (document.visibilityState === "visible" && navigator.onLine) syncNow().catch(() => {}); };
  kick(); window.addEventListener("online", kick); document.addEventListener("visibilitychange", kick); window.addEventListener("pageshow", kick);
  const timer = setInterval(kick, 120_000);
  return () => { started = false; clearInterval(timer); window.removeEventListener("online", kick); document.removeEventListener("visibilitychange", kick); window.removeEventListener("pageshow", kick); };
}
