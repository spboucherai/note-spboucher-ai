"use client";
/**
 * file: src/components/shell/RightPanel.tsx
 * description: multi-panel workspace — the resizable right column that hosts registered panels (src/lib/client/panels.ts). Ships
 *   with two panels: "Outline" (headings of the page on screen, click to jump) and "Side page" (a second, fully editable page next
 *   to the main one, with its own autosave). Desktop only (≥ 1024 px): on phones the page keeps its single scroll container.
 *   Enters with the Intelligent Panels motion (slide + blur from the right edge).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PanelRightClose, ListTree, PanelRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useUI } from "@/lib/client/store";
import { registerPanel, getPanels, subscribePanels, type PanelContext } from "@/lib/client/panels";
import { api } from "@/lib/client/api";
import { docBlocks, type PMNode } from "@/lib/editor/text";
// the side page brings the whole editor with it: loaded only when someone opens a page to the side
const SidePage = dynamic(() => import("./SidePage").then((m) => m.SidePage), { ssr: false, loading: () => <div className="p-4"><div className="skeleton h-7 w-2/3" /></div> });
import { cn } from "@/lib/utils";

/** Drag-to-resize handle on the left edge of a right-hand column (pointer events, keyboard arrows, persisted by the caller). */
export function ResizeHandle({ width, onWidth, min = 320, max = 760 }: { width: number; onWidth: (w: number) => void; min?: number; max?: number }) {
  const [drag, setDrag] = React.useState(false); const start = React.useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.min(max, Math.max(min, Math.round(w)));
  return <div role="separator" aria-orientation="vertical" aria-label="Resize panel" aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} tabIndex={0} data-dragging={drag} className="resize-handle -left-1"
    onPointerDown={(e) => { start.current = { x: e.clientX, w: width }; setDrag(true); e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={(e) => { if (start.current) onWidth(clamp(start.current.w + (start.current.x - e.clientX))); }}
    onPointerUp={() => { start.current = null; setDrag(false); }} onPointerCancel={() => { start.current = null; setDrag(false); }}
    onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); onWidth(clamp(width + 24)); } else if (e.key === "ArrowRight") { e.preventDefault(); onWidth(clamp(width - 24)); } }} />;
}

function OutlinePanel({ pageId }: { pageId: string | null }) {
  const q = useQuery({ queryKey: ["page-source", pageId], enabled: Boolean(pageId), staleTime: 5_000, refetchOnWindowFocus: true, queryFn: () => api<{ content: PMNode; title: string }>(`/api/pages/${pageId}`) });
  // headings are read from the editor on screen when it is there (live while typing), else from the saved copy
  const [live, setLive] = React.useState<{ id: string | null; text: string; level: number }[] | null>(null);
  React.useEffect(() => {
    const read = () => { const root = document.querySelector("#main-scroll .note-editor .ProseMirror"); if (!root) { setLive(null); return; } setLive(Array.from(root.querySelectorAll<HTMLElement>(":scope > h1, :scope > h2, :scope > h3")).map((h) => ({ id: h.dataset.id ?? null, text: h.textContent ?? "", level: Number(h.tagName[1]) }))); };
    read(); const t = setInterval(read, 1500); return () => clearInterval(t);
  }, [pageId]);
  const heads = live ?? docBlocks(q.data?.content).filter((b) => b.type === "heading").map((b) => ({ id: b.id, text: b.text, level: 2 }));
  if (!pageId) return <div className="p-4 text-ui text-fg-muted">Open a page to see its outline.</div>;
  if (!heads.length) return <div className="p-4 text-ui text-fg-muted">This page has no heading yet. Headings (“/h1”, “/h2”, “/h3”) build its outline.</div>;
  return <nav aria-label="Outline" className="p-2">{heads.map((h, i) => <button key={`${h.id}-${i}`} type="button" className="side-item w-full text-left" style={{ paddingLeft: 8 + (h.level - 1) * 14 }} onClick={() => { const el = h.id ? document.getElementById(`block-${h.id}`) : null; el?.scrollIntoView({ block: "start", behavior: "auto" }); }}><span className="truncate">{h.text || "Untitled heading"}</span></button>)}</nav>;
}

let builtIn = false;
/** The two panels shipped with the shell. Features add theirs with `registerPanel` (same API). */
export function registerBuiltInPanels() {
  if (builtIn) return; builtIn = true;
  registerPanel({ id: "outline", title: "Outline", icon: <ListTree />, available: (c) => Boolean(c.pageId), render: (c) => <OutlinePanel pageId={c.pageId} /> });
  registerPanel({ id: "page", title: "Side page", icon: <PanelRight />, available: (c) => Boolean(c.arg), render: (c) => (c.arg ? <SidePage pageId={c.arg} mainPageId={c.pageId} /> : null) });
}

export function RightPanel({ pathname }: { pathname: string }) {
  const ui = useUI(); const panels = React.useSyncExternalStore(subscribePanels, getPanels, getPanels);
  const pageId = pathname.startsWith("/p/") ? pathname.slice(3).split(/[/?#]/)[0] : null;
  const state = ui.panel; if (!state) return null;
  const ctx: PanelContext = { pageId, pathname, arg: state.arg ?? null, close: ui.closePanel };
  const def = panels.find((p) => p.id === state.id); const tabs = panels.filter((p) => p.id === state.id || (p.available ? p.available(ctx) : true));
  return (
    <aside aria-label={def?.title ?? "Panel"} data-panel={state.id} className="panel-in-right relative hidden shrink-0 flex-col border-l border-line bg-bg-elev lg:flex" style={{ width: ui.aiWidth }}>
      <ResizeHandle width={ui.aiWidth} onWidth={(w) => ui.set({ aiWidth: w })} />
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-2">
        <div role="tablist" aria-label="Panels" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">{tabs.map((p) => <button key={p.id} role="tab" aria-selected={p.id === state.id} onClick={() => ui.set({ panel: { id: p.id, arg: p.id === state.id ? state.arg : null } })} className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2.5 text-ui font-medium text-fg-muted transition-colors hover:bg-bg-hover [&_svg]:size-4", p.id === state.id && "bg-bg-sunk text-fg", p.tone === "ai" && "text-ai")}>{p.icon}{p.title}</button>)}</div>
        <button type="button" aria-label="Close panel" onClick={ui.closePanel} className="icon-btn"><PanelRightClose /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{def ? def.render(ctx) : <div className="p-4 text-ui text-fg-muted">This panel is not available.</div>}</div>
    </aside>
  );
}
