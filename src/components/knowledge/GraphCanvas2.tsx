"use client";
/**
 * file: src/components/knowledge/GraphCanvas2.tsx
 * description: canvas of the Knowledge Graph 2.0 for small and medium graphs. Same renderer as 2.x (react-force-graph-2d),
 *   extended for the graph 2.0 shapes: pages, databases, canvases,
 *   references (squares), concepts (diamonds), attachments; typed relations coloured by meaning, suggested edges dashed in the AI
 *   colour with an "AI" badge, citations dotted. Signature motion 3 « Knowledge Connections »: on a small graph the edges draw
 *   themselves when a view opens; on any graph the edges of the selected node / path draw themselves with the Lumen gradient.
 *   Reduce Motion: nothing is animated, the same end state is painted at once. Used up to 1 500 nodes / 6 000 edges (`lodFor`);
 *   above that this renderer was measured at 2–6 frames per second, so GraphCanvasLarge (batched canvas) takes over.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import dynamic from "next/dynamic";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods, NodeObject, LinkObject } from "react-force-graph-2d";
import type { EdgeV, NodeV } from "@/lib/graph/views";
import { drawInDuration, drawProgress, edgeStyle, lodFor, type Tone } from "@/lib/client/knowledge";
import { useReducedMotion, DUR } from "@/lib/client/motion";
import { useThemeColors, type ThemeColors } from "@/components/graph/colors";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false, loading: () => null }) as unknown as React.ComponentType<any>;
type FNode = NodeObject<NodeV>; type FLink = LinkObject<NodeV, EdgeV> & { __i?: number };
export interface GraphCanvas2Handle { zoomToFit: () => void; focus: (id: string, zoom?: number) => void; reheat: () => void }
export interface GraphCanvas2Props {
  nodes: NodeV[]; edges: EdgeV[]; dataKey: string; selectedId?: string | null; selectedEdgeId?: string | null; highlight?: Set<string> | null;
  /** node and edge ids of a highlighted path (drawn with the Lumen gradient) */ path?: { nodes: Set<string>; edges: Set<string> } | null;
  frozen?: boolean; onSelect?: (n: NodeV | null) => void; onEdge?: (e: EdgeV) => void;
}
const idOf = (x: unknown) => (typeof x === "object" && x ? String((x as FNode).id) : String(x));
export const radius = (n: NodeV) => (n.kind === "attachment" ? 2 : 2.4 + Math.min(10, Math.sqrt(n.degree || 0) * 1.35));
const short = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const nodeColor = (c: ThemeColors, n: Pick<NodeV, "kind" | "origin" | "status">) => (n.kind === "concept" ? (n.origin === "ai" ? c.ai : c.fg) : n.kind === "reference" ? c.warning : n.kind === "database" || n.kind === "row" ? c.success : n.kind === "attachment" ? c.fgFaint : c.accent);
const toneColor = (c: ThemeColors, t: Tone) => (t === "muted" ? c.lineStrong : c[t]);

export const GraphCanvas2 = forwardRef<GraphCanvas2Handle, GraphCanvas2Props>(function GraphCanvas2({ nodes, edges, dataKey, selectedId = null, selectedEdgeId = null, highlight = null, path = null, frozen = false, onSelect, onEdge }, ref) {
  const colors = useThemeColors(); const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null); const fg = useRef<ForceGraphMethods<FNode, FLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 }); const [hovered, setHovered] = useState<string | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>()); const current = useRef<{ nodes: FNode[]; links: FLink[] } | null>(null);
  const fitted = useRef(""); const view = useRef({ x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity });
  const lod = useMemo(() => lodFor(nodes.length, edges.length), [nodes.length, edges.length]);
  // animation clocks (performance.now): `open` = the whole view draws itself, `sel` = the highlighted edges draw themselves
  const anim = useRef<{ open: number | null; sel: number | null }>({ open: null, sel: null }); const [animating, setAnimating] = useState(false); const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runAnimation = useCallback((ms: number) => { setAnimating(true); if (animTimer.current) clearTimeout(animTimer.current); animTimer.current = setTimeout(() => { anim.current = { open: null, sel: null }; setAnimating(false); }, ms + 60); }, []);
  useEffect(() => () => { if (animTimer.current) clearTimeout(animTimer.current); }, []);

  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => { const r = e.contentRect; setSize({ w: Math.floor(r.width), h: Math.floor(r.height) }); }); ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight }); return () => ro.disconnect(); }, []);
  const graph = useMemo(() => {
    if (current.current) for (const n of current.current.nodes) if (n.x != null && n.y != null) positions.current.set(String(n.id), { x: n.x, y: n.y });
    const ns: FNode[] = nodes.map((n) => { const p = positions.current.get(n.id); return { ...n, ...(p ? { x: p.x, y: p.y } : {}) }; });
    const ids = new Set(ns.map((n) => n.id)); const links: FLink[] = edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e, i) => ({ ...e, __i: i }));
    const g = { nodes: ns, links }; current.current = g; return g;
  }, [nodes, edges]);
  // 3 — Knowledge Connections: a view that opens draws its edges (small graphs only; never under Reduce Motion)
  useEffect(() => { if (!lod.drawIn || reduced || !graph.links.length) return; anim.current.open = performance.now(); runAnimation(drawInDuration(graph.links.length, DUR.slow)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dataKey, lod.drawIn, reduced]);
  const near = useMemo(() => { const s = new Set<string>(); if (!selectedId) return s; for (const l of graph.links) { const a = idOf(l.source), b = idOf(l.target); if (a === selectedId) s.add(b); else if (b === selectedId) s.add(a); } return s; }, [graph, selectedId]);
  // the edges of a new selection / path draw themselves with the Lumen gradient
  const pathKey = path ? [...path.edges].join(",") : "";
  useEffect(() => { if (reduced || (!selectedId && !selectedEdgeId && !pathKey)) return; anim.current.sel = performance.now(); runAnimation(DUR.slow); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedId, selectedEdgeId, pathKey, reduced]);

  useImperativeHandle(ref, () => ({
    zoomToFit: () => fit(fg.current),
    focus: (id, zoom = 3) => { const n = current.current?.nodes.find((x) => x.id === id); if (n && n.x != null && n.y != null && fg.current) { fg.current.centerAt(n.x, n.y, reduced ? 0 : 500); fg.current.zoom(zoom, reduced ? 0 : 500); } },
    reheat: () => fg.current?.d3ReheatSimulation(),
  }), [reduced]);
  const tuned = useRef("");
  const tune = useCallback(() => { const f = fg.current; if (!f || tuned.current === dataKey) return; tuned.current = dataKey; const big = !lod.decorations; const ch: any = f.d3Force("charge"); ch?.strength(big ? -34 : -70); ch?.distanceMax?.(big ? 260 : 900); ch?.theta?.(big ? 1.2 : 0.9); const ln: any = f.d3Force("link"); ln?.distance((l: FLink) => (l.kind === "attachment" || l.kind === "about" ? 24 : 44)); }, [dataKey, lod.decorations]);
  useEffect(() => { if (!frozen) fg.current?.d3ReheatSimulation(); }, [frozen]);

  const hi = useCallback((l: FLink) => { const e = l as FLink & EdgeV; if (path?.edges.has(e.id)) return true; if (selectedEdgeId && e.id === selectedEdgeId) return true; return Boolean(selectedId) && !path && (idOf(l.source) === selectedId || idOf(l.target) === selectedId); }, [selectedId, selectedEdgeId, path]);
  const focusOn = Boolean(selectedId || selectedEdgeId || path);
  const frame = useCallback((_ctx: CanvasRenderingContext2D, scale: number) => { const f = fg.current; if (!f || !size.w) return; const a = f.screen2GraphCoords(0, 0), b = f.screen2GraphCoords(size.w, size.h); const pad = 24 / scale; view.current = { x0: a.x - pad, x1: b.x + pad, y0: a.y - pad, y1: b.y + pad }; const w = window as any; if (w.__kgPerf) w.__kgPerf.push(performance.now()); }, [size.w, size.h]);

  const paintNode = useCallback((node: FNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const n = node as NodeV & FNode; if (n.x == null || n.y == null) return; const v = view.current; if (n.x < v.x0 || n.x > v.x1 || n.y < v.y0 || n.y > v.y1) return;
    const r = radius(n); const sel = n.id === selectedId; const isHover = n.id === hovered; const lit = (highlight?.has(n.id) ?? false) || (path?.nodes.has(n.id) ?? false);
    const dim = (highlight && highlight.size > 0 && !lit && !sel) || (path ? !path.nodes.has(n.id) : Boolean(selectedId) && !sel && !near.has(n.id));
    const col = nodeColor(colors, n); ctx.globalAlpha = dim ? 0.2 : n.external ? 0.55 : 1; ctx.fillStyle = col; ctx.beginPath();
    if (n.kind === "reference") ctx.rect(n.x - r * 0.86, n.y - r * 0.86, r * 1.72, r * 1.72);
    else if (n.kind === "concept") { const d = r * 1.25; ctx.moveTo(n.x, n.y - d); ctx.lineTo(n.x + d, n.y); ctx.lineTo(n.x, n.y + d); ctx.lineTo(n.x - d, n.y); ctx.closePath(); }
    else ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    if (n.kind === "concept" && n.status === "suggested") { ctx.lineWidth = 1.4 / scale; ctx.setLineDash([3 / scale, 2 / scale]); ctx.strokeStyle = colors.ai; ctx.stroke(); ctx.setLineDash([]); } else ctx.fill();
    if (sel || isHover || lit) { ctx.lineWidth = (sel ? 2 : 1.2) / scale; ctx.strokeStyle = sel ? colors.fg : colors.fgMuted; ctx.stroke(); }
    if (n.kind === "database" || n.kind === "research" || n.kind === "canvas") { ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(0.8, r * 0.38), 0, 2 * Math.PI); ctx.fillStyle = colors.bgElev; ctx.fill(); }
    if (scale >= lod.labelsAt || sel || isHover || lit || (selectedId && near.has(n.id) && scale >= lod.labelsAt * 0.5)) {
      const fs = 11 / scale; ctx.font = `${sel ? "600 " : ""}${fs}px ${colors.font}`; ctx.textAlign = "center"; ctx.textBaseline = "top"; const label = `${n.icon ? `${n.icon} ` : ""}${short(n.title)}`; const w = ctx.measureText(label).width;
      ctx.fillStyle = colors.bg; ctx.globalAlpha = dim ? 0.15 : 0.78; ctx.fillRect(n.x - w / 2 - 1.5 / scale, n.y + r + 1 / scale, w + 3 / scale, fs + 2 / scale); ctx.globalAlpha = dim ? 0.3 : 1; ctx.fillStyle = sel ? colors.fg : colors.fgMuted; ctx.fillText(label, n.x, n.y + r + 2 / scale);
    }
    ctx.globalAlpha = 1;
  }, [colors, selectedId, hovered, highlight, near, path, lod.labelsAt]);
  const paintArea = useCallback((node: FNode, color: string, ctx: CanvasRenderingContext2D) => { const n = node as NodeV & FNode; if (n.x == null || n.y == null) return; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, radius(n) + 2.5, 0, 2 * Math.PI); ctx.fill(); }, []);

  const styleOf = useCallback((l: FLink) => edgeStyle(l as FLink & EdgeV), []);
  const linkColor = useCallback((l: FLink) => { const base = toneColor(colors, styleOf(l).tone); return focusOn ? withAlpha(base, 0.18) : base; }, [colors, focusOn, styleOf]);
  const linkWidth = useCallback((l: FLink) => (lod.decorations ? styleOf(l).width : 0.6), [lod.decorations, styleOf]);
  const linkDash = useCallback((l: FLink) => (lod.decorations || (l as FLink & EdgeV).status === "suggested" ? styleOf(l).dash : null), [lod.decorations, styleOf]);
  const arrow = useCallback((l: FLink) => (lod.decorations && styleOf(l).arrow ? 2.6 : 0), [lod.decorations, styleOf]);
  const mode = useCallback((l: FLink) => (hi(l) || anim.current.open != null ? "replace" : lod.decorations && styleOf(l).ai ? "after" : undefined), [hi, lod.decorations, styleOf]);
  /** Custom painter: a self-drawing edge (progress 0…1 from its source), the Lumen gradient on highlighted edges, the AI badge on model edges. */
  const paintLink = useCallback((l: FLink, ctx: CanvasRenderingContext2D, scale: number) => {
    const s = l.source as FNode, t = l.target as FNode; if (typeof s !== "object" || typeof t !== "object" || s.x == null || s.y == null || t.x == null || t.y == null) return;
    const st = styleOf(l); const lit = hi(l); const now = performance.now();
    const badge = (x: number, y: number) => { if (scale < 0.9) return; const fs = 7.5 / scale; ctx.font = `600 ${fs}px ${colors.font}`; const w = ctx.measureText("AI").width + 5 / scale, h = fs + 3 / scale; ctx.fillStyle = colors.bgElev; ctx.strokeStyle = colors.ai; ctx.lineWidth = 0.8 / scale; ctx.beginPath(); ctx.rect(x - w / 2, y - h / 2, w, h); ctx.fill(); ctx.stroke(); ctx.fillStyle = colors.ai; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("AI", x, y + 0.4 / scale); };
    if (!lit && anim.current.open == null) { if (st.ai) badge((s.x + t.x) / 2, (s.y + t.y) / 2); return; } // mode "after": only the badge
    let p = 1; if (lit && anim.current.sel != null) p = drawProgress(now - anim.current.sel, 0, 1, DUR.slow); else if (!lit && anim.current.open != null) p = drawProgress(now - anim.current.open, l.__i ?? 0, graph.links.length, DUR.slow);
    if (p <= 0) return;
    // highlighted edges grow from the selected node outwards
    const fromTarget = lit && selectedId != null && idOf(t) === selectedId; const ax = fromTarget ? t.x : s.x, ay = fromTarget ? t.y : s.y, bx = fromTarget ? s.x : t.x, by = fromTarget ? s.y : t.y;
    const ex = ax + (bx - ax) * p, ey = ay + (by - ay) * p;
    ctx.save(); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.lineWidth = (lit ? 2.2 : st.width) / scale; if (st.dash) ctx.setLineDash(st.dash.map((d) => d / scale));
    if (lit) { const g = ctx.createLinearGradient(s.x, s.y, t.x, t.y); g.addColorStop(0, colors.accent); g.addColorStop(1, colors.ai); ctx.strokeStyle = g; } else { ctx.strokeStyle = toneColor(colors, st.tone); ctx.globalAlpha = focusOn ? 0.18 : 1; }
    ctx.stroke(); ctx.setLineDash([]);
    if (p >= 1 && st.arrow) { const ang = Math.atan2(t.y - s.y, t.x - s.x); const rr = radius(t as NodeV & FNode) + 1 / scale; const tipX = t.x - Math.cos(ang) * rr, tipY = t.y - Math.sin(ang) * rr; const len = (lit ? 6 : 4) / scale; ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(tipX - len * Math.cos(ang - 0.42), tipY - len * Math.sin(ang - 0.42)); ctx.lineTo(tipX - len * Math.cos(ang + 0.42), tipY - len * Math.sin(ang + 0.42)); ctx.closePath(); ctx.fillStyle = lit ? colors.ai : toneColor(colors, st.tone); ctx.fill(); }
    ctx.restore(); if (st.ai && p >= 1) badge((s.x + t.x) / 2, (s.y + t.y) / 2);
  }, [colors, hi, styleOf, focusOn, selectedId, graph.links.length]);
  const hoverRaf = useRef<number | null>(null); const hoverPending = useRef<string | null>(null);
  const onNodeHover = useCallback((n: FNode | null) => { hoverPending.current = n ? String(n.id) : null; if (hoverRaf.current != null) return; hoverRaf.current = requestAnimationFrame(() => { hoverRaf.current = null; setHovered((h) => (h === hoverPending.current ? h : hoverPending.current)); }); }, []);
  const onEngineStop = useCallback(() => { const g = current.current; if (g) for (const n of g.nodes) if (n.x != null && n.y != null) positions.current.set(String(n.id), { x: n.x, y: n.y }); if (fitted.current !== dataKey) { fitted.current = dataKey; fit(fg.current); } (window as any).__kgSettled = dataKey; }, [dataKey]);

  return (
    <div ref={box} className="relative h-full w-full" style={{ touchAction: "none" }} data-testid="graph-canvas" data-nodes={nodes.length} data-edges={edges.length} data-lod={lod.decorations ? (lod.drawIn ? "full" : "medium") : "large"} data-animating={animating ? "1" : "0"}>
      {size.w > 0 && size.h > 0 && (
        <ForceGraph2D
          ref={fg} width={size.w} height={size.h} graphData={graph} backgroundColor="rgba(0,0,0,0)"
          nodeId="id" nodeRelSize={1} nodeVal={(n: FNode) => radius(n as NodeV) ** 2}
          nodeCanvasObject={paintNode} nodeCanvasObjectMode={() => "replace"} nodePointerAreaPaint={paintArea} nodeLabel={() => ""}
          linkColor={linkColor} linkWidth={linkWidth} linkLineDash={linkDash} linkDirectionalArrowLength={arrow} linkDirectionalArrowRelPos={1} linkCurvature={0}
          linkCanvasObject={paintLink} linkCanvasObjectMode={mode} linkLabel={(l: FLink) => styleOf(l).label} linkHoverPrecision={lod.linkHover ? 5 : 0.001}
          warmupTicks={frozen ? 0 : lod.warmupTicks} cooldownTicks={frozen ? 0 : lod.cooldownTicks} cooldownTime={frozen ? 0 : 6000} d3AlphaDecay={lod.decorations ? 0.035 : 0.06} d3VelocityDecay={lod.decorations ? 0.35 : 0.5}
          autoPauseRedraw={!animating} minZoom={0.05} maxZoom={14} enableNodeDrag={!frozen}
          onEngineTick={tune} onEngineStop={onEngineStop} onRenderFramePre={frame}
          onNodeClick={(n: FNode) => onSelect?.(n as NodeV)} onBackgroundClick={() => onSelect?.(null)} onNodeHover={onNodeHover}
          onLinkClick={(l: FLink) => onEdge?.(l as FLink & EdgeV)}
          onNodeDragEnd={(n: FNode) => { if (frozen) { n.fx = n.x; n.fy = n.y; } }}
        />
      )}
    </div>
  );
});
function fit(f: ForceGraphMethods<FNode, FLink> | undefined) { if (!f) return; f.zoomToFit(0, 48); const z = f.zoom(); if (z > 3.5) { const c = f.centerAt(); f.zoom(3.5, 0); f.centerAt(c.x, c.y, 0); } }
function withAlpha(color: string, a: number) {
  if (color.startsWith("oklch(") && !color.includes("/")) return color.replace(/\)$/, ` / ${a})`);
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) { const h = color.length === 4 ? color.slice(1).split("").map((c) => c + c).join("") : color.slice(1); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; }
  return color;
}
