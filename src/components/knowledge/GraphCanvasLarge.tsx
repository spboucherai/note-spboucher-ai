"use client";
/**
 * file: src/components/knowledge/GraphCanvasLarge.tsx
 * description: renderer of the Knowledge Graph 2.0 for large graphs (above 1 500 nodes or 6 000 edges, up to the budget of
 *   5 000 nodes / 20 000 edges). The 2.x renderer (react-force-graph-2d) was measured at 2–6 frames per second at that size, so it
 *   is kept for small and medium graphs only (GraphCanvas2) and this canvas takes over: edges are stroked in a handful of batched
 *   paths (one per colour family, suggested ones dashed in the AI colour), nodes in one path per colour and shape, labels only for
 *   what is on screen at reading zoom, and the layout (src/lib/graph/layout.ts) is time-sliced so the page stays responsive while
 *   it settles. Same props, same handle, same look. Signature motion 3: the edges of the selected node / path draw themselves with
 *   the Lumen gradient (nothing is animated under Reduce Motion). Pan = drag, zoom = wheel / pinch / double-click, select = click.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { EdgeV, NodeV } from "@/lib/graph/views";
import { initLayout, layoutDone, stepLayout, type LayoutState } from "@/lib/graph/layout";
import { drawProgress, edgeStyle, type Tone } from "@/lib/client/knowledge";
import { useReducedMotion, DUR } from "@/lib/client/motion";
import { useThemeColors } from "@/components/graph/colors";
import { nodeColor, radius, type GraphCanvas2Handle, type GraphCanvas2Props } from "./GraphCanvas2";

const TONES: Tone[] = ["muted", "accent", "success", "danger", "warning", "ai"];
const cache = new Map<string, { x: number; y: number }>(); // positions by node id, kept across data refreshes and view changes
interface View { k: number; tx: number; ty: number }

export const GraphCanvasLarge = forwardRef<GraphCanvas2Handle, GraphCanvas2Props>(function GraphCanvasLarge({ nodes, edges, dataKey, selectedId = null, selectedEdgeId = null, highlight = null, path = null, frozen = false, onSelect }, ref) {
  const colors = useThemeColors(); const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null); const cv = useRef<HTMLCanvasElement>(null); const [size, setSize] = useState({ w: 0, h: 0 }); const [hover, setHover] = useState<string | null>(null);
  const view = useRef<View>({ k: 1, tx: 0, ty: 0 }); const layout = useRef<LayoutState | null>(null); const raf = useRef<number | null>(null); const fitted = useRef(""); const selAnim = useRef<number | null>(null); const userMoved = useRef(false);
  // index the graph once per data change: node index by id, edges as index pairs bucketed by how they are drawn
  const model = useMemo(() => {
    const index = new Map(nodes.map((n, i) => [n.id, i])); const pairs: [number, number][] = []; const kept: EdgeV[] = [];
    for (const e of edges) { const a = index.get(e.source), b = index.get(e.target); if (a === undefined || b === undefined || a === b) continue; pairs.push([a, b]); kept.push(e); }
    const buckets = new Map<string, number[]>(); kept.forEach((e, i) => { const st = edgeStyle(e); const key = `${st.tone}|${st.dash ? "d" : "s"}`; const l = buckets.get(key); if (l) l.push(i); else buckets.set(key, [i]); });
    const byColor = new Map<string, number[]>(); nodes.forEach((n, i) => { const key = `${n.kind === "reference" ? "sq" : n.kind === "concept" ? "di" : "ci"}|${nodeColor(colors, n)}`; const l = byColor.get(key); if (l) l.push(i); else byColor.set(key, [i]); });
    const adj = new Map<number, number[]>(); pairs.forEach(([a, b], e) => { (adj.get(a) ?? adj.set(a, []).get(a)!).push(e); (adj.get(b) ?? adj.set(b, []).get(b)!).push(e); });
    const byDegree = nodes.map((_, i) => i).sort((a, b) => nodes[b].degree - nodes[a].degree);
    return { index, pairs, kept, buckets, byColor, adj, byDegree, radii: Float32Array.from(nodes, (n) => radius(n)) };
  }, [nodes, edges, colors]);
  const selIndex = selectedId ? model.index.get(selectedId) ?? -1 : -1;
  const lit = useMemo(() => { const s = new Set<number>(); if (path) model.kept.forEach((e, i) => { if (path.edges.has(e.id)) s.add(i); }); else if (selIndex >= 0) for (const e of model.adj.get(selIndex) ?? []) s.add(e); if (selectedEdgeId) { const i = model.kept.findIndex((e) => e.id === selectedEdgeId); if (i >= 0) s.add(i); } return s; }, [model, path, selIndex, selectedEdgeId]);
  const near = useMemo(() => { const s = new Set<number>(); if (path) { for (const id of path.nodes) { const i = model.index.get(id); if (i !== undefined) s.add(i); } } else for (const e of lit) { s.add(model.pairs[e][0]); s.add(model.pairs[e][1]); } return s; }, [lit, path, model]);

  const paint = useCallback(() => {
    raf.current = null; const c = cv.current; const L = layout.current; if (!c || !L || !size.w) return; const ctx = c.getContext("2d"); if (!ctx) return;
    let again = false;
    if (!frozen && !layoutDone(L)) { const t0 = performance.now(); do stepLayout(L, 1); while (!layoutDone(L) && performance.now() - t0 < 9); again = !layoutDone(L); if (!userMoved.current) fitNow(false); if (!again) { nodes.forEach((n, i) => cache.set(n.id, { x: L.x[i], y: L.y[i] })); (window as any).__kgSettled = dataKey; } }
    const dpr = window.devicePixelRatio || 1; const { k, tx, ty } = view.current; const { w, h } = size; const X = L.x, Y = L.y;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const gx0 = -tx / k, gx1 = (w - tx) / k, gy0 = -ty / k, gy1 = (h - ty) / k; const pad = 14 / k; const focus = lit.size > 0 || near.size > 0 || selIndex >= 0;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
    // edges: one stroke per colour family
    const zoomAlpha = Math.max(0.16, Math.min(0.9, k * 1.1));
    for (const [key, list] of model.buckets) { const [tone, dash] = key.split("|") as [Tone, string]; ctx.beginPath(); for (const e of list) { if (lit.has(e)) continue; const [a, b] = model.pairs[e]; const ax = X[a], ay = Y[a], bx = X[b], by = Y[b]; if ((ax < gx0 && bx < gx0) || (ax > gx1 && bx > gx1) || (ay < gy0 && by < gy0) || (ay > gy1 && by > gy1)) continue; ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
      ctx.strokeStyle = tone === "muted" ? colors.lineStrong : colors[tone]; ctx.globalAlpha = (focus ? 0.22 : 1) * (tone === "muted" ? zoomAlpha : Math.min(1, zoomAlpha + 0.25)); ctx.lineWidth = (tone === "muted" ? 0.7 : 1.1) / k; ctx.setLineDash(dash === "d" ? [4 / k, 3 / k] : []); ctx.stroke(); }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // highlighted edges: Lumen gradient, drawing themselves from the selected node
    if (lit.size) { const now = performance.now(); const p = selAnim.current == null ? 1 : drawProgress(now - selAnim.current, 0, 1, DUR.slow); if (p < 1) again = true; else selAnim.current = null;
      ctx.lineWidth = 2.2 / k; for (const e of lit) { let [a, b] = model.pairs[e]; if (b === selIndex) [a, b] = [b, a]; const g = ctx.createLinearGradient(X[a], Y[a], X[b], Y[b]); g.addColorStop(0, colors.accent); g.addColorStop(1, colors.ai); ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(X[a], Y[a]); ctx.lineTo(X[a] + (X[b] - X[a]) * p, Y[a] + (Y[b] - Y[a]) * p); if (model.kept[e].status === "suggested") ctx.setLineDash([4 / k, 3 / k]); ctx.stroke(); ctx.setLineDash([]); } }
    // nodes: one path per colour and shape
    const marked = highlight && highlight.size > 0 ? highlight : null;
    const drawNodes = (list: number[], shape: string, only: ((i: number) => boolean) | null) => { ctx.beginPath(); for (const i of list) { if (only && !only(i)) continue; const x = X[i], y = Y[i]; if (x < gx0 - pad || x > gx1 + pad || y < gy0 - pad || y > gy1 + pad) continue; const r = Math.max(model.radii[i], 1.6 / k); if (shape === "sq") ctx.rect(x - r * 0.86, y - r * 0.86, r * 1.72, r * 1.72); else if (shape === "di") { const d = r * 1.25; ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath(); } else { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); } } ctx.fill(); };
    const strong = (i: number) => (marked ? marked.has(nodes[i].id) : near.has(i) || i === selIndex);
    for (const [key, list] of model.byColor) { const [shape, col] = [key.slice(0, 2), key.slice(3)]; ctx.fillStyle = col; if (focus || marked) { ctx.globalAlpha = 0.2; drawNodes(list, shape, (i) => !strong(i)); ctx.globalAlpha = 1; drawNodes(list, shape, strong); } else drawNodes(list, shape, null); }
    ctx.globalAlpha = 1;
    const ring = (i: number, width: number, col: string) => { if (i < 0) return; ctx.beginPath(); ctx.arc(X[i], Y[i], model.radii[i] + 2.2 / k, 0, 6.2832); ctx.lineWidth = width / k; ctx.strokeStyle = col; ctx.stroke(); };
    ring(selIndex, 2, colors.fg); if (hover) ring(model.index.get(hover) ?? -1, 1.3, colors.fgMuted);
    // labels: selected / hovered / marked always, the rest from reading zoom, the most connected first
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.font = `11px ${colors.font}`; ctx.textAlign = "center"; ctx.textBaseline = "top"; let shown = 0; const want = k >= 2.2;
    const label = (i: number, strongLabel: boolean) => { const x = X[i] * k + tx, y = Y[i] * k + ty; if (x < -60 || x > w + 60 || y < -20 || y > h + 20) return; const n = nodes[i]; const text = `${n.icon ? `${n.icon} ` : ""}${n.title.length > 30 ? `${n.title.slice(0, 29)}…` : n.title}`; const tw = ctx.measureText(text).width; const yy = y + model.radii[i] * k + 3; ctx.globalAlpha = 0.8; ctx.fillStyle = colors.bg; ctx.fillRect(x - tw / 2 - 2, yy - 1, tw + 4, 14); ctx.globalAlpha = 1; ctx.fillStyle = strongLabel ? colors.fg : colors.fgMuted; ctx.fillText(text, x, yy); shown++; };
    if (selIndex >= 0) label(selIndex, true); if (hover) { const i = model.index.get(hover); if (i !== undefined && i !== selIndex) label(i, true); }
    if (marked && marked.size <= 80) for (const id of marked) { const i = model.index.get(id); if (i !== undefined && i !== selIndex) label(i, false); }
    if (near.size && near.size <= 60) for (const i of near) if (i !== selIndex) label(i, false);
    if (want && !focus) for (const i of model.byDegree) { if (shown >= 140) break; const x = X[i], y = Y[i]; if (x < gx0 || x > gx1 || y < gy0 || y > gy1) continue; if (i !== selIndex && nodes[i].id !== hover) label(i, false); }
    const perf = (window as any).__kgPerf; if (perf) perf.push(performance.now());
    if (again) raf.current = requestAnimationFrame(paint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, size, colors, lit, near, selIndex, hover, highlight, frozen, nodes, dataKey]);
  const schedule = useCallback(() => { if (raf.current == null) raf.current = requestAnimationFrame(paint); }, [paint]);
  const fitNow = (redraw = true) => { const L = layout.current; if (!L || !L.n || !size.w) return; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < L.n; i++) { if (L.x[i] < x0) x0 = L.x[i]; if (L.x[i] > x1) x1 = L.x[i]; if (L.y[i] < y0) y0 = L.y[i]; if (L.y[i] > y1) y1 = L.y[i]; } const k = Math.min(3.5, (size.w - 96) / Math.max(x1 - x0, 1), (size.h - 96) / Math.max(y1 - y0, 1)); view.current = { k, tx: size.w / 2 - ((x0 + x1) / 2) * k, ty: size.h / 2 - ((y0 + y1) / 2) * k }; if (redraw) schedule(); };
  useEffect(() => { layout.current = initLayout(nodes.length, model.pairs, (i) => cache.get(nodes[i].id)); if (fitted.current !== dataKey) { fitted.current = dataKey; userMoved.current = false; fitNow(false); } schedule(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [model.pairs, nodes, dataKey]);
  useEffect(() => { schedule(); return () => { if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; } }; }, [schedule]);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) })); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => { const c = cv.current; if (!c || !size.w) return; const dpr = window.devicePixelRatio || 1; c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr); if (!userMoved.current) fitNow(false); schedule(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [size]);
  const pathKey = path ? [...path.edges].join(",") : "";
  useEffect(() => { if (!reduced && (selectedId || selectedEdgeId || pathKey)) selAnim.current = performance.now(); schedule(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedId, selectedEdgeId, pathKey, reduced]);
  const zoomAt = useCallback((f: number, sx: number, sy: number) => { const v = view.current; const k = Math.min(14, Math.max(0.03, v.k * f)); const g = k / v.k; view.current = { k, tx: sx - (sx - v.tx) * g, ty: sy - (sy - v.ty) * g }; userMoved.current = true; schedule(); }, [schedule]);
  useImperativeHandle(ref, () => ({
    zoomToFit: () => { userMoved.current = false; fitNow(); },
    focus: (id, zoom = 3) => { const i = model.index.get(id); const L = layout.current; if (i === undefined || !L) return; const k = Math.max(view.current.k, Math.min(zoom, 2.4)); view.current = { k, tx: size.w / 2 - L.x[i] * k, ty: size.h / 2 - L.y[i] * k }; userMoved.current = true; schedule(); },
    reheat: () => { if (layout.current) { layout.current.iter = Math.floor(layout.current.total * 0.5); schedule(); } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [model, size, schedule]);
  useEffect(() => { const c = cv.current; if (!c) return; const onWheel = (e: WheelEvent) => { e.preventDefault(); const b = c.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - b.left, e.clientY - b.top); }; c.addEventListener("wheel", onWheel, { passive: false }); return () => c.removeEventListener("wheel", onWheel); }, [zoomAt]);
  const hit = (sx: number, sy: number): number => { const L = layout.current; if (!L) return -1; const { k, tx, ty } = view.current; const gx = (sx - tx) / k, gy = (sy - ty) / k; let best = -1, bd = 7 / k; for (let i = 0; i < L.n; i++) { const d = Math.hypot(L.x[i] - gx, L.y[i] - gy) - model.radii[i]; if (d < bd) { bd = d; best = i; } } return best; };
  const ptrs = useRef(new Map<number, { x: number; y: number }>()); const gesture = useRef<{ moved: boolean; dist: number | null }>({ moved: false, dist: null }); const hoverRaf = useRef<number | null>(null);
  const local = (e: React.PointerEvent) => { const b = cv.current!.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const onMove = (e: React.PointerEvent) => {
    const p = local(e); const prev = ptrs.current.get(e.pointerId);
    if (!prev) { if (hoverRaf.current == null) hoverRaf.current = requestAnimationFrame(() => { hoverRaf.current = null; const i = hit(p.x, p.y); const id = i >= 0 ? nodes[i].id : null; setHover((h) => (h === id ? h : id)); }); return; }
    ptrs.current.set(e.pointerId, p);
    if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (gesture.current.dist) zoomAt(d / gesture.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2); gesture.current = { moved: true, dist: d }; return; }
    const dx = p.x - prev.x, dy = p.y - prev.y; if (Math.abs(dx) + Math.abs(dy) > 2) gesture.current.moved = true; view.current = { ...view.current, tx: view.current.tx + dx, ty: view.current.ty + dy }; userMoved.current = true; schedule();
  };
  const onUp = (e: React.PointerEvent) => { const p = local(e); const many = ptrs.current.size > 1; ptrs.current.delete(e.pointerId); if (many || gesture.current.moved) { gesture.current.dist = null; return; } const i = hit(p.x, p.y); onSelect?.(i >= 0 ? nodes[i] : null); };
  return (
    <div ref={box} className="relative h-full w-full" data-testid="graph-canvas" data-renderer="batched" data-nodes={nodes.length} data-edges={edges.length} data-lod="large">
      <canvas ref={cv} className={`absolute inset-0 h-full w-full touch-none ${hover ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`} aria-hidden
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); ptrs.current.set(e.pointerId, local(e)); gesture.current = { moved: false, dist: null }; }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={(e) => ptrs.current.delete(e.pointerId)} onPointerLeave={() => setHover(null)}
        onDoubleClick={(e) => { const b = cv.current!.getBoundingClientRect(); zoomAt(2, e.clientX - b.left, e.clientY - b.top); }} />
    </div>
  );
});
