/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/shell/CaptureDrop.tsx
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
 * file: src/components/shell/CaptureDrop.tsx
 * description: drag-and-drop capture anywhere in the app shell (SPEC §4.12). Dragging files, a link or text from OUTSIDE the app shows
 *   a drop overlay; dropping opens the quick-capture sheet with what was dropped (nothing is sent before the user confirms). Drags
 *   that start inside the app (blocks, tree rows, text) are ignored, and a drop on the editor or on a form field keeps its own
 *   behaviour (insert the file in the page, type the text). Also contributes the capture commands of the Universal Command Center.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useEffect, useRef, useState } from "react";
import { Inbox } from "lucide-react";
import { registerCommands } from "@/lib/client/commands";
import { captureWindowSelection, openCapture } from "@/lib/client/capture";
import { prefillFromDrop } from "@/lib/client/capture-logic";
import { toast } from "@/components/ui/toast";

const CAPTURABLE = ["Files", "text/uri-list", "text/plain"];
/** Places that handle a drop themselves. */
const ownsDrop = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest(".ProseMirror, input, textarea, [contenteditable='true'], [data-nv-stop], [role='dialog'], .cv-surface"));

export function CaptureDrop() {
  const [over, setOver] = useState<"files" | "content" | null>(null);
  const internal = useRef(false); const depth = useRef(0);
  useEffect(() => {
    const wanted = (e: DragEvent) => { if (internal.current) return null; const types = Array.from(e.dataTransfer?.types ?? []); return types.includes("Files") ? "files" as const : types.some((t) => CAPTURABLE.includes(t)) ? "content" as const : null; };
    const end = () => { depth.current = 0; setOver(null); };
    const onStart = () => { internal.current = true; }; const onEnd = () => { internal.current = false; end(); };
    const onEnter = (e: DragEvent) => { const w = wanted(e); if (!w) return; depth.current += 1; setOver(ownsDrop(e.target) ? null : w); };
    const onOver = (e: DragEvent) => { const w = wanted(e); if (!w) return; if (ownsDrop(e.target)) { setOver(null); return; } e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; setOver(w); };
    const onLeave = (e: DragEvent) => { if (!wanted(e)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0 || e.relatedTarget === null) end(); };
    const onDrop = (e: DragEvent) => {
      const w = wanted(e); end(); if (!w || e.defaultPrevented || ownsDrop(e.target)) return; // a surface that took the drop (canvas, editor) keeps it
      e.preventDefault(); const dt = e.dataTransfer;
      const prefill = prefillFromDrop({ files: Array.from(dt?.files ?? []), uriList: dt?.getData("text/uri-list") ?? "", text: dt?.getData("text/plain") ?? "" });
      if (prefill) openCapture(prefill); else toast("Nothing to capture in that drop");
    };
    window.addEventListener("dragstart", onStart); window.addEventListener("dragend", onEnd); window.addEventListener("dragenter", onEnter); window.addEventListener("dragover", onOver); window.addEventListener("dragleave", onLeave); window.addEventListener("drop", onDrop);
    return () => { window.removeEventListener("dragstart", onStart); window.removeEventListener("dragend", onEnd); window.removeEventListener("dragenter", onEnter); window.removeEventListener("dragover", onOver); window.removeEventListener("dragleave", onLeave); window.removeEventListener("drop", onDrop); };
  }, []);
  useEffect(() => registerCommands([
    { id: "capture.selection", group: "Create", title: "Capture the selected text", icon: "inbox", keywords: "capture selection quote highlight inbox extrait", when: () => Boolean(window.getSelection()?.toString().trim()), run: () => { captureWindowSelection(); } },
    { id: "capture.clipboard", group: "Create", title: "Capture from the clipboard", icon: "inbox", keywords: "paste screenshot link image coller presse-papiers", hint: "Opens quick capture — paste there", run: () => openCapture() },
  ]), []);
  if (!over) return null;
  return (
    <div data-testid="capture-drop" aria-hidden className="capture-drop pointer-events-none fixed inset-0 z-[65] grid place-items-center bg-bg/70 p-6 backdrop-blur-sm">
      <div className="flex max-w-sm flex-col items-center gap-2 rounded-sheet border-2 border-dashed border-accent/60 bg-bg-elev px-8 py-7 text-center shadow-pop">
        <span className="grid size-12 place-items-center rounded-2xl bg-lumen text-accent-fg"><Inbox className="size-6" /></span>
        <div className="text-[16px] font-semibold tracking-[-0.01em]">Drop to capture</div>
        <div className="text-[13px] leading-5 text-fg-muted">{over === "files" ? "Images, PDFs, audio and documents go to your inbox." : "The link or the text goes to your inbox."} You confirm before anything is saved.</div>
      </div>
    </div>
  );
}
