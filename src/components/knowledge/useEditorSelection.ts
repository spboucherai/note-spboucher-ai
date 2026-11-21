/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/knowledge/useEditorSelection.ts
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
 * file: src/components/knowledge/useEditorSelection.ts
 * description: the last non-empty text selection made in the main editor of the page on screen, with the id of the block it starts
 *   in — the evidence of the "Selection" scope of Ask My Knowledge. Clicking into the assistant collapses the DOM selection, so the
 *   last one is kept until a new selection replaces it, the page changes, or the user clears it. Nothing is sent anywhere from here.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useCallback, useEffect, useState } from "react";
export interface EditorSelection { text: string; blockId: string | null }
export function useEditorSelection(pageId: string | null | undefined): { selection: EditorSelection | null; clear: () => void } {
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  useEffect(() => { setSelection(null); if (!pageId) return;
    let raf = 0;
    const read = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const s = document.getSelection(); if (!s || s.isCollapsed || !s.rangeCount) return; const root = document.querySelector("#main-scroll .note-editor .ProseMirror"); const a = s.anchorNode; if (!root || !a || !root.contains(a) || !root.contains(s.focusNode)) return;
      const text = s.toString().replace(/ /g, " ").trim(); if (text.length < 2) return; const start = s.getRangeAt(0).startContainer; const el = (start.nodeType === 1 ? (start as Element) : start.parentElement)?.closest("[data-id]");
      setSelection({ text: text.slice(0, 20_000), blockId: el?.getAttribute("data-id") ?? null });
    }); };
    document.addEventListener("selectionchange", read); read(); return () => { cancelAnimationFrame(raf); document.removeEventListener("selectionchange", read); };
  }, [pageId]);
  return { selection, clear: useCallback(() => setSelection(null), []) };
}
