"use client";
/**
 * file: src/lib/client/capture.ts
 * description: one way to open the quick-capture sheet with something already in it (dropped files, a shared link, the text selected
 *   in the editor). The prefill is handed over in memory — files cannot go through localStorage — and consumed once by CaptureSheet.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useUI } from "./store";
import type { CapturePrefill } from "./capture-logic";

let pending: CapturePrefill | null = null;
/** Open the capture sheet. With a prefill, the sheet shows it instead of the saved draft; nothing is sent until the user captures. */
export function openCapture(prefill?: CapturePrefill | null): void {
  if (prefill) { pending = prefill; window.dispatchEvent(new CustomEvent("note:capture-prefill")); }
  useUI.getState().set({ captureOpen: true });
}
/** Called by the sheet: returns the waiting prefill exactly once. */
export function takePrefill(): CapturePrefill | null { const p = pending; pending = null; return p; }
/** Capture what is selected right now anywhere in the app (outside form fields). Returns false when nothing is selected. */
export function captureWindowSelection(): boolean {
  const text = (typeof window !== "undefined" ? window.getSelection()?.toString() ?? "" : "").trim(); if (!text) return false;
  const m = location.pathname.match(/^\/p\/([0-9a-f-]{36})/i);
  openCapture({ origin: "selection", text: text.slice(0, 50_000), sourceUrl: m ? `/p/${m[1]}` : undefined, sourceTitle: m ? document.title.replace(/\s+[·|—-]\s+[^·|—-]*$/, "") : undefined });
  return true;
}
