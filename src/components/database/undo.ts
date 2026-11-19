"use client";
/**
 * File: src/components/database/undo.ts
 * Description: Databases Next Generation — the undo / redo stack of a database view (⌘Z / ⇧⌘Z). Each entry knows how to revert and
 *   re-apply itself through the server: a cell edit re-sends the previous values, a deletion calls the restore route, a bulk action
 *   calls the undo journal (`rows/undo`). The stack lives for the time the database is open (50 entries); nothing is kept locally
 *   that the server does not hold.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";

export interface UndoEntry { label: string; undo: () => Promise<unknown>; redo: () => Promise<unknown> }
export interface UndoStack { push: (e: UndoEntry) => void; undo: () => Promise<void>; redo: () => Promise<void>; canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null }
const MAX = 50;
/** `active`: listen to ⌘Z / Ctrl+Z (undo) and ⇧⌘Z / Ctrl+Y (redo) — ignored while typing in a field or in the page editor (they keep their own undo). */
export function useUndoStack(active: boolean): UndoStack {
  const done = useRef<UndoEntry[]>([]); const undone = useRef<UndoEntry[]>([]); const busy = useRef(false); const [, bump] = useState(0);
  const push = useCallback((e: UndoEntry) => { done.current = [...done.current.slice(-(MAX - 1)), e]; undone.current = []; bump((n) => n + 1); }, []);
  const step = useCallback(async (dir: "undo" | "redo") => {
    if (busy.current) return; const from = dir === "undo" ? done : undone; const to = dir === "undo" ? undone : done; const e = from.current[from.current.length - 1];
    if (!e) { toast(dir === "undo" ? "Nothing to undo" : "Nothing to redo"); return; }
    busy.current = true; from.current = from.current.slice(0, -1); bump((n) => n + 1);
    try { await e[dir](); to.current = [...to.current, e]; toast(dir === "undo" ? `Undone: ${e.label}` : `Redone: ${e.label}`); }
    catch (err: any) { toast(dir === "undo" ? "Could not undo" : "Could not redo", { description: err?.message ?? e.label, tone: "danger" }); }
    finally { busy.current = false; bump((n) => n + 1); }
  }, []);
  // steps are queued: ⌘Z pressed three times quickly undoes three actions, one after the other
  const chain = useRef<Promise<void>>(Promise.resolve());
  const undo = useCallback(() => (chain.current = chain.current.then(() => step("undo"))), [step]); const redo = useCallback(() => (chain.current = chain.current.then(() => step("redo"))), [step]);
  useEffect(() => {
    if (!active) return;
    const h = (ev: KeyboardEvent) => {
      if (!(ev.metaKey || ev.ctrlKey) || ev.altKey) return; const k = ev.key.toLowerCase(); if (k !== "z" && k !== "y") return;
      const t = ev.target as HTMLElement | null; if (t && (t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], .ProseMirror"))) return;
      ev.preventDefault(); if (k === "y" || ev.shiftKey) void redo(); else void undo();
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [active, undo, redo]);
  const d = done.current, u = undone.current;
  return { push, undo, redo, canUndo: d.length > 0, canRedo: u.length > 0, undoLabel: d[d.length - 1]?.label ?? null, redoLabel: u[u.length - 1]?.label ?? null };
}
