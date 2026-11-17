"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, Maximize2, Pause, Play, Sparkles, SlidersHorizontal, X, List, ListChecks, Share2, RotateCcw } from "lucide-react";
import { api } from "@/lib/client/api";
import { useIsPhone, useMounted } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Kbd, Skeleton, Switch, Empty } from "@/components/ui/primitives";
import { ResponsivePanel } from "@/components/database/Responsive";
import { NODE_KINDS, NODE_KIND_LABELS, type GraphData, type GraphNode, type NodeKind, type Suggestion } from "@/lib/graph/types";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import { Inspector } from "./Inspector";
import { SuggestButton, SuggestionList, useSuggest } from "./SuggestionList";
import { BacklinksExplorer } from "./BacklinksExplorer";
import { KIND_CLASS } from "./colors";

const SECTIONS = ["notes", "documents", "databases", "projects", "research"];
const RANGES: { id: string; label: string; days: number | null }[] = [{ id: "all", label: "All time", days: null }, { id: "7d", label: "Last 7 days", days: 7 }, { id: "30d", label: "Last 30 days", days: 30 }, { id: "90d", label: "Last 90 days", days: 90 }, { id: "365d", label: "Last year", days: 365 }];
interface Filters { types: NodeKind[]; section: string; range: string; hideOrphans: boolean; suggestions: boolean; pageId: string | null; depth: number }
const DEFAULT: Filters = { types: [...NODE_KINDS], section: "", range: "all", hideOrphans: false, suggestions: true, pageId: null, depth: 2 };
const EMPTY: GraphData = { nodes: [], edges: [], stats: { pages: 0, edges: 0, suggested: 0 } };

/**
 * /graph. Desktop: the canvas explorer. Phones: connections as lists first (BacklinksExplorer: pages, their links and
 * the AI review); the canvas is a secondary full-screen view opened with "Open full graph" (or /graph?view=canvas),
 * with a "List" button to come back. The canvas view fills the main area and has no page scroll to break.
 */
export function GraphExplorer({ focus }: { focus?: string | null }) {
  const phone = useIsPhone(); const mounted = useMounted();
  const [mode, setMode] = useState<"list" | "canvas">("list");
  useEffect(() => { if (new URLSearchParams(window.location.search).get("view") === "canvas") setMode("canvas"); }, []);
  const showCanvas = mounted && (!phone || mode === "canvas");
  const [f, setF] = useState<Filters>(() => (focus ? { ...DEFAULT, pageId: focus, depth: 2 } : DEFAULT));
  const [q, setQ] = useState(""); const [selected, setSelected] = useState<string | null>(focus ?? null); const [frozen, setFrozen] = useState(false);
  const [panel, setPanel] = useState<"inspector" | "suggestions" | null>(focus ? "inspector" : null); const [filtersOpen, setFiltersOpen] = useState(false);
  const canvas = useRef<GraphCanvasHandle>(null); const search = useRef<HTMLInputElement>(null);

  const params = useMemo(() => { const p = new URLSearchParams(); if (f.types.length !== NODE_KINDS.length) p.set("types", f.types.join(",")); if (f.section) p.set("section", f.section); const d = RANGES.find((x) => x.id === f.range)?.days; if (d) p.set("since", new Date(Date.now() - d * 864e5).toISOString()); if (f.pageId) { p.set("pageId", f.pageId); p.set("depth", String(f.depth)); } if (f.hideOrphans) p.set("hideOrphans", "1"); if (!f.suggestions) p.set("suggestions", "0"); return p.toString(); }, [f]);
  const graph = useQuery({ queryKey: ["graph", params], queryFn: () => api<GraphData>(`/api/graph${params ? `?${params}` : ""}`), placeholderData: keepPreviousData, staleTime: 10_000, enabled: showCanvas });
  const sugg = useQuery({ queryKey: ["graph-suggestions"], queryFn: () => api<{ items: Suggestion[]; counts: Record<string, number> }>("/api/graph/suggestions"), staleTime: 10_000 });
  const data = graph.data ?? EMPTY;
  const selectedNode = useMemo(() => data.nodes.find((n) => n.id === selected) ?? null, [data, selected]);
  const highlight = useMemo(() => { const s = q.trim().toLowerCase(); if (!s) return null; return new Set(data.nodes.filter((n) => n.title.toLowerCase().includes(s)).map((n) => n.id)); }, [q, data]);
  const matches = highlight?.size ?? 0;

  // Generation is explicit only (buttons below); the result toast and cache refresh live in useSuggest.
  const suggest = useSuggest((d) => { if (!d.queued && d.result?.suggested) setPanel("suggestions"); });

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
      <div className="flex flex-wrap gap-1">{NODE_KINDS.map((k) => <button key={k} type="button" aria-pressed={f.types.includes(k)} onClick={() => toggleType(k)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] max-md:h-11 max-md:px-3 max-md:text-[14px]", f.types.includes(k) ? "border-line bg-bg-elev text-fg" : "border-transparent bg-bg-sunk text-fg-faint line-through")}><span className={cn("size-2 rounded-full", KIND_CLASS[k], !f.types.includes(k) && "opacity-40")} />{NODE_KIND_LABELS[k]}</button>)}</div>
      <div className={cn("flex gap-2", vertical && "flex-wrap")}>
        <select aria-label="Section" value={f.section} onChange={(e) => setF((s) => ({ ...s, section: e.target.value }))} className="h-7 rounded-md border border-line bg-bg-elev px-2 text-[12px] max-md:h-11"><option value="">All sections</option>{SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select aria-label="Edited within" value={f.range} onChange={(e) => setF((s) => ({ ...s, range: e.target.value }))} className="h-7 rounded-md border border-line bg-bg-elev px-2 text-[12px] max-md:h-11">{RANGES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        {f.pageId && <select aria-label="Neighbourhood depth" value={f.depth} onChange={(e) => setF((s) => ({ ...s, depth: Number(e.target.value) }))} className="h-7 rounded-md border border-line bg-bg-elev px-2 text-[12px] max-md:h-11">{[1, 2, 3].map((d) => <option key={d} value={d}>depth {d}</option>)}</select>}
      </div>
      <div className={cn("flex gap-3", vertical ? "flex-col" : "items-center")}>
        <label className="flex items-center gap-1.5 text-[12px] text-fg-muted max-md:min-h-11 max-md:gap-3 max-md:text-[15px]"><Switch checked={f.hideOrphans} onCheckedChange={(v) => setF((s) => ({ ...s, hideOrphans: v }))} /> Hide orphans</label>
        <label className="flex items-center gap-1.5 text-[12px] text-fg-muted max-md:min-h-11 max-md:gap-3 max-md:text-[15px]"><Switch checked={f.suggestions} onCheckedChange={(v) => setF((s) => ({ ...s, suggestions: v }))} /> AI suggestions</label>
      </div>
    </div>
  );
  const side = panel === "inspector" && selectedNode ? <Inspector node={selectedNode} data={data} onClose={() => { setSelected(null); setPanel(null); }} onFocus={focusNode} onSuggest={(id) => suggest.mutate(id)} suggesting={suggest.isPending && suggest.variables === selectedNode.id} onNeighbourhood={(id) => setF((s) => ({ ...s, pageId: id, depth: 2 }))} />
    : panel === "suggestions" ? (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Sparkles className="size-4 text-ai" />
          <div className="flex-1 text-[14px] font-semibold">Suggested links {pendingCount ? <Badge tone="ai">{pendingCount}</Badge> : null}</div>
          <button type="button" className="grid size-8 place-items-center rounded-md text-fg-faint hover:bg-bg-sunk hover:text-fg max-md:size-11 max-md:text-fg-muted" onClick={() => setPanel(null)} aria-label="Close review panel"><X className="size-4 max-md:size-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
          <SuggestionList items={pending} loading={sugg.isLoading} error={sugg.isError ? sugg.error : null} onRetry={() => sugg.refetch()} onFocus={focusNode} />
          <SuggestButton pageId={null} compact className="rounded-lg border border-line p-2.5" />
        </div>
      </div>) : null;

  if (!mounted) return <div role="status" aria-label="Loading connections" className="mx-auto max-w-5xl space-y-3 px-4 py-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></div>;
  // Phones: lists first. The canvas is opened on demand, optionally centred on a page.
  if (phone && mode === "list") {
    return <BacklinksExplorer title="Connections" focus={focus} onOpenCanvas={(pageId) => { if (pageId) { setF((s) => ({ ...s, pageId, depth: 2 })); setSelected(pageId); setPanel(null); } setMode("canvas"); }} />;
  }
  const tb = "max-md:h-11 max-md:min-w-11 max-md:shrink-0 max-md:text-[14px]";

  return (
    <div className="absolute inset-0 flex flex-col pb-16 md:pb-0">
      <div className="flex items-center gap-2 border-b border-line bg-bg/85 px-3 py-2 backdrop-blur-md max-md:flex-col max-md:items-stretch">
        <div className="relative w-full max-w-xs max-md:max-w-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" />
          <Input ref={search} type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSearchEnter(); }} placeholder="Search to focus…" aria-label="Search a node to focus" className="h-8 pl-8 pr-14 text-[13px] max-md:h-11 max-md:pr-24 max-md:text-[16px]" />
          {q ? <span role="status" className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-fg-faint max-md:text-[12px] max-md:text-fg-muted">{matches} match{matches === 1 ? "" : "es"}</span> : <span className="absolute right-2 top-1/2 hidden -translate-y-1/2 md:block"><Kbd>/</Kbd></span>}
        </div>
        <div className="hidden min-w-0 flex-1 lg:block">{filterControls(false)}</div>
        {/* the action row scrolls inside itself on narrow screens */}
        <div className="ml-auto flex shrink-0 items-center gap-1 max-md:ml-0 max-md:min-w-0 max-md:shrink max-md:overflow-x-auto max-md:overscroll-x-contain max-md:[scrollbar-width:none]">
          {phone && <Button size="sm" variant="secondary" className={tb} onClick={() => setMode("list")}><List /> List</Button>}
          <div className="lg:hidden">
            <ResponsivePanel open={filtersOpen} onOpenChange={setFiltersOpen} title="Graph filters" description="What the graph shows." align="end" className="w-[calc(100vw-1.5rem)] max-w-sm"
              trigger={<Button size="sm" variant="outline" className={tb} aria-label="Filters"><SlidersHorizontal /> <span className="hidden sm:inline">Filters</span></Button>}>
              {filterControls(true)}
            </ResponsivePanel>
          </div>
          {f.pageId && <Button size="sm" variant="secondary" className={tb} onClick={() => setF((s) => ({ ...s, pageId: null }))} aria-label="Show the whole workspace" title="Show the whole workspace"><RotateCcw /> <span className="hidden sm:inline">Whole graph</span></Button>}
          <Button size="sm" variant="ghost" className={tb} onClick={() => canvas.current?.zoomToFit()} aria-label="Fit to view" title="Fit to view"><Maximize2 /></Button>
          <Button size="sm" variant="ghost" className={tb} onClick={() => setFrozen((v) => !v)} aria-pressed={frozen} aria-label={frozen ? "Unfreeze layout" : "Freeze layout"} title={frozen ? "Unfreeze layout" : "Freeze layout"}>{frozen ? <Play /> : <Pause />}</Button>
          <Button size="sm" variant={panel === "suggestions" ? "secondary" : "outline"} className={tb} aria-pressed={panel === "suggestions"} aria-label={`Review AI suggestions${pendingCount ? `, ${pendingCount} waiting` : ""}`} onClick={() => setPanel((p) => (p === "suggestions" ? null : "suggestions"))}><ListChecks /> <span className="max-md:inline hidden sm:inline">Review</span>{pendingCount > 0 && <Badge tone="ai" className="ml-0.5 px-1">{pendingCount}</Badge>}</Button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="graph-canvas relative min-w-0 flex-1">
          {graph.isLoading ? <div role="status" aria-label="Loading the graph" className="grid h-full place-items-center p-8"><Skeleton className="h-full max-h-80 w-full max-w-xl rounded-2xl" /></div>
            : graph.isError ? <Empty icon={<Share2 />} title="Could not load the graph" hint={(graph.error as any)?.message} action={<Button size="sm" className="max-md:h-11 max-md:px-4" onClick={() => graph.refetch()}>Retry</Button>} />
            : !data.nodes.length ? <Empty icon={<Share2 />} title="Nothing to show" hint={f.pageId || f.section || f.range !== "all" || f.hideOrphans || f.types.length !== NODE_KINDS.length ? "No node matches the current filters." : "Create pages and mention them with @ to grow your graph."} action={(f.pageId || f.section || f.range !== "all" || f.hideOrphans || f.types.length !== NODE_KINDS.length) ? <Button size="sm" variant="outline" onClick={() => setF(DEFAULT)}>Reset filters</Button> : undefined} />
            : <GraphCanvas ref={canvas} data={data} selectedId={selected} highlight={highlight} frozen={frozen} onSelect={onSelect} />}
          <div className="pointer-events-none absolute left-3 bottom-3 hidden flex-col gap-1.5 rounded-xl border border-line bg-bg-elev/90 px-3 py-2.5 text-[11px] text-fg-muted shadow-card backdrop-blur-md sm:flex">
            <div className="flex flex-wrap gap-x-3 gap-y-1">{NODE_KINDS.filter((k) => f.types.includes(k)).map((k) => <span key={k} className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-full", KIND_CLASS[k])} />{NODE_KIND_LABELS[k]}</span>)}</div>
            <div className="flex gap-3"><span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-5 border-t-2 border-line-strong" /> link / relation</span><span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-ai" /> AI suggested</span></div>
          </div>
          <div className="pointer-events-none absolute right-3 bottom-3 rounded-full border border-line bg-bg-elev/90 px-3 py-1 text-[11px] tabular-nums text-fg-muted shadow-card backdrop-blur-md">{data.nodes.length} nodes · {data.edges.length} edges{data.stats.suggested ? ` · ${data.stats.suggested} suggested` : ""}{graph.isFetching && !graph.isLoading ? " · updating…" : ""}{frozen ? " · frozen" : ""}</div>
        </div>
        {side && <aside className="hidden w-80 shrink-0 border-l border-line bg-bg-elev md:block xl:w-96">{side}</aside>}
        {side && <div className="absolute inset-x-0 bottom-0 z-20 flex max-h-[62%] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-bg-elev shadow-pop fade-up md:hidden"><div aria-hidden className="mx-auto mt-1.5 h-1 w-10 shrink-0 rounded-full bg-line-strong" /><div className="h-[58dvh] min-h-0">{side}</div></div>}
      </div>
    </div>
  );
}
