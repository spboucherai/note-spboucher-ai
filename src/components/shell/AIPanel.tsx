/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/shell/AIPanel.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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
import { useEffect, useRef } from "react";
import { X, PanelRightClose, Sparkles } from "lucide-react";
import { useUI } from "@/lib/client/store";
import { useIsPhone, useKeyboardInset } from "@/lib/client/hooks";
import dynamic from "next/dynamic";
// loaded when the panel opens: the chat renders Markdown with KaTeX (≈ 420 kB), which was in the first-load JavaScript of every screen
const Chat = dynamic(() => import("@/components/chat/Chat").then((m) => m.Chat), { ssr: false, loading: () => <div className="p-4"><div className="skeleton h-7 w-2/3" /></div> });
/**
 * Assistant panel. Desktop: resizable right column. Phone: a full-height screen pinned between the top of the viewport and the top of
 * the on-screen keyboard (`bottom: var(--kb)`), laid out as a flex column so the composer is always the last visible row — it can never
 * end up under the keys. Opening the panel sends nothing to any provider.
 */
export function AIPanel({ pathname }: { pathname: string }) {
  const ui = useUI(); const isPhone = useIsPhone(); useKeyboardInset(); // publishes --kb / --vvh
  const pageId = pathname.startsWith("/p/") ? pathname.slice(3).split(/[/?#]/)[0] : null;
  const drag = useRef<{ x: number; w: number } | null>(null); const panel = useRef<HTMLDivElement>(null);
  const set = ui.set;
  useEffect(() => { const mv = (e: MouseEvent) => { if (!drag.current) return; set({ aiWidth: Math.min(720, Math.max(320, drag.current.w + (drag.current.x - e.clientX))) }); }; const up = () => (drag.current = null); window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up); return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); }; }, [set]);
  useEffect(() => { if (!isPhone) return; const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=dialog][data-state=open]")) set({ aiOpen: false }); }; window.addEventListener("keydown", onKey); panel.current?.focus({ preventScroll: true }); return () => window.removeEventListener("keydown", onKey); }, [isPhone, set]);
  const conversationId = (ui.aiContext.pageId ?? null) === pageId ? ui.aiContext.conversationId ?? null : null;
  const insert = pageId ? (md: string) => { window.dispatchEvent(new CustomEvent("note:insert-markdown", { detail: md })); if (isPhone) set({ aiOpen: false }); } : undefined;
  const chat = <Chat key={pageId ?? "global"} pageId={pageId} conversationId={conversationId} prefill={ui.aiContext.prefill} onInsert={insert} />;
  if (isPhone) return (
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="AI assistant" className="panel-in-bottom fixed inset-x-0 top-0 z-40 flex min-w-0 flex-col overflow-hidden bg-bg outline-none safe-top" style={{ bottom: "var(--kb, 0px)" }}>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line pl-3 pr-1 text-[15px] font-semibold"><span className="grid size-7 place-items-center rounded-md bg-ai-soft text-ai"><Sparkles className="size-4" /></span><span className="min-w-0 flex-1 truncate">Assistant{pageId ? " · this page" : ""}</span><button type="button" aria-label="Close assistant" onClick={() => set({ aiOpen: false })} className="grid size-11 place-items-center rounded-md text-fg-muted"><X className="size-5" /></button></div>
      <div className="min-h-0 flex-1">{chat}</div>
    </div>
  );
  return (
    <aside aria-label="AI assistant" className="panel-in-right relative flex shrink-0 flex-col border-l border-line bg-bg-elev" style={{ width: ui.aiWidth }}>
      <div className="absolute inset-y-0 -left-1 w-2 cursor-col-resize" onMouseDown={(e) => (drag.current = { x: e.clientX, w: ui.aiWidth })} />
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 text-[13px] font-semibold"><span className="grid size-6 place-items-center rounded-md bg-ai-soft text-ai"><Sparkles className="size-3.5" /></span><span>Assistant</span>{pageId && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">page open</span>}<button type="button" aria-label="Close assistant" onClick={ui.toggleAI} className="ml-auto grid size-8 place-items-center rounded-md text-fg-muted hover:bg-bg-hover"><PanelRightClose className="size-4" /></button></div>
      <div className="min-h-0 flex-1">{chat}</div>
    </aside>
  );
}
