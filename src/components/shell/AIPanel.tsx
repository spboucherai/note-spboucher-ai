"use client";
import { X, PanelRightClose, Sparkles } from "lucide-react";
import { useUI } from "@/lib/client/store";
import { Chat } from "@/components/chat/Chat";
import { useEffect, useRef } from "react";
export function AIPanel({ pathname }: { pathname: string }) {
  const ui = useUI(); const pageId = pathname.startsWith("/p/") ? pathname.slice(3).split(/[/?#]/)[0] : null;
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => { const mv = (e: MouseEvent) => { if (!drag.current) return; ui.set({ aiWidth: Math.min(720, Math.max(320, drag.current.w + (drag.current.x - e.clientX))) }); }; const up = () => (drag.current = null); window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up); return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); }; }, [ui]);
  return (
    <>
      <aside aria-label="AI assistant" className="hidden md:flex relative shrink-0 flex-col border-l border-line bg-bg-elev" style={{ width: ui.aiWidth }}>
        <div className="absolute inset-y-0 -left-1 w-2 cursor-col-resize" onMouseDown={(e) => (drag.current = { x: e.clientX, w: ui.aiWidth })} />
        <div className="flex h-12 items-center gap-2 border-b border-line px-3 text-[13px] font-semibold"><span className="grid size-6 place-items-center rounded-md bg-ai-soft text-ai"><Sparkles className="size-3.5" /></span><span>Assistant</span>{pageId && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">page context</span>}<button aria-label="Close assistant" onClick={ui.toggleAI} className="ml-auto grid size-7 place-items-center rounded-md text-fg-muted hover:bg-bg-hover"><PanelRightClose className="size-4" /></button></div>
        <div className="min-h-0 flex-1"><Chat key={pageId ?? "global"} pageId={pageId} prefill={ui.aiContext.prefill} onInsert={(md) => window.dispatchEvent(new CustomEvent("note:insert-markdown", { detail: md }))} /></div>
      </aside>
      <div className="fixed inset-0 z-40 flex flex-col bg-bg md:hidden safe-top">
        <div className="flex h-12 items-center gap-2 border-b border-line px-3 text-[14px] font-medium"><span>AI assistant</span><button aria-label="Close assistant" onClick={ui.toggleAI} className="ml-auto grid size-8 place-items-center rounded-md text-fg-muted"><X className="size-5" /></button></div>
        <div className="min-h-0 flex-1"><Chat key={pageId ?? "global-m"} pageId={pageId} prefill={ui.aiContext.prefill} /></div>
      </div>
    </>
  );
}
