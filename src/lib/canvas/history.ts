/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/canvas/history.ts
 * Description      : undo / redo history of the canvas editor (its own,
 *                    independent of the browser's): immutable snapshots of the
 *                    document that share every untouched node (documents are
 *                    edited by spreading). A gesture (drag, resize, typing run)
 *                    is one entry: its intermediate states are `transient` and
 *                    only `settle` records the step. Viewport changes are never
 *                    history. Pure.
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

import type { CanvasData } from "./format";

export interface History {
  past: CanvasData[]; present: CanvasData; future: CanvasData[];
  /** The document before the gesture in progress (null when idle). */
  gesture: CanvasData | null;
}
export const HISTORY_LIMIT = 200;
export const createHistory = (present: CanvasData): History => ({ past: [], present, future: [], gesture: null });
const push = (past: CanvasData[], d: CanvasData) => (past.length >= HISTORY_LIMIT ? [...past.slice(past.length - HISTORY_LIMIT + 1), d] : [...past, d]);
/** One undoable step. A no-op (same object) changes nothing. Ends any gesture in progress first. */
export function commit(h: History, next: CanvasData): History {
  const s = h.gesture ? settle(h) : h;
  return next === s.present ? s : { past: push(s.past, s.present), present: next, future: [], gesture: null };
}
/** An intermediate state of a gesture: shown, not recorded. */
export function transient(h: History, next: CanvasData): History {
  return next === h.present ? h : { ...h, present: next, gesture: h.gesture ?? h.present };
}
/** Ends the gesture: everything since it began becomes one step (nothing when the document is back where it started). */
export function settle(h: History): History {
  if (!h.gesture) return h;
  return h.gesture === h.present ? { ...h, gesture: null } : { past: push(h.past, h.gesture), present: h.present, future: [], gesture: null };
}
/** Abandons the gesture: back to the document before it. */
export function cancelGesture(h: History): History { return h.gesture ? { ...h, present: h.gesture, gesture: null } : h; }
export function undo(h: History): History {
  const s = h.gesture ? settle(h) : h; if (!s.past.length) return s;
  return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], gesture: null };
}
export function redo(h: History): History {
  if (h.gesture || !h.future.length) return h;
  return { past: push(h.past, h.present), present: h.future[0], future: h.future.slice(1), gesture: null };
}
/**
 * A document that did not come from the user (the server copy, the result of a merge): it replaces the present and the history is
 * dropped — an older snapshot would not contain what the other session added, and undoing to it would delete that work on the next save.
 */
export const replaceHistory = (_h: History, next: CanvasData): History => createHistory(next);
export const canUndo = (h: History) => h.past.length > 0 || (h.gesture !== null && h.gesture !== h.present);
export const canRedo = (h: History) => h.future.length > 0 && !h.gesture;
