"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Maximize2, Pause, Play, Sparkles, SlidersHorizontal, X, ListChecks, Share2, RotateCcw } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Kbd, Popover, PopoverContent, PopoverTrigger, Spinner, Switch, Empty } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { NODE_KINDS, NODE_KIND_LABELS, type GraphData, type GraphNode, type NodeKind, type Suggestion } from "@/lib/graph/types";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import { Inspector } from "./Inspector";
import { SuggestionList } from "./SuggestionList";
import { KIND_CLASS } from "./colors";

const SECTIONS = ["notes", "documents", "databases", "projects", "research"];
const RANGES: { id: string; label: string; days: number | null }[] = [{ id: "all", label: "All time", days: null }, { id: "7d", label: "Last 7 days", days: 7 }, { id: "30d", label: "Last 30 days", days: 30 }, { id: "90d", label: "Last 90 days", days: 90 }, { id: "365d", label: "Last year", days: 365 }];
interface Filters { types: NodeKind[]; section: string; range: string; hideOrphans: boolean; suggestions: boolean; pageId: string | null; depth: number }
const DEFAULT: Filters = { types: [...NODE_KINDS], section: "", range: "all", hideOrphans: false, suggestions: true, pageId: null, depth: 2 };
const EMPTY: GraphData = { nodes: [], edges: [], stats: { pages: 0, edges: 0, suggested: 0 } };

export function GraphExplorer({ focus }: { focus?: string | null }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Filters>(() => (focus ? { ...DEFAULT, pageId: focus, depth: 2 } : DEFAULT));
  const [q, setQ] = useState(""); const [selected, setSelected] = useState<string | null>(focus ?? null); const [frozen, setFrozen] = useState(false);
  const [panel, setPanel] = useState<"inspector" | "suggestions" | null>(focus ? "inspector" : null); const [filtersOpen, setFiltersOpen] = useState(false);
  const canvas = useRef<GraphCanvasHandle>(null); const search = useRef<HTMLInputElement>(null);

  const params = useMemo(() => { const p = new URLSearchParams(); if (f.types.length !== NODE_KINDS.length) p.set("types", f.types.join(",")); if (f.section) p.set("section", f.section); const d = RANGES.find((x) => x.id === f.range)?.days; if (d) p.set("since", new Date(Date.now() - d * 864e5).toISOString()); if (f.pageId) { p.set("pageId", f.pageId); p.set("depth", String(f.depth)); } if (f.hideOrphans) p.set("hideOrphans", "1"); if (!f.suggestions) p.set("suggestions", "0"); return p.toString(); }, [f]);
  const graph = useQuery({ queryKey: ["graph", params], queryFn: () => api<GraphData>(`/api/graph${params ? `?${params}` : ""}`), placeholderData: keepPreviousData, staleTime: 10_000 });
  const sugg = useQuery({ queryKey: ["graph-suggestions"], queryFn: () => api<{ items: Suggestion[]; counts: Record<string, number> }>("/api/graph/suggestions"), staleTime: 10_000 });
  const data = graph.data ?? EMPTY;
  const selectedNode = useMemo(() => data.nodes.find((n) => n.id === selected) ?? null, [data, selected]);
  const highlight = useMemo(() => { const s = q.trim().toLowerCase(); if (!s) return null; return new Set(data.nodes.filter((n) => n.title.toLowerCase().includes(s)).map((n) => n.id)); }, [q, data]);
  const matches = highlight?.size ?? 0;

  const suggest = useMutation({
    mutationFn: (pageId: string | null) => api<{ queued: boolean; result?: { candidates: number; suggested: number; declined: number; skipped?: string } }>("/api/graph/suggestions", { method: "POST", json: { action: "suggest", pageId, inline: Boolean(pageId) } }),
    onSuccess: (d, pageId) => { if (d.queued) toast("Workspace pass queued", { description: "The worker is scanning every embedded page; suggestions will appear here as they are found.", tone: "ai" }); else { const x = d.result!; toast(x.suggested ? `${x.suggested} new suggestion${x.suggested > 1 ? "s" : ""}` : "No new suggestion", { description: x.skipped ? (x.skipped === "no candidates" ? "No similar unlinked page (or the page is not embedded yet)." : x.skipped) : `${x.candidates} candidate${x.candidates === 1 ? "" : "s"} checked, ${x.declined} declined by the model.`, tone: "ai" }); if (x.suggested) setPanel("suggestions"); } qc.invalidateQueries({ queryKey: ["graph"] }); qc.invalidateQueries({ queryKey: ["graph-suggestions"] }); void pageId; },
    onError: (e: any) => toast("Suggestion failed", { description: e.message, tone: "danger" }),
  });

  const focusNode = useCallback((id: string) => { setSelected(id); setPanel("inspector"); canvas.current?.focus(id, 2.5); }, []);
  const onSelect = useCallback((n: GraphNode | null) => { setSelected(n?.id ?? null); if (n) setPanel("inspector"); else if (panel === "inspector") setPanel(null); }, [panel]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable); if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); search.current?.focus(); } else if (e.key === "Escape") { if (typing && t === search.current) { setQ(""); search.current?.blur(); } else { setSelected(null); setPanel(null); setFiltersOpen(false); } } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const onSearchEnter = () => { if (!highlight?.size) return; const first = data.nodes.find((n) => highlight.has(n.id)); if (first) focusNode(first.id); };
  const toggleType = (k: NodeKind) => setF((s) => ({ ...s, types: s.types.includes(k) ? s.types.filter((x) => x !== k) : [...s.types, k] }));
  const pending = sugg.data?.items ?? []; const pendingCount = sugg.data?.counts?.suggested ?? pending.length;
  const filterControls = (vertical?: boolean) => (
    <div className={cn("flex gap-2", vertical ? "flex-col" : "flex-wrap items-center")}>
      <div className="flex flex-wrap gap-1">{NODE_KINDS.map((k) => <button key={k} onClick={() => toggleType(k)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px]", f.types.includes(k) ? "border-line bg-bg-elev text-fg" : "border-transparent bg-bg-sunk text-fg-faint line-through")}><span className={cn("size-2 rounded-full", KIND_CLASS[k], !f.types.includes(k) && "opacity-40")} />{NODE_KIND_LABELS[k]}</button>)}</div>
      <div className={cn("flex gap-2", vertical && "flex-wrap")}>
        <select value={f.section} onChange={(e) => setF((s) => ({ ...s, section: e.target.value }))} className="h-7 rounded-md border border-line bg-bg-elev px-2 text-[12px]"><option value="">All sections</option>{SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={f.range} onChange={(e) => setF((s) => ({ ...s, range: e.target.value }))} className="h-7 rounded-md border border-line bg-bg-elev px-2 text-[12px]">{RANGES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        {f.pageId && <select value={f.depth} onChange={(e) => setF((s) => ({ ...s, depth: Number(e.target.value) }))} className="h-7 rounded-md border border-line bg-bg-elev px-2 text-[12px]">{[1, 2, 3].map((d) => <option key={d} value={d}>depth {d}</option>)}</select>}
      </div>
      <div className={cn("flex gap-3", vertical ? "flex-col" : "items-center")}>
        <label className="flex items-center gap-1.5 text-[12px] text-fg-muted"><Switch checked={f.hideOrphans} onCheckedChange={(v) => setF((s) => ({ ...s, hideOrphans: v }))} /> Hide orphans</label>
        <label className="flex items-center gap-1.5 text-[12px] text-fg-muted"><Switch checked={f.suggestions} onCheckedChange={(v) => setF((s) => ({ ...s, suggestions: v }))} /> AI suggestions</label>
      </div>
    </div>
  );
  const side = panel === "inspector" && selectedNode ? <Inspector node={selectedNode} data={data} onClose={() => { setSelected(null); setPanel(null); }} onFocus={focusNode} onSuggest={(id) => suggest.mutate(id)} suggesting={suggest.isPending && suggest.variables === selectedNode.id} onNeighbourhood={(id) => setF((s) => ({ ...s, pageId: id, depth: 2 }))} />
    : panel === "suggestions" ? (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5"><Sparkles className="size-4 text-ai" /><div className="flex-1 text-[14px] font-semibold">Suggested links {pendingCount ? <Badge tone="ai">{pendingCount}</Badge> : null}</div><Button size="xs" variant="ai" disabled={suggest.isPending} onClick={() => suggest.mutate(null)} title="Scan every embedded page in the background">{suggest.isPending && suggest.variables === null ? <Spinner className="size-3 border-t-white" /> : <Sparkles />} Whole workspace</Button><button className="grid size-8 place-items-center rounded-md text-fg-faint hover:bg-bg-sunk hover:text-fg" onClick={() => setPanel(null)} aria-label="Close"><X className="size-4" /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3"><SuggestionList items={pending} loading={sugg.isLoading} onFocus={focusNode} /></div>
      </div>) : null;

  return (
    <div className="absolute inset-0 flex flex-col pb-16 md:pb-0">
      <div className="flex items-center gap-2 border-b border-line bg-bg-elev/80 px-3 py-2 backdrop-blur">
        <div className="relative w-full max-w-xs"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" /><Input ref={search} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSearchEnter(); }} placeholder="Search to focus…" className="h-8 pl-8 pr-14 text-[13px]" />{q ? <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-fg-faint">{matches} match{matches === 1 ? "" : "es"}</span> : <span className="absolute right-2 top-1/2 hidden -translate-y-1/2 md:block"><Kbd>/</Kbd></span>}</div>
        <div className="hidden min-w-0 flex-1 lg:block">{filterControls(false)}</div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}><PopoverTrigger asChild><Button size="sm" variant="outline" className="lg:hidden"><SlidersHorizontal /> <span className="hidden sm:inline">Filters</span></Button></PopoverTrigger><PopoverContent align="end" className="w-[calc(100vw-1.5rem)] max-w-sm">{filterControls(true)}</PopoverContent></Popover>
          {f.pageId && <Button size="sm" variant="secondary" onClick={() => setF((s) => ({ ...s, pageId: null }))} title="Show the whole workspace"><RotateCcw /> <span className="hidden sm:inline">Whole graph</span></Button>}
          <Button size="sm" variant="ghost" onClick={() => canvas.current?.zoomToFit()} title="Fit to view"><Maximize2 /></Button>
          <Button size="sm" variant="ghost" onClick={() => setFrozen((v) => !v)} title={frozen ? "Unfreeze layout" : "Freeze layout"}>{frozen ? <Play /> : <Pause />}</Button>
          <Button size="sm" variant={panel === "suggestions" ? "secondary" : "outline"} onClick={() => setPanel((p) => (p === "suggestions" ? null : "suggestions"))}><ListChecks /> <span className="hidden sm:inline">Review</span>{pendingCount > 0 && <Badge tone="ai" className="ml-0.5 px-1">{pendingCount}</Badge>}</Button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {graph.isLoading ? <div className="grid h-full place-items-center"><Spinner /></div>
            : graph.isError ? <Empty icon={<Share2 />} title="Could not load the graph" hint={(graph.error as any)?.message} action={<Button size="sm" onClick={() => graph.refetch()}>Retry</Button>} />
            : !data.nodes.length ? <Empty icon={<Share2 />} title="Nothing to show" hint={f.pageId || f.section || f.range !== "all" || f.hideOrphans || f.types.length !== NODE_KINDS.length ? "No node matches the current filters." : "Create pages and mention them with @ to grow your graph."} action={(f.pageId || f.section || f.range !== "all" || f.hideOrphans || f.types.length !== NODE_KINDS.length) ? <Button size="sm" variant="outline" onClick={() => setF(DEFAULT)}>Reset filters</Button> : undefined} />
            : <GraphCanvas ref={canvas} data={data} selectedId={selected} highlight={highlight} frozen={frozen} onSelect={onSelect} />}
          <div className="pointer-events-none absolute left-3 bottom-3 hidden flex-col gap-1 rounded-lg border border-line bg-bg-elev/90 p-2 text-[11px] text-fg-muted backdrop-blur sm:flex">
            <div className="flex flex-wrap gap-x-3 gap-y-1">{NODE_KINDS.filter((k) => f.types.includes(k)).map((k) => <span key={k} className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-full", KIND_CLASS[k])} />{NODE_KIND_LABELS[k]}</span>)}</div>
            <div className="flex gap-3"><span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-5 border-t-2 border-line-strong" /> link / relation</span><span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-ai" /> AI suggested</span></div>
          </div>
          <div className="pointer-events-none absolute right-3 bottom-3 rounded-md bg-bg-elev/90 px-2 py-1 text-[11px] text-fg-muted backdrop-blur">{data.nodes.length} nodes · {data.edges.length} edges{data.stats.suggested ? ` · ${data.stats.suggested} suggested` : ""}{graph.isFetching && !graph.isLoading ? " · updating…" : ""}{frozen ? " · frozen" : ""}</div>
        </div>
        {side && <aside className="hidden w-80 shrink-0 border-l border-line bg-bg-elev md:block xl:w-96">{side}</aside>}
        {side && <div className="absolute inset-x-0 bottom-0 z-20 max-h-[62%] overflow-hidden rounded-t-2xl border-t border-line bg-bg-elev shadow-pop fade-up md:hidden"><div className="mx-auto mt-1.5 h-1 w-10 rounded-full bg-line-strong" /><div className="h-[calc(62vh-1rem)] max-h-[60vh]">{side}</div></div>}
      </div>
    </div>
  );
}
