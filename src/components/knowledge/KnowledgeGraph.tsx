"use client";
/**
 * file: src/components/knowledge/KnowledgeGraph.tsx
 * description: Knowledge Graph 2.0 (`/graph`) on GET /api/graph?view= — the seven views (global, local, project, chronological,
 *   concepts, documents, references) behind one switcher; filters by relation type, origin (you / AI / derived) and status; typed
 *   relations drawn distinctly; suggested edges dashed with the AI mark and accepted / rejected inline; a typed relation created
 *   between two pages with a picker, edited (note, validity dates) or deleted; concepts management; an Insights side panel.
 *   Phones: the same canvas under a scrolling switcher, panels as bottom sheets (one scroll container, no sideways overflow).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, Maximize2, Pause, Play, SlidersHorizontal, Share2, Plus, Lightbulb, Sparkles, X, ListChecks, Crosshair } from "lucide-react";
import { api } from "@/lib/client/api";
import { useIsPhone, useMounted } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Empty, Skeleton, Switch } from "@/components/ui/primitives";
import { ResponsivePanel } from "@/components/database/Responsive";
import type { EdgeV, GraphView, GraphViewData, NodeV } from "@/lib/graph/views";
import { lodFor, DEFAULT_FILTER, EDGE_KIND_LABEL, ORIGINS, REL_LABEL, REL_TYPES, STATUSES, VIEWS, filterGraph, isDefaultFilter, shortestPath, viewQuery, type GraphFilter } from "@/lib/client/knowledge";
import { GraphCanvas2, type GraphCanvas2Handle } from "./GraphCanvas2";
import { GraphCanvasLarge } from "./GraphCanvasLarge";
import { ConceptsManager, EdgeInspector, KIND_LABEL, NodeInspector, RelationDialog, SuggestedList, type RelationDraft } from "./GraphPanels";
import { InsightsPanel } from "./InsightsPanel";
import { AIBadge, PagePicker, Segmented, useTree } from "./shared";

const EMPTY: GraphViewData = { view: "global", nodes: [], edges: [], center: null, stats: { pages: 0, references: 0, concepts: 0, edges: 0, suggested: 0 } };
const ORIGIN_LABEL: Record<string, string> = { user: "You", ai: "AI", system: "Derived" };
type Side = "inspector" | "suggested" | "insights" | null;
const isUuid = (s: string | null | undefined): s is string => Boolean(s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s));

export function KnowledgeGraph({ initial }: { initial: { view?: string | null; pageId?: string | null; panel?: string | null; create?: string | null } }) {
  const phone = useIsPhone(); const mounted = useMounted(); const { data: tree = [] } = useTree();
  const [view, setView] = React.useState<GraphView>(() => (VIEWS.some((v) => v.id === initial.view) ? (initial.view as GraphView) : isUuid(initial.pageId) ? "local" : "global"));
  const [pageId, setPageId] = React.useState<string | null>(isUuid(initial.pageId) ? initial.pageId : null); const [depth, setDepth] = React.useState(2);
  const [range, setRange] = React.useState<{ from: string; to: string }>({ from: "", to: "" }); const [hideOrphans, setHideOrphans] = React.useState(false);
  const [filter, setFilter] = React.useState<GraphFilter>(DEFAULT_FILTER); const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [q, setQ] = React.useState(""); const [selected, setSelected] = React.useState<string | null>(null); const [edgeId, setEdgeId] = React.useState<string | null>(null); const [side, setSide] = React.useState<Side>(initial.panel === "insights" || initial.panel === "suggested" ? initial.panel : null);
  const [frozen, setFrozen] = React.useState(false); const [picker, setPicker] = React.useState<"centre" | "path" | null>(null); const [pathTo, setPathTo] = React.useState<string | null>(null); const [marked, setMarked] = React.useState<{ ids: Set<string>; label: string } | null>(null);
  const [draft, setDraft] = React.useState<RelationDraft | null>(initial.create === "relation" ? { fromId: isUuid(initial.pageId) ? initial.pageId : null } : null); const [concepts, setConcepts] = React.useState(initial.panel === "concepts");
  // measurement aid: /graph?renderer=force keeps the library renderer at any size (see tests/e2e/next/perf-k.mjs)
  const [forceLib] = React.useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("renderer") === "force");
  const canvas = React.useRef<GraphCanvas2Handle>(null); const search = React.useRef<HTMLInputElement>(null);
  const def = VIEWS.find((v) => v.id === view)!; const suggestions = filter.statuses.includes("suggested");
  const qs = viewQuery({ view, pageId, depth, from: range.from ? `${range.from}T00:00:00.000Z` : null, to: range.to ? `${range.to}T23:59:59.999Z` : null, suggestions, hideOrphans });
  const graph = useQuery({ queryKey: ["kgraph", qs], enabled: mounted && qs !== null, queryFn: () => api<GraphViewData>(`/api/graph?${qs}`), placeholderData: keepPreviousData, staleTime: 10_000 });
  const raw = qs === null ? EMPTY : graph.data ?? EMPTY;
  const data = React.useMemo(() => filterGraph(raw, filter), [raw, filter]);
  const nodeMap = React.useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);
  const selectedNode = selected ? nodeMap.get(selected) ?? null : null; const selectedEdge = edgeId ? data.edges.find((e) => e.id === edgeId) ?? null : null;
  const suggestedCount = React.useMemo(() => data.edges.filter((e) => e.status === "suggested").length, [data]);
  const path = React.useMemo(() => { if (!selected || !pathTo) return null; const p = shortestPath(data.edges, selected, pathTo); return p ? { nodes: new Set(p.nodes), edges: new Set(p.edges), order: p.nodes } : { nodes: new Set<string>(), edges: new Set<string>(), order: [] as string[] }; }, [data.edges, selected, pathTo]);
  const highlight = React.useMemo(() => { const s = q.trim().toLowerCase(); if (s) return new Set(data.nodes.filter((n) => n.title.toLowerCase().includes(s)).map((n) => n.id)); return marked?.ids ?? null; }, [q, data, marked]);
  // keep the address shareable (view + centre), without a navigation
  React.useEffect(() => { if (!mounted) return; const p = new URLSearchParams(); if (view !== "global") p.set("view", view); if (def.needsPage && pageId) p.set("pageId", pageId); history.replaceState(null, "", `/graph${p.size ? `?${p}` : ""}`); }, [view, pageId, def.needsPage, mounted]);
  React.useEffect(() => { setSelected(null); setEdgeId(null); setPathTo(null); setMarked(null); }, [qs]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable); if (document.querySelector("[role=dialog][data-state=open]")) return;
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); search.current?.focus(); } else if (e.key === "Escape") { if (typing && t === search.current) { setQ(""); search.current?.blur(); } else { setSelected(null); setEdgeId(null); setPathTo(null); setMarked(null); setSide((s) => (s === "inspector" ? null : s)); } } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const focusNode = React.useCallback((id: string) => { setSelected(id); setEdgeId(null); setSide("inspector"); canvas.current?.focus(id, 2.5); }, []);
  // a node asked for before its view has loaded (e.g. "Show in graph" from the concepts manager) is selected as soon as it is there
  const [pending, setPending] = React.useState<string | null>(null);
  React.useEffect(() => { if (!pending || !nodeMap.has(pending)) return; const id = pending; const t = setTimeout(() => { focusNode(id); setPending(null); }, 700); return () => clearTimeout(t); }, [pending, nodeMap, focusNode]);
  const focusPage = React.useCallback((id: string) => { if (nodeMap.has(id)) focusNode(id); else { setView("local"); setPageId(id); } }, [nodeMap, focusNode]);
  const onSelect = React.useCallback((n: NodeV | null) => { setEdgeId(null); setSelected(n?.id ?? null); if (n) setSide("inspector"); else setSide((s) => (s === "inspector" ? null : s)); }, []);
  const onEdge = React.useCallback((e: EdgeV) => { setEdgeId(e.id); setSide("inspector"); }, []);
  const chooseView = (v: GraphView) => { const d = VIEWS.find((x) => x.id === v)!; setView(v); if (d.needsPage && !pageId) setPicker("centre"); };
  const centre = pageId ? tree.find((t) => t.id === pageId) : null; const filtered = !isDefaultFilter(filter) || hideOrphans;
  const toggle = (key: "origins" | "statuses", v: string) => setFilter((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }));
  const toggleRel = (r: string) => setFilter((f) => { const cur = f.relTypes ?? [...REL_TYPES]; const next = cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]; return { ...f, relTypes: next.length === REL_TYPES.length ? null : next }; });
  const kindsInView = React.useMemo(() => [...new Set(raw.edges.map((e) => e.kind))], [raw]);
  const toggleKind = (k: string) => setFilter((f) => { const cur = f.kinds ?? kindsInView; const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]; return { ...f, kinds: next.length >= kindsInView.length ? null : next }; });
  const chip = (on: boolean) => cn("inline-flex h-7 items-center gap-1.5 rounded-control border px-2 text-micro font-medium max-md:h-11 max-md:px-3 max-md:text-[14px]", on ? "border-line bg-bg-elev text-fg" : "border-transparent bg-bg-sunk text-fg-muted line-through");
  const filterBody = (
    <div className="grid gap-3" data-testid="graph-filters">
      <fieldset><legend className="mb-1 text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">Relation types</legend><div className="flex flex-wrap gap-1">{REL_TYPES.map((r) => <button key={r} type="button" aria-pressed={!filter.relTypes || filter.relTypes.includes(r)} data-rel={r} onClick={() => toggleRel(r)} className={chip(!filter.relTypes || filter.relTypes.includes(r))}>{REL_LABEL[r]}</button>)}</div>
        <div className="mt-1 flex gap-2 text-micro"><button type="button" className="font-medium text-accent hover:underline max-md:min-h-11" onClick={() => setFilter((f) => ({ ...f, relTypes: null }))}>All</button><button type="button" className="font-medium text-accent hover:underline max-md:min-h-11" onClick={() => setFilter((f) => ({ ...f, relTypes: [] }))}>None</button></div></fieldset>
      <fieldset><legend className="mb-1 text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">Origin</legend><div className="flex flex-wrap gap-1">{ORIGINS.map((o) => <button key={o} type="button" aria-pressed={filter.origins.includes(o)} data-origin={o} onClick={() => toggle("origins", o)} className={chip(filter.origins.includes(o))}>{o === "ai" ? <AIBadge /> : ORIGIN_LABEL[o]}</button>)}</div></fieldset>
      <fieldset><legend className="mb-1 text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">Status</legend><div className="flex flex-wrap gap-1">{STATUSES.map((s) => <button key={s} type="button" aria-pressed={filter.statuses.includes(s)} data-status={s} onClick={() => toggle("statuses", s)} className={chip(filter.statuses.includes(s))}>{s === "accepted" ? "Accepted" : "Suggested"}</button>)}</div></fieldset>
      {kindsInView.length > 1 && <fieldset><legend className="mb-1 text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">Edge families</legend><div className="flex flex-wrap gap-1">{kindsInView.map((k) => <button key={k} type="button" aria-pressed={!filter.kinds || filter.kinds.includes(k)} onClick={() => toggleKind(k)} className={chip(!filter.kinds || filter.kinds.includes(k))}>{EDGE_KIND_LABEL[k] ?? k}</button>)}</div></fieldset>}
      <label className="flex min-h-11 items-center gap-2 text-ui text-fg-muted sm:min-h-8"><Switch checked={hideOrphans} onCheckedChange={setHideOrphans} /> Hide nodes without an edge</label>
      {filtered && <div><Button size="sm" variant="outline" className="max-md:h-11" onClick={() => { setFilter(DEFAULT_FILTER); setHideOrphans(false); }}>Reset filters</Button></div>}
    </div>
  );
  const sideBody = side === "insights" ? <InsightsPanel onFocus={focusPage} onPages={(ids, label) => { setQ(""); setMarked({ ids: new Set(ids), label }); if (phone) setSide(null); }} />
    : side === "suggested" ? <div className="flex h-full min-h-0 flex-col"><div className="flex items-center gap-2 border-b border-line px-3 py-2.5"><Sparkles className="size-4 text-ai" /><div className="flex-1 text-[15px] font-semibold">Suggestions to review</div><button type="button" onClick={() => setSide(null)} aria-label="Close" className="icon-btn max-md:size-11"><X /></button></div><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><SuggestedList edges={data.edges} nodes={nodeMap} onFocus={focusNode} onEdge={onEdge} /></div></div>
    : side === "inspector" && selectedEdge ? <EdgeInspector edge={selectedEdge} nodes={nodeMap} onClose={() => { setEdgeId(null); if (!selected) setSide(null); }} onFocus={focusNode} onEdit={(e) => setDraft({ id: e.id, fromId: nodeMap.get(e.source)?.entityId, toId: nodeMap.get(e.target)?.entityId, relType: e.relType, note: e.note, validFrom: e.validFrom, validTo: e.validTo })} />
    : side === "inspector" && selectedNode ? <NodeInspector node={selectedNode} nodes={nodeMap} edges={data.edges} pathTo={pathTo} onClose={() => { setSelected(null); setPathTo(null); setSide(null); }} onFocus={focusNode} onEdge={onEdge} onLocal={(id) => { setView("local"); setPageId(id); }} onRelate={(id) => setDraft({ fromId: id })} onPath={() => (pathTo ? setPathTo(null) : setPicker("path"))} />
    : null;
  const tb = "max-md:h-11 max-md:min-w-11 max-md:shrink-0";
  if (!mounted) return <div role="status" aria-label="Loading the graph" className="mx-auto max-w-5xl space-y-3 px-4 py-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 rounded-xl" /></div>;
  return (
    <div className="absolute inset-0 flex flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0" data-testid="knowledge-graph" data-view={view}>
      <div className="flex flex-col gap-2 border-b border-line bg-bg/85 px-3 py-2 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2">
          <Segmented label="Graph view" value={view} onChange={chooseView} className="min-w-0" options={VIEWS.map((v) => ({ id: v.id, label: v.label, title: v.hint, testId: `view-${v.id}` }))} />
          <div className="ml-auto hidden shrink-0 items-center gap-1 md:flex">
            <Button size="sm" variant="outline" onClick={() => setDraft({ fromId: selectedNode && selectedNode.kind !== "reference" && selectedNode.kind !== "concept" && selectedNode.kind !== "attachment" ? selectedNode.entityId : null })} data-testid="new-relation"><Plus /> Relation</Button>
            <Button size="sm" variant="outline" onClick={() => setConcepts(true)} data-testid="open-concepts"><Lightbulb /> Concepts</Button>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 max-md:overflow-x-auto max-md:overscroll-x-contain max-md:[scrollbar-width:none]">
          <div className="relative w-56 shrink-0 max-md:w-44"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" /><input ref={search} type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && highlight?.size) { const first = data.nodes.find((n) => highlight.has(n.id)); if (first) focusNode(first.id); } }} placeholder="Find a node…" aria-label="Find a node" className="h-8 w-full rounded-control border border-line bg-bg-elev pl-8 pr-2 text-ui outline-none focus:border-accent/60 max-md:h-11 max-md:text-[16px]" /></div>
          {def.needsPage && <Button size="sm" variant="outline" className={cn(tb, "max-w-[16rem]")} onClick={() => setPicker("centre")} data-testid="graph-centre"><Crosshair /><span className="truncate">{centre ? centre.title || "Untitled" : view === "project" ? "Choose a project…" : "Choose a page…"}</span></Button>}
          {view === "local" && <select aria-label="Neighbourhood depth" value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="h-8 shrink-0 rounded-control border border-line bg-bg-elev px-2 text-ui max-md:h-11">{[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d} hop{d > 1 ? "s" : ""}</option>)}</select>}
          {view === "timeline" && <><input type="date" aria-label="From" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="h-8 shrink-0 rounded-control border border-line bg-bg-elev px-2 text-ui max-md:h-11" /><input type="date" aria-label="To" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="h-8 shrink-0 rounded-control border border-line bg-bg-elev px-2 text-ui max-md:h-11" /></>}
          <ResponsivePanel open={filtersOpen} onOpenChange={setFiltersOpen} title="Graph filters" description="Relation types, origin and status of what the graph shows." align="start" className="w-[26rem] max-w-[calc(100vw-1.5rem)]"
            trigger={<Button size="sm" variant={filtered ? "secondary" : "outline"} className={tb} aria-label="Filters" data-testid="graph-filters-btn"><SlidersHorizontal /> <span className="max-sm:hidden">Filters</span>{filtered && <Badge tone="accent" className="ml-0.5 px-1">on</Badge>}</Button>}>{filterBody}</ResponsivePanel>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" className={cn(tb, "md:hidden")} aria-label="New relation" onClick={() => setDraft({})}><Plus /></Button>
            <Button size="sm" variant="ghost" className={cn(tb, "md:hidden")} aria-label="Concepts" onClick={() => setConcepts(true)}><Lightbulb /></Button>
            <Button size="sm" variant="ghost" className={tb} onClick={() => canvas.current?.zoomToFit()} aria-label="Fit to view" title="Fit to view"><Maximize2 /></Button>
            <Button size="sm" variant="ghost" className={tb} onClick={() => setFrozen((v) => !v)} aria-pressed={frozen} aria-label={frozen ? "Unfreeze layout" : "Freeze layout"} title={frozen ? "Unfreeze layout" : "Freeze layout"}>{frozen ? <Play /> : <Pause />}</Button>
            <Button size="sm" variant={side === "suggested" ? "secondary" : "outline"} className={tb} aria-pressed={side === "suggested"} aria-label={`Suggestions to review${suggestedCount ? `, ${suggestedCount} waiting` : ""}`} onClick={() => setSide((s) => (s === "suggested" ? null : "suggested"))} data-testid="open-suggested"><ListChecks /> <span className="max-sm:hidden">Review</span>{suggestedCount > 0 && <Badge tone="ai" className="ml-0.5 px-1">{suggestedCount}</Badge>}</Button>
            <Button size="sm" variant={side === "insights" ? "secondary" : "outline"} className={tb} aria-pressed={side === "insights"} onClick={() => setSide((s) => (s === "insights" ? null : "insights"))} data-testid="open-insights"><Sparkles /> <span className="max-sm:hidden">Insights</span></Button>
          </div>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="graph-canvas relative min-w-0 flex-1">
          {qs === null ? <Empty icon={<Crosshair />} title={view === "project" ? "Choose a project" : "Choose a page"} hint={`The ${def.label.toLowerCase()} view shows ${def.hint.toLowerCase()}.`} action={<Button size="sm" className="max-md:h-11" onClick={() => setPicker("centre")}>Choose…</Button>} />
            : graph.isLoading ? <div role="status" aria-label="Loading the graph" className="grid h-full place-items-center p-8"><Skeleton className="h-full max-h-80 w-full max-w-xl rounded-2xl" /></div>
            : graph.isError ? <Empty icon={<Share2 />} title="Could not load the graph" hint={(graph.error as any)?.message} action={<Button size="sm" className="max-md:h-11" onClick={() => graph.refetch()}>Retry</Button>} />
            : !data.nodes.length ? <Empty icon={<Share2 />} title="Nothing to show" hint={filtered ? "No node matches the current filters." : view === "concepts" ? "No concept yet. Create one with “Concepts”, or let the AI analysis suggest some." : view === "references" ? "No reference is attached to or cited by a page yet." : view === "documents" ? "The Documents section is empty." : view === "timeline" ? "Nothing was created or changed in this period." : "Create pages and mention them with @ to grow your graph."} action={filtered ? <Button size="sm" variant="outline" onClick={() => { setFilter(DEFAULT_FILTER); setHideOrphans(false); }}>Reset filters</Button> : undefined} />
            : React.createElement(lodFor(data.nodes.length, data.edges.length).decorations || forceLib ? GraphCanvas2 : GraphCanvasLarge, { ref: canvas, nodes: data.nodes, edges: data.edges, dataKey: `${qs}:${data.nodes.length}`, selectedId: selected, selectedEdgeId: edgeId, highlight, path: path && path.edges.size ? path : null, frozen, onSelect, onEdge })}
          {view === "timeline" && raw.buckets && raw.buckets.length > 0 && <Buckets buckets={raw.buckets} />}
          {marked && !q && <div role="status" className="absolute left-1/2 top-3 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-pill border border-line bg-bg-elev px-3 py-1 text-micro shadow-card"><span className="truncate">Highlighted: {marked.label} · {marked.ids.size} pages</span><button type="button" aria-label="Clear highlight" className="grid size-6 place-items-center rounded-full hover:bg-bg-hover" onClick={() => setMarked(null)}><X className="size-3.5" /></button></div>}
          {path && pathTo && <div role="status" data-testid="graph-path" className="absolute left-1/2 top-3 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-pill border border-line bg-bg-elev px-3 py-1 text-micro shadow-card"><span className="lumen-dot shrink-0" /><span className="truncate">{path.edges.size ? `Path · ${path.order.map((id) => nodeMap.get(id)?.title ?? "?").join(" → ")}` : "No path between these two nodes in this view"}</span><button type="button" aria-label="Clear path" className="grid size-6 place-items-center rounded-full hover:bg-bg-hover" onClick={() => setPathTo(null)}><X className="size-3.5" /></button></div>}
          <Legend />
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-pill border border-line bg-bg-elev/90 px-3 py-1 text-micro tabular-nums text-fg-muted shadow-card backdrop-blur-md" data-testid="graph-stats">{data.nodes.length} nodes · {data.edges.length} edges{suggestedCount ? ` · ${suggestedCount} suggested` : ""}{graph.isFetching && !graph.isLoading ? " · updating…" : ""}{frozen ? " · frozen" : ""}</div>
          {/* the canvas is a picture: the same content is reachable as a list for keyboard and screen-reader users */}
          <details className="absolute left-3 top-3 max-w-[min(20rem,calc(100%-1.5rem))] rounded-control border border-line bg-bg-elev/95 text-ui shadow-card max-md:hidden"><summary className="cursor-pointer px-2.5 py-1 text-micro font-medium text-fg-muted">List of nodes</summary><ul className="max-h-64 overflow-y-auto p-1" data-testid="graph-node-list">{data.nodes.slice(0, 200).map((n) => <li key={n.id}><button type="button" data-node={n.id} onClick={() => focusNode(n.id)} className="flex h-7 w-full items-center gap-2 rounded-chip px-2 text-left hover:bg-bg-hover"><span className="min-w-0 flex-1 truncate">{n.icon ? `${n.icon} ` : ""}{n.title}</span><span className="shrink-0 text-micro text-fg-muted">{KIND_LABEL[n.kind]} · {n.degree}</span></button></li>)}{data.nodes.length > 200 && <li className="px-2 py-1 text-micro text-fg-muted">First 200 of {data.nodes.length} — use the search box for the others.</li>}</ul></details>
        </div>
        {sideBody && !phone && <aside aria-label="Graph panel" className="panel-in-right w-80 shrink-0 border-l border-line bg-bg-elev xl:w-96">{sideBody}</aside>}
        {sideBody && phone && <div role="region" aria-label="Graph panel" className="panel-in-bottom absolute inset-x-0 bottom-0 z-20 flex max-h-[70%] flex-col overflow-hidden rounded-t-sheet border-t border-line bg-bg-elev shadow-pop"><div aria-hidden className="mx-auto mt-1.5 h-1 w-10 shrink-0 rounded-full bg-line-strong" /><div className="h-[62dvh] min-h-0">{sideBody}</div></div>}
      </div>
      <PagePicker open={picker !== null} onOpenChange={(o) => { if (!o) setPicker(null); }} title={picker === "path" ? "Find a path to…" : view === "project" ? "Project to show" : "Centre of the graph"} description={picker === "path" ? "Only pages shown in this view can be reached." : view === "project" ? "A project is a page and all its sub-pages." : undefined} current={picker === "path" ? pathTo : pageId}
        filter={picker === "path" ? (n) => nodeMap.has(n.id) && n.id !== selected : undefined} onPick={(n) => { if (picker === "path") setPathTo(n.id); else setPageId(n.id); }} />
      <RelationDialog draft={draft} onClose={() => setDraft(null)} />
      <ConceptsManager open={concepts} onOpenChange={setConcepts} onShow={(id) => { setView("concepts"); setPending(`concept:${id}`); }} />
    </div>
  );
}
function Legend() {
  const line = (cls: string, label: string, ai?: boolean) => <span className="inline-flex items-center gap-1"><span className={cn("inline-block h-0 w-5 border-t-2", cls)} />{label}{ai && <AIBadge />}</span>;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 hidden max-w-[32rem] flex-col gap-1.5 rounded-card border border-line bg-bg-elev/90 px-3 py-2.5 text-micro text-fg-muted shadow-card backdrop-blur-md sm:flex" data-testid="graph-legend">
      <div className="flex flex-wrap gap-x-3 gap-y-1"><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-accent" />Page</span><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-success" />Database</span><span className="inline-flex items-center gap-1"><span className="size-2 bg-warning" />Reference</span><span className="inline-flex items-center gap-1"><span className="size-2 rotate-45 bg-fg" />Concept</span></div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">{line("border-line-strong", "link")}{line("border-accent", "typed relation")}{line("border-success", "supports")}{line("border-danger", "contradicts")}{line("border-dashed border-ai", "suggested", true)}{line("border-dotted border-line-strong", "citation")}<span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-5 bg-lumen" />selected path</span></div>
    </div>
  );
}
function Buckets({ buckets }: { buckets: { date: string; created: number; updated: number; edges: number }[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.created + b.updated + b.edges));
  return <div className="pointer-events-none absolute inset-x-3 top-3 flex h-10 items-end md:left-40 gap-px rounded-control border border-line bg-bg-elev/90 px-2 py-1 shadow-card" aria-label="Activity per day" role="img" data-testid="graph-buckets">{buckets.map((b) => <span key={b.date} title={`${b.date}: ${b.created} created, ${b.updated} modified, ${b.edges} edges`} className="min-w-px flex-1 rounded-t-[1px] bg-accent/70" style={{ height: `${Math.max(6, ((b.created + b.updated + b.edges) / max) * 100)}%` }} />)}</div>;
}
