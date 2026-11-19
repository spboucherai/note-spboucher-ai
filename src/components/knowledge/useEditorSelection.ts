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
