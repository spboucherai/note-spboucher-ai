"use client";
/**
 * Canvas force graph (react-force-graph-2d, loaded client-side only). Custom node painting: colour by kind, radius by
 * degree, labels only above a zoom threshold (or for selected/highlighted/hovered nodes); confirmed edges solid,
 * AI-suggested edges dashed in the AI colour. Positions are cached across data refreshes so filters don't re-shuffle.
 */
import dynamic from "next/dynamic";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods, NodeObject, LinkObject } from "react-force-graph-2d";
import type { GraphData, GraphEdge, GraphNode } from "@/lib/graph/types";
import { useThemeColors, kindColor, edgeColor } from "./colors";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false, loading: () => null }) as unknown as React.ComponentType<any>;
export type FNode = NodeObject<GraphNode>; export type FLink = LinkObject<GraphNode, GraphEdge>;
export interface GraphCanvasHandle { zoomToFit: (ms?: number) => void; focus: (id: string, zoom?: number) => void; reheat: () => void }
export interface GraphCanvasProps {
  data: GraphData; selectedId?: string | null; highlight?: Set<string> | null; frozen?: boolean; compact?: boolean;
  /** zoom level above which every label is drawn */
  labelsAt?: number; className?: string;
  onSelect?: (node: GraphNode | null) => void; onHover?: (node: GraphNode | null) => void; onEdgeClick?: (edge: GraphEdge) => void;
}
const srcId = (l: FLink) => (typeof l.source === "object" ? String((l.source as FNode).id) : String(l.source));
const tgtId = (l: FLink) => (typeof l.target === "object" ? String((l.target as FNode).id) : String(l.target));
const radius = (n: GraphNode) => 2.2 + Math.min(10, Math.sqrt(n.degree || 0) * 1.4);
const short = (s: string, n = 28) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas({ data, selectedId = null, highlight = null, frozen = false, compact = false, labelsAt = 1.7, className, onSelect, onHover, onEdgeClick }, ref) {
  const colors = useThemeColors();
  const box = useRef<HTMLDivElement>(null); const fg = useRef<ForceGraphMethods<FNode, FLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hovered, setHovered] = useState<string | null>(null); const hoverRaf = useRef<number | null>(null); const hoverPending = useRef<string | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>()); const current = useRef<{ nodes: FNode[]; links: FLink[] } | null>(null);
  const fitted = useRef<string>("");

  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => { const r = e.contentRect; setSize({ w: Math.floor(r.width), h: Math.floor(r.height) }); }); ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight }); return () => ro.disconnect(); }, []);

  // Rebuild graph objects on new data, carrying over cached positions so the layout stays stable.
  const graph = useMemo(() => {
    if (current.current) for (const n of current.current.nodes) if (n.x != null && n.y != null) positions.current.set(String(n.id), { x: n.x, y: n.y });
    const nodes: FNode[] = data.nodes.map((n) => { const p = positions.current.get(n.id); return { ...n, ...(p ? { x: p.x, y: p.y } : {}) }; });
    const ids = new Set(nodes.map((n) => n.id)); const links: FLink[] = data.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e }));
    const g = { nodes, links }; current.current = g; return g;
  }, [data]);
  const dataKey = useMemo(() => `${data.center ?? ""}:${data.nodes.length}:${data.edges.length}`, [data]);

  // Neighbour set of the selected node (edges + nodes to emphasise)
  const near = useMemo(() => { const s = new Set<string>(); if (!selectedId) return s; for (const l of graph.links) { const a = srcId(l), b = tgtId(l); if (a === selectedId) s.add(b); else if (b === selectedId) s.add(a); } return s; }, [graph, selectedId]);

  useImperativeHandle(ref, () => ({
    zoomToFit: () => fit(fg.current, compact),
    focus: (id, zoom = 3) => { const n = current.current?.nodes.find((x) => x.id === id); if (n && n.x != null && n.y != null && fg.current) { fg.current.centerAt(n.x, n.y, 500); fg.current.zoom(zoom, 500); } },
    reheat: () => fg.current?.d3ReheatSimulation(),
  }), [compact]);

  // Tune forces once the engine exists (ref is assigned after the dynamic import mounts).
  const tuned = useRef(false);
  const tune = useCallback(() => { const f = fg.current; if (!f || tuned.current) return; tuned.current = true; const ch: any = f.d3Force("charge"); ch?.strength(compact ? -40 : -70); const ln: any = f.d3Force("link"); ln?.distance((l: FLink) => (l.kind === "tag" || l.kind === "attachment" ? 22 : 42)); }, [compact]);
  useEffect(() => { if (!frozen) fg.current?.d3ReheatSimulation(); }, [frozen]);

  const paintNode = useCallback((node: FNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const n = node as GraphNode & FNode; if (n.x == null || n.y == null) return;
    const r = radius(n); const sel = n.id === selectedId; const isHover = n.id === hovered; const hi = highlight?.has(n.id) ?? false;
    const dim = (highlight && highlight.size > 0 && !hi && !sel) || (selectedId && !sel && !near.has(n.id));
    ctx.globalAlpha = dim ? 0.22 : 1;
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI); ctx.fillStyle = kindColor(colors, n.kind); ctx.fill();
    if (sel || isHover || hi) { ctx.lineWidth = (sel ? 2 : 1.2) / scale; ctx.strokeStyle = sel ? colors.fg : colors.fgMuted; ctx.stroke(); }
    if (n.kind === "database" || n.kind === "research") { ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(0.8, r * 0.38), 0, 2 * Math.PI); ctx.fillStyle = colors.bgElev; ctx.fill(); }
    const showLabel = scale >= labelsAt || sel || isHover || hi || (selectedId && near.has(n.id) && scale >= labelsAt * 0.6) || (compact && scale >= 0.9);
    if (showLabel) { const fs = 11 / scale; ctx.font = `${sel ? "600 " : ""}${fs}px ${colors.font}`; ctx.textAlign = "center"; ctx.textBaseline = "top"; const label = `${n.icon ? n.icon + " " : ""}${short(n.title, compact ? 22 : 30)}`; const w = ctx.measureText(label).width; ctx.fillStyle = colors.bg; ctx.globalAlpha = dim ? 0.15 : 0.75; ctx.fillRect(n.x - w / 2 - 1.5 / scale, n.y + r + 1 / scale, w + 3 / scale, fs + 2 / scale); ctx.globalAlpha = dim ? 0.3 : 1; ctx.fillStyle = sel ? colors.fg : colors.fgMuted; ctx.fillText(label, n.x, n.y + r + 2 / scale); }
    ctx.globalAlpha = 1;
  }, [colors, selectedId, hovered, highlight, near, labelsAt, compact]);
  const paintArea = useCallback((node: FNode, color: string, ctx: CanvasRenderingContext2D) => { const n = node as GraphNode & FNode; if (n.x == null || n.y == null) return; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, radius(n) + 2.5, 0, 2 * Math.PI); ctx.fill(); }, []);
  const linkTouches = useCallback((l: FLink) => Boolean(selectedId) && (srcId(l) === selectedId || tgtId(l) === selectedId), [selectedId]);
  const linkColor = useCallback((l: FLink) => { const e = l as GraphEdge & FLink; const base = linkTouches(l) ? (e.status === "suggested" ? colors.ai : colors.accent) : edgeColor(colors, e.kind, e.status === "suggested"); return selectedId && !linkTouches(l) ? withAlpha(base, 0.25) : base; }, [colors, selectedId, linkTouches]);
  const linkWidth = useCallback((l: FLink) => { const e = l as GraphEdge & FLink; return (linkTouches(l) ? 1.8 : e.status === "suggested" ? 1.2 : e.kind === "link" || e.kind === "relation" ? 0.9 : 0.6); }, [linkTouches]);
  const linkDash = useCallback((l: FLink) => ((l as GraphEdge & FLink).status === "suggested" ? [3, 2] : null), []);
  const arrow = useCallback((l: FLink) => { const e = l as GraphEdge & FLink; return e.kind === "link" || e.kind === "relation" ? (linkTouches(l) ? 4 : 2.5) : 0; }, [linkTouches]);
  const onNodeHover = useCallback((n: FNode | null) => { const id = n ? String(n.id) : null; hoverPending.current = id; if (hoverRaf.current != null) return; hoverRaf.current = requestAnimationFrame(() => { hoverRaf.current = null; setHovered((h) => (h === hoverPending.current ? h : hoverPending.current)); onHover?.(n ? (n as GraphNode) : null); }); }, [onHover]);
  const onEngineStop = useCallback(() => { const g = current.current; if (g) for (const n of g.nodes) if (n.x != null && n.y != null) positions.current.set(String(n.id), { x: n.x, y: n.y }); if (fitted.current !== dataKey) { fitted.current = dataKey; fit(fg.current, compact); } }, [dataKey, compact]);

  return (
    <div ref={box} className={className ?? "relative h-full w-full"} style={{ touchAction: "none" }}>
      {size.w > 0 && size.h > 0 && (
        <ForceGraph2D
          ref={fg} width={size.w} height={size.h} graphData={graph} backgroundColor="rgba(0,0,0,0)"
          nodeId="id" nodeRelSize={1} nodeVal={(n: FNode) => radius(n as GraphNode) ** 2}
          nodeCanvasObject={paintNode} nodeCanvasObjectMode={() => "replace"} nodePointerAreaPaint={paintArea} nodeLabel={() => ""}
          linkColor={linkColor} linkWidth={linkWidth} linkLineDash={linkDash} linkDirectionalArrowLength={arrow} linkDirectionalArrowRelPos={1} linkCurvature={0}
          linkLabel={(l: FLink) => { const e = l as GraphEdge & FLink; return e.status === "suggested" ? `AI suggestion${e.confidence != null ? ` · ${Math.round(e.confidence * 100)}%` : ""}` : e.kind === "relation" ? `relation · ${e.sub ?? ""}` : e.kind; }}
          warmupTicks={frozen ? 0 : compact ? 40 : 80} cooldownTicks={frozen ? 0 : compact ? 120 : 200} cooldownTime={frozen ? 0 : 6000} d3AlphaDecay={0.035} d3VelocityDecay={0.35}
          autoPauseRedraw minZoom={0.15} maxZoom={12} enableNodeDrag={!frozen}
          onEngineTick={tune} onEngineStop={onEngineStop}
          onNodeClick={(n: FNode) => onSelect?.(n as GraphNode)} onBackgroundClick={() => onSelect?.(null)} onNodeHover={onNodeHover}
          onLinkClick={(l: FLink) => onEdgeClick?.(l as GraphEdge)}
          onNodeDragEnd={(n: FNode) => { if (frozen) { n.fx = n.x; n.fy = n.y; } }}
        />
      )}
    </div>
  );
});
/** Fit all nodes, but never zoom past 3.5× (tiny graphs would otherwise fill the screen with two blobs). */
function fit(f: ForceGraphMethods<FNode, FLink> | undefined, compact: boolean) { if (!f) return; f.zoomToFit(0, compact ? 24 : 48); const z = f.zoom(); if (z > 3.5) { const c = f.centerAt(); f.zoom(compact ? 2.5 : 3.5, 300); f.centerAt(c.x, c.y, 300); } }
function withAlpha(color: string, a: number) {
  if (color.startsWith("oklch(") && !color.includes("/")) return color.replace(/\)$/, ` / ${a})`);
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) { const h = color.length === 4 ? color.slice(1).split("").map((c) => c + c).join("") : color.slice(1); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; }
  return color;
}
