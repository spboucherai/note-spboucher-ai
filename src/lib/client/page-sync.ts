/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/client/page-sync.ts
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
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { deleteDraft, getDraft, putDraft } from "./offline";
import { activeEditors, clearConflict, ensurePageReady } from "./journal";
import { patchReplicaPage } from "./replica";

/**
 * Autosave engine for one page.
 *  - edits are merged into one pending patch, sent 800 ms after the last keystroke, one request at a time;
 *  - every save carries the server version it was based on; the server refuses a stale base (409) instead of overwriting;
 *  - the pending patch is mirrored to IndexedDB at once, so a killed tab, a dead battery or a lost network cannot lose text —
 *    it is replayed on the next visit (or shown as a conflict if the page moved meanwhile);
 *  - when the tab is hidden a keepalive request is attempted too; it uses the same version check;
 *  - states: saved · saving · offline (will retry by itself) · error (retry button) · conflict (user decides, both copies are kept);
 *  - 3.0 offline-first: a page created on this device is sent (mutation journal) before its first save; the device replica is updated
 *    with every confirmed save; drafts of pages that are not open are replayed by the sync engine (src/lib/client/journal.ts).
 */
export type SyncStatus = "saved" | "saving" | "offline" | "error" | "conflict";
export interface ServerCopy { version: number; title: string; content: any; properties?: Record<string, unknown>; updatedAt: string }
export interface Conflict { server: ServerCopy; mine: { title?: string; content?: any } }
type Patch = Record<string, unknown>;
const VERSIONED = ["title", "content", "properties"];
export { sameJson } from "@/lib/same-json";
import { sameJson } from "@/lib/same-json";
const BEACON_MAX = 60_000;
/**
 * IndexedDB writes are asynchronous: a tab closed a few milliseconds after the last keystroke can cut one short. When the tab is hidden
 * or unloaded, the pending patch is therefore ALSO written synchronously to localStorage (same retention and wipe rules as the IndexedDB
 * draft; skipped silently above the storage quota). The next visit takes whichever copy is newer.
 */
const LS = (id: string) => `note-draft-${id}`;
function writeSyncDraft(d: { pageId: string; baseVersion: number; patch: Record<string, unknown>; updatedAt: number }) { try { localStorage.setItem(LS(d.pageId), JSON.stringify(d)); } catch { /* quota or storage disabled */ } }
function readSyncDraft(id: string): { pageId: string; baseVersion: number; patch: Record<string, unknown>; updatedAt: number } | null { try { const v = JSON.parse(localStorage.getItem(LS(id)) ?? "null"); return v && typeof v === "object" && v.patch ? v : null; } catch { return null; } }
function clearSyncDraft(id: string) { try { localStorage.removeItem(LS(id)); } catch { /* ignore */ } }
async function dropDraft(id: string) { clearSyncDraft(id); await deleteDraft(id); } // keepalive bodies above ~64 KB are rejected by browsers; the IndexedDB draft covers larger notes

export function usePageSync(page: { id: string; version: number; title: string; content: any; updatedAt: string }, hooks: { applyRemote: (copy: ServerCopy) => void; current: () => { title: string; content: any }; onSaved?: (patch: Patch) => void; onDraftRestored?: () => void }) {
  const [status, setStatus] = useState<SyncStatus>("saved"); const [error, setError] = useState<string | null>(null); const [conflict, setConflict] = useState<Conflict | null>(null);
  const [savedAt, setSavedAt] = useState<string>(page.updatedAt);
  const version = useRef(page.version); const pending = useRef<Patch | null>(null); const inflight = useRef(false); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(0); const blocked = useRef(false); const hooksRef = useRef(hooks); hooksRef.current = hooks; const alive = useRef(true);

  const lastEdit = useRef(0);
  const persist = useCallback(() => { if (pending.current) { lastEdit.current = Date.now(); putDraft({ pageId: page.id, baseVersion: version.current, patch: pending.current, updatedAt: lastEdit.current }); } }, [page.id]);
  /** A 409 whose server copy already equals what we wanted to write is not a conflict: our own last-chance save (sent when the tab was hidden) got there first. */
  const sameAsServer = (server: ServerCopy, patch: Patch | null) => Boolean(patch) && patch!.properties === undefined && (patch!.content === undefined || sameJson(patch!.content, server.content)) && (patch!.title === undefined || (String(patch!.title).trim() || "Untitled") === server.title) && Object.keys(patch!).every((k) => VERSIONED.includes(k));
  const raiseConflict = useCallback((server: ServerCopy, patch: Patch | null) => {
    if (sameAsServer(server, patch)) { version.current = server.version; pending.current = null; blocked.current = false; dropDraft(page.id); if (alive.current) { setStatus("saved"); setError(null); setSavedAt(server.updatedAt); } return; }
    blocked.current = true; const cur = hooksRef.current.current();
    setConflict({ server, mine: { title: (patch?.title as string | undefined) ?? cur.title, content: patch?.content ?? cur.content } }); setStatus("conflict");
  }, [page.id]);
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!pending.current || inflight.current || blocked.current) return;
    const patch = pending.current; pending.current = null; inflight.current = true; if (alive.current) setStatus("saving");
    const versioned = VERSIONED.some((k) => k in patch);
    try {
      const known = await ensurePageReady(page.id); if (version.current === 0 && known) version.current = known; // created offline: now it exists on the server
      const r = await api<{ version: number; updatedAt: string }>(`/api/pages/${page.id}`, { method: "PATCH", json: versioned ? { ...patch, baseVersion: version.current } : patch, timeoutMs: 20_000 });
      version.current = r.version; backoff.current = 0; hooksRef.current.onSaved?.(patch);
      patchReplicaPage(page.id, { ...(patch as object), ...(typeof patch.title === "string" ? { title: patch.title.trim() || "Untitled" } : {}), version: r.version, updatedAt: r.updatedAt }).catch(() => {});
      if (!pending.current) { await dropDraft(page.id); if (alive.current) { setStatus("saved"); setError(null); setSavedAt(r.updatedAt); } } else persist();
    } catch (e) {
      const err = e as ApiError; pending.current = { ...patch, ...(pending.current ?? {}) }; persist();
      if (err.status === 409 && err.code === "conflict" && err.body?.server) raiseConflict(err.body.server, pending.current);
      else if (err.status === 401) { /* redirected to sign-in; the draft stays on the device */ }
      else if (err.status === 0 || err.status >= 500) { if (alive.current) { setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : err.status === 0 ? "offline" : "error"); setError(err.message); } backoff.current = Math.min(30_000, backoff.current ? backoff.current * 2 : 3000); timer.current = setTimeout(flush, backoff.current); }
      else { blocked.current = true; if (alive.current) { setStatus("error"); setError(err.message); } } // 4xx: retrying the same body cannot succeed; keep the draft and let the user act
    } finally { inflight.current = false; if (pending.current && !blocked.current && !timer.current) timer.current = setTimeout(flush, 400); }
  }, [page.id, persist, raiseConflict]);

  const queue = useCallback((patch: Patch) => {
    pending.current = { ...(pending.current ?? {}), ...patch }; persist();
    if (blocked.current) return; // conflict or hard error on screen: keep collecting locally
    setStatus((s) => (s === "offline" ? "offline" : "saving"));
    if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(flush, 800);
  }, [flush, persist]);

  const retry = useCallback(() => { if (conflict) return; blocked.current = false; backoff.current = 0; if (pending.current) flush(); else setStatus("saved"); }, [conflict, flush]);

  /** Settle a conflict. The server keeps both copies in the history whatever the choice. */
  const resolve = useCallback(async (choice: "mine" | "theirs" | "both"): Promise<{ copyId: string | null }> => {
    if (!conflict) return { copyId: null };
    const cur = hooksRef.current.current(); const mine = { title: (pending.current?.title as string | undefined) ?? cur.title, content: pending.current?.content ?? cur.content };
    try {
      const r = await api<ServerCopy & { copyId: string | null }>(`/api/pages/${page.id}/resolve`, { method: "POST", json: { choice, serverVersion: conflict.server.version, mine } });
      version.current = r.version; pending.current = null; await dropDraft(page.id); blocked.current = false; clearConflict(page.id).catch(() => {});
      patchReplicaPage(page.id, { title: r.title, content: r.content, version: r.version, updatedAt: r.updatedAt }).catch(() => {});
      if (choice !== "mine") hooksRef.current.applyRemote(r);
      setConflict(null); setStatus("saved"); setError(null); setSavedAt(r.updatedAt); return { copyId: r.copyId };
    } catch (e) {
      const err = e as ApiError; if (err.status === 409 && err.body?.server) { setConflict({ server: err.body.server, mine }); throw new Error("The note changed again — review the new version."); }
      throw e;
    }
  }, [conflict, page.id]);

  // Draft left by a previous visit (crash, offline, closed tab): replay it, or show a conflict when the page moved on.
  useEffect(() => {
    alive.current = true; let cancelled = false; activeEditors.add(page.id);
    (async () => {
      const idb = await getDraft(page.id); const ls = readSyncDraft(page.id); const d = idb && ls ? (ls.updatedAt > idb.updatedAt ? ls : idb) : idb ?? ls; if (!d || cancelled) return;
      const same = (d.patch.content === undefined || sameJson(d.patch.content, page.content)) && (d.patch.title === undefined || d.patch.title === page.title) && d.patch.properties === undefined && Object.keys(d.patch).every((k) => VERSIONED.includes(k));
      if (same) { await dropDraft(page.id); return; }
      // The recovered draft wins over anything queued in the first milliseconds of this visit (the editor normalising the server copy it was mounted with).
      pending.current = { ...(pending.current ?? {}), ...d.patch };
      if (d.baseVersion === page.version) { hooksRef.current.applyRemote({ version: page.version, title: (d.patch.title as string) ?? page.title, content: d.patch.content ?? page.content, updatedAt: page.updatedAt }); hooksRef.current.onDraftRestored?.(); setStatus("saving"); flush(); }
      else raiseConflict({ version: page.version, title: page.title, content: page.content, updatedAt: page.updatedAt }, d.patch);
    })();
    return () => { cancelled = true; alive.current = false; activeEditors.delete(page.id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  // Network back, tab hidden / closed, tab visible again (another session may have written meanwhile).
  useEffect(() => {
    const online = () => { if (!blocked.current) { backoff.current = 0; if (pending.current) flush(); else setStatus((s) => (s === "offline" ? "saved" : s)); } };
    const offline = () => { if (pending.current || inflight.current) setStatus("offline"); };
    // pagehide and visibilitychange both fire when a tab goes away: send the same pending state once.
    let sentFor: Patch | null = null;
    const lastChance = () => {
      if (pending.current) writeSyncDraft({ pageId: page.id, baseVersion: version.current, patch: pending.current, updatedAt: lastEdit.current || Date.now() }); // synchronous: survives the tab being killed right now
      if (!pending.current || blocked.current || inflight.current) return; persist();
      if (sentFor === pending.current || !navigator.onLine) return; // offline: the device draft is the safety net; a queued keepalive would only land later, out of order
      const body = JSON.stringify({ ...pending.current, baseVersion: version.current });
      if (body.length <= BEACON_MAX) { sentFor = pending.current; try { fetch(`/api/pages/${page.id}/beacon`, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" }, credentials: "same-origin" }).catch(() => {}); } catch { /* the draft is on the device */ } }
    };
    const check = async () => {
      if (document.visibilityState !== "visible" || inflight.current || blocked.current) return;
      try {
        const head = await api<{ version: number }>(`/api/pages/${page.id}?head=1`, { timeoutMs: 8000 });
        if (head.version === version.current) return;
        const full = await api<ServerCopy>(`/api/pages/${page.id}`);
        if (pending.current) { // our keepalive save may be the one that moved the version: compare before crying conflict
          const p = pending.current; const mineEqualsServer = (p.content === undefined || sameJson(p.content, full.content)) && (p.title === undefined || p.title === full.title) && p.properties === undefined;
          if (mineEqualsServer) { version.current = full.version; pending.current = null; await dropDraft(page.id); setStatus("saved"); setSavedAt(full.updatedAt); } else raiseConflict(full, p);
        } else { version.current = full.version; hooksRef.current.applyRemote(full); setSavedAt(full.updatedAt); window.dispatchEvent(new CustomEvent("note:remote-update")); }
      } catch { /* offline or signed out: handled elsewhere */ }
    };
    const vis = () => { if (document.visibilityState === "hidden") lastChance(); else check(); };
    window.addEventListener("online", online); window.addEventListener("offline", offline); window.addEventListener("pagehide", lastChance); document.addEventListener("visibilitychange", vis); window.addEventListener("focus", check);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); window.removeEventListener("pagehide", lastChance); document.removeEventListener("visibilitychange", vis); window.removeEventListener("focus", check); if (timer.current) clearTimeout(timer.current); if (pending.current && !blocked.current) flush(); };
  }, [flush, page.id, persist, raiseConflict]);

  return { status, error, conflict, savedAt, queue, flush, retry, resolve, hasPending: () => Boolean(pending.current) || inflight.current };
}
