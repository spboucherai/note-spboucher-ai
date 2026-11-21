/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/canvas/store.ts
 * Module           : components
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
 * file: src/components/canvas/store.ts
 * description: editor state of one open canvas, outside React (the surface must pan and zoom without re-rendering a thousand cards):
 *   the document with its own undo history, the selection, the tool, the card being edited and the viewport. Components subscribe to
 *   slices with `useCanvas(store, selector)`; the viewport has its own listeners so that a pan only touches one CSS transform.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useSyncExternalStore } from "react";
import * as M from "@/lib/canvas/model";
import type { CanvasData, CanvasNode, Viewport } from "@/lib/canvas/model";

export type Tool = "select" | "hand" | "draw";
export type ChangeKind = "commit" | "transient" | "typing" | "remote";
export interface CanvasState {
  history: M.History; doc: CanvasData; selection: readonly string[]; edge: string | null; tool: Tool;
  /** id of the card whose content is being edited in place (desktop) or in the sheet (phone) */ editing: string | null;
  readOnly: boolean; canUndo: boolean; canRedo: boolean;
}
type Listener = () => void;

export class CanvasStore {
  private state: CanvasState;
  private listeners = new Set<Listener>();
  private vpListeners = new Set<(v: Viewport) => void>();
  private changeListeners = new Set<(doc: CanvasData, kind: ChangeKind) => void>();
  viewport: Viewport;
  /** size of the surface in CSS pixels (kept by the surface) */ size = { w: 800, h: 600 };
  /** last pointer position in world units (where a paste or a new card lands) */ pointer: M.Point | null = null;

  constructor(doc: CanvasData, readOnly = false) {
    const d = M.readCanvas(doc); const history = M.createHistory(d);
    this.state = { history, doc: d, selection: [], edge: null, tool: "select", editing: null, readOnly, canUndo: false, canRedo: false };
    this.viewport = { ...d.viewport };
  }
  get = () => this.state;
  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  onViewport = (l: (v: Viewport) => void) => { this.vpListeners.add(l); return () => { this.vpListeners.delete(l); }; };
  /** Called after every change of the document: `commit` (one undoable step, undo and redo included), `transient` (mid-gesture), `typing`, `remote`. */
  onChange = (l: (doc: CanvasData, kind: ChangeKind) => void) => { this.changeListeners.add(l); return () => { this.changeListeners.delete(l); }; };
  private set(patch: Partial<CanvasState>) {
    const next = { ...this.state, ...patch };
    if (patch.history) { next.doc = patch.history.present; next.canUndo = M.canUndo(patch.history); next.canRedo = M.canRedo(patch.history); }
    this.state = next; for (const l of this.listeners) l();
  }
  private emit(kind: ChangeKind) { for (const l of this.changeListeners) l(this.state.doc, kind); }
  private prune() { // the selection never points at something that no longer exists
    const { doc, selection, edge, editing } = this.state; const ids = new Set(doc.nodes.map((n) => n.id));
    const sel = selection.filter((id) => ids.has(id));
    const patch: Partial<CanvasState> = {};
    if (sel.length !== selection.length) patch.selection = sel;
    if (edge && !doc.edges.some((e) => e.id === edge)) patch.edge = null;
    if (editing && !ids.has(editing)) patch.editing = null;
    if (Object.keys(patch).length) this.set(patch);
  }

  /* ---- document ---- */
  get doc() { return this.state.doc; }
  /** Applies an edit. `commit` = one undoable step; `transient` = intermediate state of a gesture (call `settle` at its end); `typing` = like transient, but autosaved. */
  apply(fn: (d: CanvasData) => CanvasData, kind: "commit" | "transient" | "typing" = "commit"): boolean {
    if (this.state.readOnly) return false;
    const next = fn(this.state.doc); if (next === this.state.doc) return false;
    this.set({ history: kind === "commit" ? M.commit(this.state.history, next) : M.transient(this.state.history, next) }); this.prune(); this.emit(kind); return true;
  }
  settle() { const h = M.settle(this.state.history); if (h === this.state.history) return; const changed = h.past.length !== this.state.history.past.length; this.set({ history: h }); if (changed) this.emit("commit"); }
  cancel() { const h = M.cancelGesture(this.state.history); if (h !== this.state.history) { this.set({ history: h }); this.prune(); this.emit("transient"); } }
  undo() { const h = M.undo(this.state.history); if (h !== this.state.history) { this.set({ history: h, editing: null }); this.prune(); this.emit("commit"); } }
  redo() { const h = M.redo(this.state.history); if (h !== this.state.history) { this.set({ history: h, editing: null }); this.prune(); this.emit("commit"); } }
  /** A document that did not come from the user (server copy, merge result, recovered draft): replaces the present, drops the history. */
  replace(doc: CanvasData) { this.set({ history: M.replaceHistory(this.state.history, M.readCanvas(doc)) }); this.prune(); this.emit("remote"); }
  get gesturing() { return this.state.history.gesture !== null; }

  /* ---- selection, tool, editing ---- */
  select(ids: readonly string[], edge: string | null = null) { const s = this.state; if (s.edge === edge && s.selection.length === ids.length && ids.every((id, i) => s.selection[i] === id)) return; this.set({ selection: [...ids], edge }); }
  toggle(id: string) { const s = this.state.selection; this.set({ selection: s.includes(id) ? s.filter((x) => x !== id) : [...s, id], edge: null }); }
  selectEdge(id: string | null) { this.set({ selection: [], edge: id }); }
  setTool(tool: Tool) { if (tool !== this.state.tool) this.set({ tool, editing: null }); }
  edit(id: string | null) { if (this.state.readOnly && id) return; if (id !== this.state.editing) { if (!id) this.settle(); this.set({ editing: id, ...(id ? { selection: [id], edge: null } : {}) }); } }
  setReadOnly(readOnly: boolean) { if (readOnly !== this.state.readOnly) this.set({ readOnly, editing: null }); }
  selectedNodes(): CanvasNode[] { const s = new Set(this.state.selection); return this.state.doc.nodes.filter((n) => s.has(n.id)); }

  /* ---- viewport ---- */
  setViewport(v: Viewport) { if (v.x === this.viewport.x && v.y === this.viewport.y && v.zoom === this.viewport.zoom) return; this.viewport = v; for (const l of this.vpListeners) l(v); }
  center(): M.Point { return M.screenToWorld(this.viewport, { x: this.size.w / 2, y: this.size.h / 2 }); }
  fit(ids?: readonly string[], maxZoom = 1) { this.setViewport(M.fitToContent(M.contentBounds(this.state.doc, ids && ids.length ? ids : undefined), this.size, Math.min(64, this.size.w * 0.08), maxZoom)); }
  zoomAtCenter(factor: number) { this.setViewport(M.zoomBy(this.viewport, factor, { x: this.size.w / 2, y: this.size.h / 2 })); }
  /** Where a new card goes: the last pointer position when it is on screen, else the centre of the view. */
  dropPoint(): M.Point { const p = this.pointer; if (p) { const s = M.worldToScreen(this.viewport, p); if (s.x >= 0 && s.y >= 0 && s.x <= this.size.w && s.y <= this.size.h) return p; } return this.center(); }
}

export function useCanvas<T>(store: CanvasStore, selector: (s: CanvasState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}
