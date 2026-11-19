"use client";
/**
 * file: src/components/knowledge/SemanticZoom.tsx
 * description: Semantic Zoom on a page — one control, four levels: Synopsis (AI, level 1) · Outline (level 2) · Full (level 3) ·
 *   Full + connections. Levels 1 and 2 come from /api/pages/<id>/zoom: the outline is computed by the server without any model;
 *   the synopsis is read with `cachedOnly=1` on first paint, so opening a page or switching level never spends money — a model is
 *   called only when the user presses "Generate" / "Regenerate", and the result is shown marked AI with its model and date.
 *   The editor stays mounted (hidden) at levels 1–2, so autosave and sync are untouched. Level changes use signature motion 7
 *   (`semanticZoom`: cross-dissolve) and keep the reader's place: the block at the top of the screen maps to its outline section
 *   and back. Shortcuts: ⌥1 … ⌥4.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { flushSync } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw, ArrowRight, ArrowLeft, Share2 } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { registerCommands } from "@/lib/client/commands";
import { semanticZoom } from "@/lib/client/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { REL_LABEL, ZOOM_LEVELS, sectionOf, zoomShortcut, type ZoomLevel } from "@/lib/client/knowledge";
import type { ZoomOutline } from "@/lib/pages/zoom";
import type { Synopsis } from "@/lib/ai/zoom";
import type { RelationOut } from "@/lib/graph/relations";
import { DecideButtons } from "./GraphPanels";
import { AIBadge, Segmented, fmtDateTime } from "./shared";

type Rel = Omit<RelationOut, "createdAt" | "updatedAt" | "decidedAt" | "validFrom" | "validTo"> & { validFrom: string | null; validTo: string | null };
const scroller = () => document.getElementById("main-scroll");

export function ZoomFrame({ pageId, children, className, readOnly, beforeZoom }: { pageId: string; children: React.ReactNode; className?: string; readOnly?: boolean; /** e.g. flush the autosave so the server outline is the text on screen */ beforeZoom?: () => Promise<unknown> | void }) {
  const qc = useQueryClient(); const [level, setLevel] = React.useState<ZoomLevel>(3); const frame = React.useRef<HTMLDivElement>(null); const busy = React.useRef(false); const lastAnchor = React.useRef<string | null>(null);
  const outline = useQuery({ queryKey: ["zoom", pageId, 2], enabled: level === 2, staleTime: 5_000 /* each switch to the outline fetches it once (fetchQuery in `go`) */, queryFn: () => api<ZoomOutline>(`/api/pages/${pageId}/zoom?level=2`) });
  // first paint of level 1: the cache only (never a provider call)
  const syn = useQuery({ queryKey: ["zoom", pageId, 1], enabled: level === 1, staleTime: 0, retry: false, queryFn: () => api<Synopsis>(`/api/pages/${pageId}/zoom/ai?cachedOnly=1`) });
  const generate = useMutation({
    mutationFn: (force: boolean) => (force ? api<Synopsis>(`/api/pages/${pageId}/zoom/ai`, { method: "POST", json: {} }) : api<Synopsis>(`/api/pages/${pageId}/zoom/ai`)),
    onSuccess: (s) => { qc.setQueryData(["zoom", pageId, 1], s); },
    onError: (e: any) => toast(e instanceof ApiError && e.code === "no_model" ? "AI is not configured on this server" : "The synopsis could not be written", { description: e?.message, tone: "danger" }),
  });
  const go = React.useCallback(async (next: ZoomLevel) => {
    if (busy.current || next === level) return; busy.current = true;
    try {
      const sc = scroller(); const el = frame.current; const top = sc?.getBoundingClientRect().top ?? 0;
      // the block under the reader's eyes, and where it sits on screen
      let anchor: string | null = null, offset = 0; const view = el?.querySelector<HTMLElement>("[data-zoom-view]:not([hidden])");
      for (const b of Array.from(view?.querySelectorAll<HTMLElement>("[data-id]") ?? [])) { const r = b.getBoundingClientRect(); if (r.height > 0 && r.bottom > top + 1) { anchor = b.dataset.id ?? null; offset = r.top - top; break; } }
      const frameAbove = (el?.getBoundingClientRect().top ?? 0) < top; if (level === 1) anchor = lastAnchor.current; else lastAnchor.current = frameAbove ? anchor : null;
      const blocks = Array.from(el?.querySelectorAll<HTMLElement>("[data-zoom-view='full'] .ProseMirror > [data-id]") ?? []).map((b) => b.dataset.id ?? null);
      await semanticZoom(el, sc, async () => {
        if (next <= 2) await Promise.resolve(beforeZoom?.()).catch(() => {});
        let sections: ZoomOutline["sections"] = [];
        if (next === 2) { try { sections = (await qc.fetchQuery({ queryKey: ["zoom", pageId, 2], staleTime: 0, queryFn: () => api<ZoomOutline>(`/api/pages/${pageId}/zoom?level=2`) })).sections; } catch { /* the view shows the error */ } }
        flushSync(() => setLevel(next));
        if (!sc || !el) return;
        // bring the same place back: full ↔ full keeps its own element (handled by the helper); outline ↔ full maps block ↔ section
        if (next === 1) { if (frameAbove) sc.scrollTop += el.getBoundingClientRect().top - top - 12; return; }
        if (next >= 3 && level >= 3) return;
        const id = next === 2 ? sectionOf(blocks, sections, anchor) : anchor; if (!id) return;
        const target = el.querySelector<HTMLElement>(next === 2 ? `[data-zoom-view='outline'] [data-id="${CSS.escape(id)}"]` : `[data-zoom-view='full'] [data-id="${CSS.escape(id)}"]`);
        if (target && (frameAbove || level === 1)) sc.scrollTop += target.getBoundingClientRect().top - top - (level === 1 ? 12 : Math.max(0, Math.min(offset, 160)));
      });
    } finally { busy.current = false; }
  }, [level, pageId, qc, beforeZoom]);
  const goRef = React.useRef(go); goRef.current = go;
  React.useEffect(() => { const onKey = (e: KeyboardEvent) => { const l = zoomShortcut(e); if (l) { e.preventDefault(); void goRef.current(l); } }; window.addEventListener("keydown", onKey, true); return () => window.removeEventListener("keydown", onKey, true); }, []);
  React.useEffect(() => registerCommands(ZOOM_LEVELS.map((z) => ({ id: `page.zoom.${z.id}`, group: "View", title: `Reading level: ${z.label}`, keywords: "semantic level synopsis connections" /* no “zoom” here: “outline zoom” must keep finding the editor's own fold command first */, shortcut: `⌥${z.key}`, icon: "list-tree", run: () => goRef.current(z.id) }))), []);
  const jump = async (blockId: string | null) => { await go(3); if (!blockId) return; requestAnimationFrame(() => document.getElementById(`block-${blockId}`)?.scrollIntoView({ block: "start" })); };
  const s = generate.data ?? syn.data;
  return (
    <div ref={frame} className={className} data-testid="zoom-frame" data-zoom-level={level}>
      <div className="mb-2 flex justify-end print:hidden"><Segmented label="Semantic zoom" size="sm" value={level} onChange={(l) => void go(l)} options={ZOOM_LEVELS.map((z) => ({ id: z.id, label: z.id === 1 ? <span className="inline-flex items-center gap-1"><Sparkles className="size-3 text-ai" />{z.label}</span> : z.label, title: `${z.label} (⌥${z.key})`, testId: `zoom-${z.id}` }))} /></div>
      {level === 1 && <section data-zoom-view="synopsis" aria-label="Synopsis" className="ai-surface p-4" data-testid="zoom-synopsis" data-status={s?.status ?? (syn.isLoading ? "loading" : "error")}>
        <div className="mb-2 flex flex-wrap items-center gap-2">{s?.status === "ready" ? <AIBadge model={s.model} at={s.generatedAt} label="AI synopsis" /> : <AIBadge label="AI synopsis" />}{s?.status === "ready" && <span className="text-micro text-fg-muted" data-testid="zoom-synopsis-meta">{s.model} · {fmtDateTime(s.generatedAt)}{s.cached ? " · from the cache, nothing was sent" : ""}</span>}</div>
        {syn.isLoading && !s ? <div className="space-y-2"><Skeleton className="h-4" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-2/3" /></div>
          : s?.status === "ready" ? <><p className="font-serif text-[1.0625rem] leading-7 [overflow-wrap:anywhere]" data-testid="zoom-synopsis-text">{s.synopsis}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" className="max-md:h-11" disabled={generate.isPending || readOnly} onClick={() => generate.mutate(true)} data-testid="zoom-regenerate">{generate.isPending ? <Spinner className="size-3.5" /> : <RefreshCw />}Regenerate</Button><span className="text-micro text-fg-muted">Regenerating calls a model once (a few thousandths of a dollar). Any edit of the page makes this synopsis out of date.</span></div></>
          : s?.status === "empty" ? <p className="text-ui leading-5 text-fg-muted">This page has no text to summarise yet.</p>
          : s?.status === "missing" ? <><p className="text-ui leading-5 text-fg-muted" data-testid="zoom-synopsis-missing">No synopsis exists for the current text of this page. Nothing was sent to any provider. A model can write one (one short call); it will be marked as AI-generated and kept until the page changes.</p>
            <Button variant="ai" size="sm" className="mt-3 max-md:h-11" disabled={generate.isPending || readOnly} onClick={() => generate.mutate(false)} data-testid="zoom-generate">{generate.isPending ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <Sparkles />}Generate synopsis</Button></>
          : <p role="alert" className="text-ui text-danger-text">The synopsis could not be read{syn.error ? `: ${(syn.error as Error).message}` : ""}. <button type="button" className="underline" onClick={() => syn.refetch()}>Retry</button></p>}
      </section>}
      {level === 2 && <section data-zoom-view="outline" aria-label="Outline" data-testid="zoom-outline">
        <p className="mb-2 text-micro text-fg-muted">Outline — headings and the first sentence of each section, computed without AI. Click a section to read it in full.</p>
        {outline.isLoading ? <div className="space-y-2"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-4" /><Skeleton className="h-6 w-1/3" /><Skeleton className="h-4" /></div> : outline.isError ? <p role="alert" className="text-ui text-danger-text">The outline could not be loaded. <button type="button" className="underline" onClick={() => outline.refetch()}>Retry</button></p>
          : outline.data?.sections.length ? <ol className="space-y-1">{outline.data.sections.map((sec, i) => <li key={`${sec.blockId}-${i}`} data-id={sec.blockId ?? undefined} style={{ marginLeft: `${Math.max(0, Math.min(3, sec.level - 1)) * 1.1}rem` }}>
            <button type="button" onClick={() => jump(sec.blockId)} className="block w-full rounded-control px-2 py-1.5 text-left hover:bg-bg-hover">{sec.heading != null && <span className={cn("block font-serif font-semibold leading-snug [overflow-wrap:anywhere]", sec.level <= 1 ? "text-h3" : sec.level === 2 ? "text-[1.125rem]" : "text-body")}>{sec.heading || "Untitled heading"}</span>}{sec.firstSentence && <span className="block text-body leading-6 text-fg-muted [overflow-wrap:anywhere]">{sec.firstSentence}</span>}<span className="block text-micro text-fg-muted">{sec.words} word{sec.words === 1 ? "" : "s"} · {sec.blocks} block{sec.blocks === 1 ? "" : "s"}</span></button>
          </li>)}</ol> : <p className="text-ui text-fg-muted">This page has no text yet.</p>}
      </section>}
      {level === 4 && <PageConnections pageId={pageId} />}
      <div data-zoom-view="full" hidden={level < 3}>{children}</div>
    </div>
  );
}

/** Level 4: the typed relations, links and citations of the page, right above its text. Suggested ones are marked AI and decided here. */
function PageConnections({ pageId }: { pageId: string }) {
  const q = useQuery({ queryKey: ["page-relations", pageId], queryFn: () => api<{ relations: Rel[] }>(`/api/graph/relations?nodeId=${pageId}&include=cites,ai_suggested,link`), staleTime: 10_000 });
  const rels = (q.data?.relations ?? []).filter((r) => r.status !== "rejected");
  return (
    <section aria-label="Connections of this page" className="mb-3 rounded-card border border-line bg-bg-elev p-3 shadow-card print:hidden" data-testid="zoom-connections" data-count={rels.length}>
      <div className="mb-1.5 flex items-center gap-2"><h2 className="text-micro font-semibold uppercase tracking-[0.08em] text-fg-muted">Connections</h2><span className="rounded-pill bg-bg-sunk px-1.5 text-micro tabular-nums text-fg-muted">{rels.length}</span><Link href={`/graph?view=local&pageId=${pageId}`} className="ml-auto inline-flex items-center gap-1 text-micro font-medium text-accent hover:underline"><Share2 className="size-3" />Local graph</Link></div>
      {q.isLoading ? <Skeleton className="h-8" /> : q.isError ? <p className="text-ui text-danger-text">The connections could not be loaded.</p> : rels.length ? <ul className="grid gap-1 sm:grid-cols-2">{rels.map((r) => { const out = r.fromId === pageId; const other = out ? { id: r.toId, title: r.toTitle, kind: r.targetKind } : { id: r.fromId, title: r.fromTitle, kind: r.sourceKind }; const label = r.kind === "link" ? (out ? "links to" : "linked from") : r.kind === "cites" ? "cites" : r.kind === "ai_suggested" ? "related to" : REL_LABEL[r.relType] ?? r.relType;
        return <li key={r.id} className={cn("min-w-0 rounded-control px-2 py-1.5 text-ui", r.status === "suggested" ? "ai-surface" : "bg-bg")} data-relation={r.id} data-status={r.status}>
          <div className="flex min-w-0 items-center gap-1.5">{out ? <ArrowRight className="size-3.5 shrink-0 text-fg-muted" /> : <ArrowLeft className="size-3.5 shrink-0 text-fg-muted" />}<span className="shrink-0 text-micro text-fg-muted">{label}</span>{other.kind === "page" ? <Link href={`/p/${other.id}`} className="min-w-0 truncate font-medium hover:underline">{other.title || "Untitled"}</Link> : <span className="min-w-0 truncate font-medium">{other.title || other.kind}</span>}{r.origin === "ai" && <AIBadge />}</div>
          {r.note && <p className="mt-0.5 text-micro leading-4 text-fg-muted [overflow-wrap:anywhere]">{r.note}</p>}
          {r.status === "suggested" && <div className="mt-1"><DecideButtons compact edge={{ id: r.id, kind: r.kind, source: r.fromId, target: r.toId } as any} /></div>}
        </li>; })}</ul> : <p className="text-ui text-fg-muted">This page has no link, relation or citation yet. Mention another page with @, or create a typed relation from the graph.</p>}
    </section>
  );
}
