/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/client/capture.ts
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
