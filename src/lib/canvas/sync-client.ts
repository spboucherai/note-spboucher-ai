/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/canvas/sync-client.ts
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
 * file: src/lib/canvas/sync-client.ts
 * description: autosave engine of one canvas (browser side of `PUT /api/canvases/<pageId>`, docs/next/API-NEXT.md §4.8).
 *   - a change is sent 900 ms after the last one, one request at a time, never in the middle of a gesture (`hold`);
 *   - every save carries the version it was based on; on 409 the server copy is merged with the local document against the
 *     remembered base (three-way merge by node / edge id, src/lib/canvas/merge.ts), the result is shown and sent again;
 *   - what the merge could not settle is listed in `conflicts` (non-blocking: the canvas stays editable; nothing was lost);
 *   - the unsaved document AND its base are mirrored to IndexedDB (the app's draft store, key `canvas:<pageId>`), so a closed tab,
 *     a dead battery or a lost network cannot lose work — it is replayed (or merged) on the next visit;
 *   - the viewport is view state: a change of the viewport alone is never sent (it would create a version for nothing — the API has no
 *     version-free write); it travels with the next real change, and each device remembers its own in localStorage.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { api, ApiError } from "@/lib/client/api";
import { deleteDraft, getDraft, putDraft } from "@/lib/client/offline";
import { danglingEdges, jsonEqual, mergeCanvas, readCanvas, removeEdges, type CanvasConflict, type CanvasData } from "./model";

export type CanvasSyncStatus = "saved" | "saving" | "offline" | "error";
export interface CanvasServerCopy { data: CanvasData; version: number; updatedAt: string }
export interface CanvasSyncState { status: CanvasSyncStatus; error: string | null; savedAt: string; conflicts: CanvasConflict[]; version: number; pending: boolean }
export interface CanvasSyncHooks {
  /** the document on screen */ current: () => CanvasData;
  /** show a document that did not come from the user (merge result, newer server copy, recovered draft) */
  applyRemote: (doc: CanvasData, why: "merge" | "remote" | "draft") => void;
  onDraftRestored?: () => void; onRemoteUpdate?: () => void; onConflicts?: (added: CanvasConflict[]) => void;
}
const DEBOUNCE = 900, DRAFT_DEBOUNCE = 350, MAX_REBASES = 6;
const draftKey = (pageId: string) => `canvas:${pageId}`;
const vpKey = (pageId: string) => `note-canvas-vp-${pageId}`;
/** Everything but the viewport: what makes a canvas "changed". */
const content = (d: CanvasData) => { const { viewport: _v, ...rest } = d; return rest; };
export const sameContent = (a: CanvasData, b: CanvasData) => a === b || jsonEqual(content(a), content(b));
const conflictKey = (c: CanvasConflict) => `${c.kind}:${c.id}`;

export function readLocalViewport(pageId: string): CanvasData["viewport"] | null {
  try { const v = JSON.parse(localStorage.getItem(vpKey(pageId)) ?? "null"); return v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.zoom > 0 ? { x: v.x, y: v.y, zoom: v.zoom } : null; } catch { return null; }
}
export function writeLocalViewport(pageId: string, v: { x: number; y: number; zoom: number }) { try { localStorage.setItem(vpKey(pageId), JSON.stringify({ x: v.x, y: v.y, zoom: v.zoom })); } catch { /* storage full or disabled: the viewport is a comfort */ } }

export class CanvasSync {
  private base: CanvasData; private version: number;
  private state: CanvasSyncState; private listeners = new Set<() => void>();
  private dirty = false; private inflight = false; private held = false; private blocked = false; private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null; private draftTimer: ReturnType<typeof setTimeout> | null = null; private backoff = 0;
  private stash: CanvasServerCopy | null = null;
  private cleanup: (() => void)[] = [];

  constructor(private pageId: string, initial: CanvasServerCopy, private hooks: CanvasSyncHooks, private readOnly = false) {
    this.base = readCanvas(initial.data); this.version = initial.version;
    this.state = { status: "saved", error: null, savedAt: initial.updatedAt, conflicts: [], version: initial.version, pending: false };
  }
  get = () => this.state;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<CanvasSyncState>) { if (this.disposed) return; this.state = { ...this.state, ...p, version: this.version, pending: this.dirty || this.inflight }; for (const l of this.listeners) l(); }

  /** Replays the draft of a previous visit and starts listening to the network and to the tab's visibility. Call once, from an effect. */
  start() {
    this.disposed = false;
    void this.restoreDraft();
    const online = () => { this.backoff = 0; if (this.dirty) void this.flush(); else if (this.state.status === "offline") this.set({ status: "saved", error: null }); };
    const offline = () => { if (this.dirty || this.inflight) this.set({ status: "offline" }); };
    const leave = () => { if (this.dirty) { this.writeDraft(); this.beacon(); } };
    const vis = () => { if (document.visibilityState === "hidden") leave(); else void this.check(); };
    const focus = () => void this.check();
    window.addEventListener("online", online); window.addEventListener("offline", offline); window.addEventListener("pagehide", leave); document.addEventListener("visibilitychange", vis); window.addEventListener("focus", focus);
    this.cleanup.push(() => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", vis); window.removeEventListener("focus", focus); });
  }
  /** Stops the timers and listeners; a pending change is sent one last time (the draft stays on the device until it is confirmed). */
  dispose() {
    if (this.timer) clearTimeout(this.timer); if (this.draftTimer) clearTimeout(this.draftTimer);
    if (this.dirty) { this.writeDraft(); this.held = false; void this.flush(); }
    for (const c of this.cleanup) c(); this.cleanup = []; this.disposed = true;
  }

  /** The document changed (a user edit). Cheap to call on every change. */
  notify() {
    if (this.readOnly) return;
    const doc = this.hooks.current();
    if (sameContent(doc, this.base)) { // back to what the server holds (undo): nothing to send
      this.dirty = false; this.blocked = false; if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      if (!this.inflight) { void deleteDraft(draftKey(this.pageId)); this.set({ status: "saved", error: null }); }
      return;
    }
    this.dirty = true; this.blocked = false;
    if (!this.draftTimer) this.draftTimer = setTimeout(() => { this.draftTimer = null; this.writeDraft(); }, DRAFT_DEBOUNCE);
    this.set({ status: this.state.status === "offline" ? "offline" : "saving" });
    this.schedule(DEBOUNCE);
  }
  /** `true` while a gesture is in progress (drag, resize, ink stroke, layout animation): nothing is sent and no remote copy is applied until `hold(false)`. */
  hold(on: boolean) {
    if (on === this.held) return; this.held = on; if (on) return;
    if (this.stash) { const s = this.stash; this.stash = null; this.rebase(s); }
    if (this.dirty) this.schedule(DEBOUNCE);
  }
  retry = () => { this.blocked = false; this.backoff = 0; if (this.dirty) void this.flush(); else this.set({ status: "saved", error: null }); };
  /** Removes a conflict from the review list (after "keep mine" / "keep theirs"). */
  dismiss(c: CanvasConflict) { this.set({ conflicts: this.state.conflicts.filter((x) => conflictKey(x) !== conflictKey(c)) }); }
  dismissAll() { this.set({ conflicts: [] }); }

  private schedule(ms: number) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, ms); }
  private writeDraft() {
    if (!this.dirty || this.disposed) return;
    void putDraft({ pageId: draftKey(this.pageId), baseVersion: this.version, patch: { data: this.hooks.current(), base: this.base }, updatedAt: Date.now() });
  }
  /** What is sent: the document on screen, minus edges that lost an end (the server would refuse the whole save). */
  private outgoing(): CanvasData { const d = this.hooks.current(); const bad = danglingEdges(d); return bad.length ? removeEdges(d, bad.map((e) => e.id)) : d; }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty || this.inflight || this.held || this.blocked || this.readOnly) return;
    for (let attempt = 0; attempt < MAX_REBASES; attempt++) {
      const sent = this.outgoing(); this.inflight = true; this.set({ status: this.state.status === "offline" ? "offline" : "saving" });
      try {
        const r = await api<{ version: number; updatedAt: string }>(`/api/canvases/${this.pageId}`, { method: "PUT", json: { data: sent, baseVersion: this.version }, timeoutMs: 25_000 });
        this.inflight = false; this.base = sent; this.version = r.version; this.backoff = 0;
        if (sameContent(this.hooks.current(), sent)) { this.dirty = false; if (this.draftTimer) { clearTimeout(this.draftTimer); this.draftTimer = null; } await deleteDraft(draftKey(this.pageId)); this.set({ status: "saved", error: null, savedAt: r.updatedAt }); }
        else { this.set({ savedAt: r.updatedAt }); this.writeDraft(); this.schedule(400); } // edited while the request was in flight
        return;
      } catch (e) {
        this.inflight = false; const err = e as ApiError;
        if (err.status === 409 && err.code === "conflict" && err.body?.server) {
          const server = err.body.server as CanvasServerCopy;
          if (this.held) { this.stash = server; this.set({}); return; } // mid-gesture: merge when the gesture ends
          this.rebase(server); if (!this.dirty) return; continue; // merged: send the result on top of the server's version
        }
        if (err.status === 401) { this.set({ status: "error", error: "Sign-in required — your changes are kept on this device." }); return; }
        if (err.status === 0 || err.status >= 500) {
          this.set({ status: err.status === 0 || (typeof navigator !== "undefined" && !navigator.onLine) ? "offline" : "error", error: err.message });
          this.backoff = Math.min(30_000, this.backoff ? this.backoff * 2 : 3000); this.schedule(this.backoff); return;
        }
        this.blocked = true; this.set({ status: "error", error: err.message }); return; // 4xx: sending the same document again cannot succeed
      }
    }
    this.schedule(2000); // the canvas kept moving under us: breathe, then try again
  }

  /**
   * The server holds a newer copy. Three-way merge of (remembered base, document on screen, server copy); the result replaces the
   * document on screen, the server copy becomes the new base, and what could not be settled joins the review list.
   */
  private rebase(server: CanvasServerCopy) {
    const local = this.hooks.current(); const remote = readCanvas(server.data);
    const m = mergeCanvas(this.base, local, remote);
    this.base = remote; this.version = server.version;
    if (m.merged !== local) this.hooks.applyRemote(m.merged, "merge");
    this.dirty = !sameContent(m.merged, remote);
    if (m.conflicts.length) { const fresh = new Map(this.state.conflicts.map((c) => [conflictKey(c), c])); for (const c of m.conflicts) fresh.set(conflictKey(c), c); this.set({ conflicts: [...fresh.values()] }); this.hooks.onConflicts?.(m.conflicts); }
    if (!this.dirty) { void deleteDraft(draftKey(this.pageId)); this.set({ status: "saved", error: null, savedAt: server.updatedAt }); } else this.writeDraft();
  }

  /** Another session may have written while this tab was in the background. */
  async check(): Promise<void> {
    if (this.disposed || document.visibilityState !== "visible" || this.inflight || this.held) return;
    try {
      const s = await api<CanvasServerCopy>(`/api/canvases/${this.pageId}`, { timeoutMs: 10_000 });
      if (this.disposed || s.version === this.version || this.inflight) return;
      if (this.held) { this.stash = s; return; }
      if (!this.dirty) { this.base = readCanvas(s.data); this.version = s.version; if (!sameContent(this.hooks.current(), this.base)) { this.hooks.applyRemote({ ...this.base, viewport: this.hooks.current().viewport }, "remote"); this.hooks.onRemoteUpdate?.(); } this.set({ savedAt: s.updatedAt }); }
      else { this.rebase(s); if (this.dirty) void this.flush(); }
    } catch { /* offline or signed out: handled by the save path */ }
  }

  private async restoreDraft() {
    if (this.readOnly) return;
    const d = await getDraft(draftKey(this.pageId)); if (!d || this.disposed) return;
    const p = d.patch as { data?: unknown; base?: unknown }; if (!p?.data) { await deleteDraft(draftKey(this.pageId)); return; }
    const mine = readCanvas(p.data);
    if (sameContent(mine, this.base)) { await deleteDraft(draftKey(this.pageId)); return; }
    if (d.baseVersion === this.version) { this.hooks.applyRemote(mine, "draft"); this.dirty = true; }
    else { // the canvas moved on while the draft waited: merge the draft with the newer copy against the base it was made from
      const base = readCanvas(p.base ?? this.base); const m = mergeCanvas(base, mine, this.base);
      this.hooks.applyRemote(m.merged, "draft"); this.dirty = !sameContent(m.merged, this.base);
      if (m.conflicts.length) { this.set({ conflicts: m.conflicts }); this.hooks.onConflicts?.(m.conflicts); }
    }
    this.hooks.onDraftRestored?.();
    if (this.dirty) { this.set({ status: "saving" }); void this.flush(); } else await deleteDraft(draftKey(this.pageId));
  }
  /** Last chance when the tab goes away: a keepalive request with the same version check (bodies above ~60 KB are refused by browsers; the draft covers those). */
  private beacon() {
    if (this.inflight || this.blocked || this.readOnly || typeof navigator === "undefined" || !navigator.onLine) return;
    try { const body = JSON.stringify({ data: this.outgoing(), baseVersion: this.version }); if (body.length > 60_000) return; fetch(`/api/canvases/${this.pageId}`, { method: "PUT", body, keepalive: true, headers: { "content-type": "application/json" }, credentials: "same-origin" }).catch(() => {}); } catch { /* the draft is on the device */ }
  }
}
