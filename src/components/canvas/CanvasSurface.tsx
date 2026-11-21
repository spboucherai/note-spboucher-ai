/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/canvas/CanvasSurface.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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
/**
 * file: src/components/canvas/CanvasSurface.tsx
 * description: the infinite surface — pan and zoom (wheel, trackpad pinch, space-drag, middle button, one-finger pan on empty space,
 *   two-finger pan + pinch), cards, connections, selection (click, shift, marquee), move with alignment guides, group resize,
 *   connect by dragging a side handle, freehand ink, context menu, keyboard, clipboard, drops (files, pages of the sidebar, links).
 *   Performance: the viewport is one CSS transform applied outside React; only the cards and connections near the view are
 *   rendered (overscan of half a screen), cards too small to read are drawn as placeholders, and each card is memoised on its node.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as M from "@/lib/canvas/model";
import type { CanvasEdge, CanvasNode, Guide, Handle, Point, Rect } from "@/lib/canvas/model";
import { splitColor, strokeHit, type InkStroke, type InkTool } from "@/lib/editor/ink";
import { toast } from "@/components/ui/toast";
import { useCanvas, type CanvasStore } from "./store";
import { NodeView } from "./NodeView";
import * as A from "./actions";

export interface InkStyle { tool: InkTool | "eraser"; color: string; width: number }
export interface SurfaceHandle { /** finish the ink session (upload + card); resolves when done */ commitInk: () => Promise<void>; inkCount: () => number; undoInk: () => void; focus: () => void; /** what Enter / double-click does on a card */ edit: (n: CanvasNode) => void }
export interface SurfaceProps {
  store: CanvasStore; pageId: string; phone: boolean; inkStyle: InkStyle;
  /** autosave must wait while a gesture is in progress */ onGesture: (active: boolean) => void;
  /** open the form of a card (kinds without in-place editing; every kind on a phone) */ onForm: (id: string) => void;
  onOpenPage: (pageId: string) => void;
  /** phone "connect" mode: the next card tapped becomes the target of a connection from this card */ connectFrom: string | null; onConnected: () => void;
  onInkChange?: (strokes: number) => void;
  menu: (target: { node: CanvasNode | null; edge: CanvasEdge | null; at: Point }) => React.ReactNode;
}
const INLINE_KINDS = new Set(["text", "shape", "math", "table"]);
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const SIDES: M.Side[] = ["top", "right", "bottom", "left"];
type Gesture =
  | { type: "pan"; x: number; y: number }
  | { type: "press"; node: string; sx: number; sy: number; world: Point; wasSelected: boolean; shift: boolean }
  | { type: "move"; start: Point; ids: string[]; box: Rect; origin: M.CanvasData; others: Rect[] }
  | { type: "resize"; start: Point; ids: string[]; handle: Handle; origin: M.CanvasData; aspect: boolean }
  | { type: "marquee"; start: Point; base: string[] }
  | { type: "connect"; from: string }
  | { type: "ink"; stroke: InkStroke | null; erased: boolean }
  | { type: "pinch"; dist: number; zoom: number; mid: Point };

export const CanvasSurface = React.forwardRef<SurfaceHandle, SurfaceProps>(function CanvasSurface({ store, pageId, phone, inkStyle, onGesture, onForm, onOpenPage, connectFrom, onConnected, onInkChange, menu }, ref) {
  const doc = useCanvas(store, (s) => s.doc); const selection = useCanvas(store, (s) => s.selection); const selEdge = useCanvas(store, (s) => s.edge);
  const tool = useCanvas(store, (s) => s.tool); const editing = useCanvas(store, (s) => s.editing); const readOnly = useCanvas(store, (s) => s.readOnly);
  const surface = React.useRef<HTMLDivElement | null>(null), world = React.useRef<HTMLDivElement | null>(null);
  const g = React.useRef<Gesture | null>(null); const pointers = React.useRef(new Map<number, { x: number; y: number; type: string }>()); const origin = React.useRef({ left: 0, top: 0 });
  const space = React.useRef(false); const lastTap = React.useRef({ t: 0, id: "", x: 0, y: 0 }); const settleTimer = React.useRef(0);
  const [view, setView] = React.useState<{ rect: Rect; zoom: number }>(() => ({ rect: M.visibleRect(store.viewport, store.size, 600), zoom: store.viewport.zoom }));
  const [guides, setGuides] = React.useState<Guide[]>([]); const [marquee, setMarquee] = React.useState<Rect | null>(null); const [wire, setWire] = React.useState<{ from: Point; to: Point } | null>(null);
  const [ink, setInk] = React.useState<A.InkSession>({ strokes: [], replaces: null }); const [live, setLive] = React.useState<InkStroke | null>(null); const inkRef = React.useRef(ink); inkRef.current = ink;
  const [ctx, setCtx] = React.useState<{ node: CanvasNode | null; edge: CanvasEdge | null; at: Point }>({ node: null, edge: null, at: { x: 0, y: 0 } });
  const [grabbing, setGrabbing] = React.useState(false); const [edgeEdit, setEdgeEdit] = React.useState<string | null>(null);
  const inkStyleRef = React.useRef(inkStyle); inkStyleRef.current = inkStyle; const connectRef = React.useRef(connectFrom); connectRef.current = connectFrom;
  const gesture = (on: boolean) => onGesture(on);

  /* ---- viewport: one transform, outside React ---- */
  const applyViewport = React.useCallback((v: M.Viewport) => {
    const w = world.current, s = surface.current; if (!w || !s) return;
    w.style.transform = `translate(${-v.x * v.zoom}px, ${-v.y * v.zoom}px) scale(${v.zoom})`; w.style.setProperty("--cv-inv", String(1 / v.zoom));
    const step = 24 * v.zoom * (v.zoom < 0.35 ? 4 : v.zoom < 0.7 ? 2 : 1); s.style.backgroundSize = `${step}px ${step}px`; s.style.backgroundPosition = `${-v.x * v.zoom}px ${-v.y * v.zoom}px`;
    s.dataset.zoom = String(Math.round(v.zoom * 1000) / 1000);
    // promoted to its own layer while it moves (compositor-only pan), demoted when it rests (text is rasterised sharp at the final scale)
    if (!w.style.willChange) w.style.willChange = "transform"; window.clearTimeout(settleTimer.current); settleTimer.current = window.setTimeout(() => { if (world.current) world.current.style.willChange = ""; }, 180);
    setView((cur) => { const vis = M.visibleRect(v, store.size); const bucket = Math.abs(Math.log2(v.zoom / cur.zoom)) > 0.2; return !bucket && M.rectContains(cur.rect, vis) ? cur : { rect: M.visibleRect(v, store.size, Math.max(store.size.w, store.size.h) * 0.5), zoom: v.zoom }; });
  }, [store]);
  React.useLayoutEffect(() => {
    const s = surface.current; if (!s) return;
    const measure = () => { const r = s.getBoundingClientRect(); store.size = { w: Math.max(1, r.width), h: Math.max(1, r.height) }; origin.current = { left: r.left, top: r.top }; };
    measure(); applyViewport(store.viewport);
    const ro = new ResizeObserver(() => { measure(); applyViewport(store.viewport); setView({ rect: M.visibleRect(store.viewport, store.size, Math.max(store.size.w, store.size.h) * 0.5), zoom: store.viewport.zoom }); }); ro.observe(s);
    const off = store.onViewport(applyViewport);
    return () => { ro.disconnect(); off(); window.clearTimeout(settleTimer.current); };
  }, [store, applyViewport]);
  const toWorld = (e: { clientX: number; clientY: number }): Point => M.screenToWorld(store.viewport, { x: e.clientX - origin.current.left, y: e.clientY - origin.current.top });
  const toScreen = (e: { clientX: number; clientY: number }): Point => ({ x: e.clientX - origin.current.left, y: e.clientY - origin.current.top });

  /* ---- wheel: pinch / ctrl / mouse wheel zoom around the cursor, two-finger scroll pans ---- */
  React.useEffect(() => {
    const s = surface.current; if (!s) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-cv-scroll]")) return;
      e.preventDefault(); const r = s.getBoundingClientRect(); origin.current = { left: r.left, top: r.top }; const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey) store.setViewport(M.zoomBy(store.viewport, M.wheelZoomFactor(e.deltaY, !mouseWheel), at));
      else if (mouseWheel && !e.shiftKey) store.setViewport(M.zoomBy(store.viewport, M.wheelZoomFactor(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY, false), at));
      else store.setViewport(M.panBy(store.viewport, e.shiftKey && e.deltaX === 0 ? -e.deltaY : -e.deltaX, e.shiftKey && e.deltaX === 0 ? 0 : -e.deltaY));
    };
    s.addEventListener("wheel", onWheel, { passive: false });
    return () => s.removeEventListener("wheel", onWheel);
  }, [store]);

  /* ---- what is rendered ---- */
  const selSet = React.useMemo(() => new Set(selection), [selection]);
  const { nodes, edges, lodAll } = React.useMemo(() => {
    const vis: { n: CanvasNode; i: number }[] = []; const shown = new Set<string>();
    doc.nodes.forEach((n, i) => { if (selSet.has(n.id) || n.id === editing || M.rectsIntersect(view.rect, M.rectOf(n))) { vis.push({ n, i }); shown.add(n.id); } });
    vis.sort((a, b) => M.zOf(a.n) - M.zOf(b.n) || a.i - b.i);
    const byId = new Map(doc.nodes.map((n) => [n.id, n])); const es: { e: CanvasEdge; a: CanvasNode; b: CanvasNode }[] = [];
    for (const e of doc.edges) { const a = byId.get(e.from), b = byId.get(e.to); if (!a || !b) continue; if (shown.has(a.id) || shown.has(b.id) || M.rectsIntersect(view.rect, M.unionRects([M.rectOf(a), M.rectOf(b)])!)) es.push({ e, a, b }); }
    return { nodes: vis.map((x) => x.n), edges: es, lodAll: vis.length > 240 };
  }, [doc, view, selSet, editing]);
  const selBox = React.useMemo(() => (selection.length && !editing ? M.contentBounds(doc, selection) : null), [doc, selection, editing]);
  const single = selection.length === 1 ? M.nodeById(doc, selection[0]) ?? null : null;

  /* ---- ink ---- */
  const setInkSession = (next: A.InkSession) => { inkRef.current = next; setInk(next); onInkChange?.(next.strokes.length); };
  const commitInk = React.useCallback(async () => {
    const s = inkRef.current; if (!s.strokes.length && !s.replaces) return;
    try { await A.commitInk(store, pageId, s); setInkSession({ strokes: [], replaces: null }); }
    catch (e) { toast("Drawing not saved", { description: `${e instanceof Error ? e.message : "Upload failed"} — your strokes are still on the canvas; try again.`, tone: "danger" }); throw e; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, pageId]);
  React.useEffect(() => { if (tool !== "draw" && (inkRef.current.strokes.length || inkRef.current.replaces)) void commitInk().catch(() => store.setTool("draw")); }, [tool, commitInk, store]);

  /* ---- editing entry ---- */
  const beginEdit = React.useCallback((n: CanvasNode) => {
    if (store.get().readOnly) { if (n.kind === "page" && typeof n.pageId === "string") onOpenPage(n.pageId); return; }
    if (n.kind === "page" && typeof n.pageId === "string") onOpenPage(n.pageId);
    else if (n.kind === "drawing") { void A.inkOfCard(n).then((strokes) => { setInkSession({ strokes, replaces: n.id }); store.select([]); store.setTool("draw"); }).catch(() => toast("This drawing cannot be edited", { description: "Its ink file could not be read. Nothing was changed.", tone: "danger" })); }
    else if (INLINE_KINDS.has(n.kind) && !phone) store.edit(n.id);
    else if (M.isKnownKind(n.kind)) onForm(n.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, phone, onForm, onOpenPage]);

  React.useImperativeHandle(ref, () => ({ commitInk, inkCount: () => inkRef.current.strokes.length, undoInk: () => setInkSession({ ...inkRef.current, strokes: inkRef.current.strokes.slice(0, -1) }), focus: () => surface.current?.focus({ preventScroll: true }), edit: beginEdit }), [commitInk, beginEdit]);

  /* ---- pointer gestures ---- */
  const hitNode = (target: EventTarget | null): string | null => (target as HTMLElement | null)?.closest?.("[data-id]")?.getAttribute("data-id") ?? null;
  const endGesture = (cancel = false) => {
    const cur = g.current; g.current = null; setGuides([]); setMarquee(null); setWire(null); setGrabbing(false);
    if (cur && (cur.type === "move" || cur.type === "resize")) { if (cancel) store.cancel(); else store.settle(); }
    if (cur && cur.type === "ink") setLive(null);
    gesture(false);
  };
  const startPinch = () => {
    const [a, b] = [...pointers.current.values()]; if (!a || !b) return;
    const cur = g.current; if (cur && (cur.type === "move" || cur.type === "resize")) store.cancel(); setGuides([]); setMarquee(null); setWire(null); setLive(null);
    g.current = { type: "pinch", dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: store.viewport.zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; gesture(true);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement; if (t.closest("[data-cv-edit]") || t.closest("[data-cv-ui]")) return;
    const s = surface.current!; const r = s.getBoundingClientRect(); origin.current = { left: r.left, top: r.top };
    const w = toWorld(e); store.pointer = w; const id = hitNode(t); const edgeId = t.closest("[data-edge]")?.getAttribute("data-edge") ?? null;
    const ctxNode = id ? M.nodeById(store.doc, id) ?? null : null, ctxEdge = edgeId ? M.edgeById(store.doc, edgeId) ?? null : null;
    setCtx({ node: ctxNode, edge: ctxEdge, at: w }); // what the context menu (right click, ctrl-click, long press) will act on
    if (e.button === 2 || (e.button === 0 && e.ctrlKey && !e.metaKey && /Mac/i.test(navigator.platform))) {
      if (ctxNode && !store.get().selection.includes(ctxNode.id)) store.select([ctxNode.id]); else if (ctxEdge) store.selectEdge(ctxEdge.id); else if (!ctxNode) store.select([]);
      return;
    }
    if (document.activeElement !== s) { (document.activeElement as HTMLElement | null)?.blur?.(); s.focus({ preventScroll: true }); }
    if (store.get().editing) store.edit(null);
    pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top, type: e.pointerType });
    try { s.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    if (pointers.current.size === 2) { startPinch(); return; }
    if (pointers.current.size > 2) return;
    const st = store.get(); const sc = toScreen(e);
    if (e.button === 1 || space.current || st.tool === "hand") { g.current = { type: "pan", x: sc.x, y: sc.y }; setGrabbing(true); gesture(true); e.preventDefault(); return; }
    if (st.tool === "draw" && !st.readOnly) {
      const style = inkStyleRef.current; gesture(true);
      if (style.tool === "eraser") { g.current = { type: "ink", stroke: null, erased: false }; eraseAt(w); }
      else { const p = e.pointerType === "pen" && e.pressure > 0 ? Math.min(1, e.pressure) : 1; /* mouse / finger: p = 1 (one width law on every platform) */ const stroke: InkStroke = { tool: style.tool, color: `${style.color}${style.tool === "highlighter" ? "66" : "ff"}`, width: style.width, points: [[w.x, w.y, p]] }; g.current = { type: "ink", stroke, erased: false }; setLive(stroke); }
      return;
    }
    const handle = t.closest("[data-handle]")?.getAttribute("data-handle") as Handle | null; const side = t.closest("[data-connect]")?.getAttribute("data-connect");
    if (handle && !st.readOnly && st.selection.length) { const sel = store.selectedNodes(); g.current = { type: "resize", start: w, ids: [...st.selection], handle, origin: store.doc, aspect: sel.length === 1 && (sel[0].kind === "image" || sel[0].kind === "drawing" || sel[0].kind === "pdf") }; gesture(true); return; }
    if (side && !st.readOnly && st.selection.length === 1) { g.current = { type: "connect", from: st.selection[0] }; gesture(true); return; }
    if (id) {
      if (connectRef.current && connectRef.current !== id && !st.readOnly) { const made = A.connect(store, connectRef.current, id); if (!made) toast("These cards are already connected"); onConnected(); return; }
      const was = st.selection.includes(id);
      if (e.shiftKey) store.toggle(id); else if (!was) store.select([id]);
      g.current = { type: "press", node: id, sx: sc.x, sy: sc.y, world: w, wasSelected: was, shift: e.shiftKey }; return;
    }
    if (edgeId) { // click selects a connection, a second click (or Enter) edits its label
      const now = performance.now(); const lt = lastTap.current; const dbl = now - lt.t < 380 && lt.id === `edge:${edgeId}`; lastTap.current = { t: dbl ? 0 : now, id: `edge:${edgeId}`, x: sc.x, y: sc.y };
      store.selectEdge(edgeId); if (dbl && !st.readOnly) setEdgeEdit(edgeId); return;
    }
    if (connectRef.current) onConnected();
    if (e.pointerType === "touch") { g.current = { type: "pan", x: sc.x, y: sc.y }; gesture(true); if (!e.shiftKey) store.select([]); return; }
    if (!e.shiftKey) store.select([]);
    g.current = { type: "marquee", start: w, base: e.shiftKey ? [...st.selection] : [] };
  };
  const eraseAt = (w: Point, from?: Point) => {
    const radius = 10 / store.viewport.zoom; const path: [number, number][] = from ? [[from.x, from.y], [w.x, w.y]] : [[w.x, w.y]];
    const kept = inkRef.current.strokes.filter((s) => !strokeHit(s, path, radius)); if (kept.length !== inkRef.current.strokes.length) setInkSession({ ...inkRef.current, strokes: kept });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId); const sc = toScreen(e); const w = toWorld(e); store.pointer = w;
    if (!p) return; const prev = { x: p.x, y: p.y }; p.x = sc.x; p.y = sc.y;
    let cur = g.current; if (!cur) return;
    if (cur.type === "pinch") {
      const [a, b] = [...pointers.current.values()]; if (!a || !b) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      let v = M.panBy(store.viewport, mid.x - cur.mid.x, mid.y - cur.mid.y); v = M.zoomTo(v, cur.zoom * (dist / cur.dist), mid); cur.mid = mid; store.setViewport(v); return;
    }
    if (cur.type === "pan") { store.setViewport(M.panBy(store.viewport, sc.x - cur.x, sc.y - cur.y)); cur.x = sc.x; cur.y = sc.y; return; }
    if (cur.type === "press") {
      if (Math.hypot(sc.x - cur.sx, sc.y - cur.sy) < (e.pointerType === "touch" ? 8 : 3)) return;
      const st = store.get(); if (st.readOnly) { g.current = { type: "pan", x: sc.x, y: sc.y }; gesture(true); return; }
      const ids = st.selection.includes(cur.node) ? [...st.selection] : [cur.node]; if (!st.selection.includes(cur.node)) store.select(ids);
      const sel = new Set(ids); const box = M.contentBounds(st.doc, ids)!; const vis = M.visibleRect(store.viewport, store.size, 200);
      const others = st.doc.nodes.filter((n) => !sel.has(n.id) && M.rectsIntersect(vis, M.rectOf(n))).slice(0, 240).map(M.rectOf);
      cur = g.current = { type: "move", start: cur.world, ids, box, origin: st.doc, others }; gesture(true);
    }
    if (cur.type === "move") {
      let dx = w.x - cur.start.x, dy = w.y - cur.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const snap = e.altKey ? { dx: 0, dy: 0, guides: [] } : M.snapMove({ ...cur.box, x: cur.box.x + dx, y: cur.box.y + dy }, cur.others, 6 / store.viewport.zoom);
      const next = M.moveNodes(cur.origin, cur.ids, dx + snap.dx, dy + snap.dy); store.apply(() => next, "transient"); setGuides(snap.guides); return;
    }
    if (cur.type === "resize") { const next = M.resizeNodes(cur.origin, cur.ids, cur.handle, w.x - cur.start.x, w.y - cur.start.y, { keepAspect: cur.aspect !== e.shiftKey, min: M.MIN_NODE_SIZE }); store.apply(() => next, "transient"); return; }
    if (cur.type === "marquee") { const rect = M.rectFromPoints(cur.start, w); setMarquee(rect); const hit = M.nodesInRect(store.doc, rect).map((n) => n.id); store.select([...new Set([...cur.base, ...hit])]); return; }
    if (cur.type === "connect") { const from = M.nodeById(store.doc, cur.from); if (from) setWire({ from: M.anchorToward(from, w), to: w }); return; }
    if (cur.type === "ink") {
      if (!cur.stroke) { eraseAt(w, M.screenToWorld(store.viewport, prev)); return; }
      const native = e.nativeEvent; const batch = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : []; const events = batch.length ? batch : [native];
      const pts = cur.stroke.points;
      for (const ev of events) { const q = toWorld(ev); const last = pts[pts.length - 1]; if (Math.hypot(q.x - last[0], q.y - last[1]) * store.viewport.zoom < 1) continue; const pr = ev.pointerType === "pen" && ev.pressure > 0 ? Math.min(1, ev.pressure) : 1; pts.push([q.x, q.y, pr]); }
      setLive({ ...cur.stroke });
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const had = pointers.current.delete(e.pointerId); try { surface.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!had) return; const cur = g.current; const w = toWorld(e); const sc = toScreen(e);
    if (cur?.type === "pinch") { if (pointers.current.size < 2) { g.current = null; gesture(false); const rest = [...pointers.current.values()][0]; if (rest) { g.current = { type: "pan", x: rest.x, y: rest.y }; gesture(true); } } return; }
    if (cur?.type === "connect") {
      const target = M.nodeAt(store.doc, w, 4 / store.viewport.zoom);
      if (target && target.id !== cur.from) { const made = A.connect(store, cur.from, target.id); if (made) store.selectEdge(made); else toast("These cards are already connected"); }
    }
    if (cur?.type === "ink" && cur.stroke) { const stroke = cur.stroke; if (stroke.points.length === 1) stroke.points.push([stroke.points[0][0] + 0.01, stroke.points[0][1], stroke.points[0][2]]); setInkSession({ ...inkRef.current, strokes: [...inkRef.current.strokes, stroke] }); }
    if (cur?.type === "press") { // a click on a card (no drag)
      if (cur.wasSelected && !cur.shift && store.get().selection.length > 1) store.select([cur.node]);
      const now = performance.now(); const lt = lastTap.current; const dbl = now - lt.t < 380 && lt.id === cur.node && Math.hypot(sc.x - lt.x, sc.y - lt.y) < 24;
      lastTap.current = { t: dbl ? 0 : now, id: cur.node, x: sc.x, y: sc.y };
      if (dbl) { const n = M.nodeById(store.doc, cur.node); if (n) beginEdit(n); }
    }
    if (cur?.type === "marquee" && !M.rectFromPoints(cur.start, w).w && !M.rectFromPoints(cur.start, w).h) { // a click on empty space
      const now = performance.now(); const lt = lastTap.current; const dbl = now - lt.t < 380 && lt.id === "" && Math.hypot(sc.x - lt.x, sc.y - lt.y) < 24; lastTap.current = { t: dbl ? 0 : now, id: "", x: sc.x, y: sc.y };
      if (dbl && !store.get().readOnly && store.get().tool === "select") { const id = A.addCard(store, "text", {}, w); if (id) { if (phone) onForm(id); else store.edit(id); } }
    }
    endGesture(false);
  };
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => { pointers.current.delete(e.pointerId); if (g.current?.type === "pinch" && pointers.current.size >= 2) return; endGesture(true); };

  React.useEffect(() => { const h = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id && !store.get().readOnly) setEdgeEdit(id); }; window.addEventListener(EDGE_LABEL_EVENT, h); return () => window.removeEventListener(EDGE_LABEL_EVENT, h); }, [store]);

  /* ---- keyboard ---- */
  type KeyLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "preventDefault" | "stopPropagation">;
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) handleKey(e); }; // not when a field inside a card has the focus
  const handleKey = (e: KeyLike) => {
    lastTap.current.t = 0; // a key press between two clicks: they are not a double-click
    const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase(); const st = store.get(); let used = true;
    if (e.key === " ") { space.current = true; setGrabbing(true); }
    else if (mod && k === "z") { if (st.tool === "draw" && inkRef.current.strokes.length && !e.shiftKey) setInkSession({ ...inkRef.current, strokes: inkRef.current.strokes.slice(0, -1) }); else if (e.shiftKey) store.redo(); else store.undo(); }
    else if (mod && k === "y") store.redo();
    else if (mod && k === "a") A.selectAll(store);
    else if (mod && k === "d") A.duplicateSelection(store);
    else if (mod && e.key === "]") A.zOrder(store, e.shiftKey ? "front" : "forward");
    else if (mod && e.key === "[") A.zOrder(store, e.shiftKey ? "back" : "backward");
    else if (mod && (e.key === "=" || e.key === "+")) A.zoomStep(store, 1.25);
    else if (mod && e.key === "-") A.zoomStep(store, 0.8);
    else if (mod && e.key === "0") A.zoomReset(store);
    else if (mod) used = false;
    else if (e.key === "Delete" || e.key === "Backspace") A.deleteSelection(store);
    else if (e.key === "Escape") { if (g.current) endGesture(true); else if (connectRef.current) onConnected(); else if (st.tool !== "select") store.setTool("select"); else store.select([]); }
    else if (e.key === "Enter") { const n = store.selectedNodes()[0]; if (n && st.selection.length === 1) beginEdit(n); else if (st.edge) setEdgeEdit(st.edge); else used = false; }
    else if (e.key.startsWith("Arrow")) { const step = e.shiftKey ? 10 : 1; if (st.selection.length) A.nudge(store, e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0); else store.setViewport(M.panBy(store.viewport, e.key === "ArrowLeft" ? 60 : e.key === "ArrowRight" ? -60 : 0, e.key === "ArrowUp" ? 60 : e.key === "ArrowDown" ? -60 : 0)); }
    else if (k === "v") store.setTool("select"); else if (k === "h") store.setTool("hand"); else if (k === "d" && !st.readOnly) store.setTool("draw");
    else if (k === "t" && !st.readOnly) { const id = A.addCard(store, "text"); if (id) store.edit(id); }
    else if (k === "s" && !st.readOnly) A.addCard(store, "shape");
    else if (e.key === "1" && e.shiftKey || e.key === "!") A.zoomToFit(store); else if (e.key === "2" && e.shiftKey || e.key === "@") A.zoomToFit(store, true);
    else if (e.key === "+" || e.key === "=") A.zoomStep(store, 1.25); else if (e.key === "-") A.zoomStep(store, 0.8); else if (e.key === "0") A.zoomReset(store);
    else if (e.key === "Tab") { const order = store.doc.nodes; if (order.length) { const i = order.findIndex((n) => n.id === st.selection[0]); const next = order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length]; store.select([next.id]); A.revealNode(store, next.id); } }
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  };
  // Shortcuts also work right after a click on the canvas chrome (a toolbar button keeps the focus) or when nothing has it —
  // never while a field, a dialog or a menu is in use, and never Space / Enter on a button (they press it).
  const handleKeyRef = React.useRef(handleKey); handleKeyRef.current = handleKey;
  React.useEffect(() => {
    const onWin = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null; const s = surface.current; if (!s || !t || t === s || e.defaultPrevented) return;
      const inChrome = t === document.body || (!!t.closest?.(".cv-page") && !s.contains(t));
      if (!inChrome || t.closest?.("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']") || document.querySelector("[role='dialog'], [role='menu']")) return;
      if (t !== document.body && (e.key === " " || e.key === "Enter" || e.key === "Tab" || e.key.startsWith("Arrow") || e.key === "Escape")) return;
      handleKeyRef.current(e);
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === " " && space.current) { space.current = false; if (g.current?.type !== "pan") setGrabbing(false); } };
    const onBlur = () => { space.current = false; };
    window.addEventListener("keydown", onWin); window.addEventListener("keyup", onUp); window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onWin); window.removeEventListener("keyup", onUp); window.removeEventListener("blur", onBlur); };
  }, []);
  const onKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === " ") { space.current = false; if (g.current?.type !== "pan") setGrabbing(false); } };

  /* ---- clipboard and drops ---- */
  const onCopy = (e: React.ClipboardEvent<HTMLDivElement>) => { if (e.target !== e.currentTarget) return; const text = A.copySelection(store); if (text) { e.clipboardData.setData("text/plain", text); e.preventDefault(); } };
  const onCut = (e: React.ClipboardEvent<HTMLDivElement>) => { if (e.target !== e.currentTarget) return; const text = A.copySelection(store); if (text) { e.clipboardData.setData("text/plain", text); e.preventDefault(); A.deleteSelection(store); } };
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || store.get().readOnly) return; e.preventDefault();
    const files = [...e.clipboardData.files]; if (files.length) { void A.addFiles(store, pageId, files); return; }
    const text = e.clipboardData.getData("text/plain"); const clip = A.readClip(text);
    if (clip) A.pasteClip(store, clip); else if (text.trim()) A.addFromText(store, text, undefined, pageId); else A.pasteClip(store);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); if (store.get().readOnly) return; const r = surface.current!.getBoundingClientRect(); origin.current = { left: r.left, top: r.top }; const at = toWorld(e);
    const files = [...e.dataTransfer.files]; if (files.length) { void A.addFiles(store, pageId, files, at); return; }
    const text = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"); if (text) A.addFromText(store, text.split("\n").find((l) => l && !l.startsWith("#")) ?? text, at, pageId);
  };

  const zoomLod = view.zoom;
  const cursor = grabbing ? "grabbing" : tool === "hand" ? "grab" : tool === "draw" ? "crosshair" : connectFrom ? "alias" : undefined;
  return (
    <ContextMenu.Root onOpenChange={(open) => { if (open && g.current) endGesture(true); }}>
      <ContextMenu.Trigger asChild disabled={tool === "draw"}>
        <div ref={surface} className="cv-surface" data-testid="canvas-surface" data-tool={tool} data-phone={phone || undefined} tabIndex={0} role="application" aria-label="Canvas. Arrow keys move the selection, Tab goes to the next card, Enter edits it."
          style={{ cursor }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onKeyDown={onKeyDown} onKeyUp={onKeyUp}
          onCopy={onCopy} onCut={onCut} onPaste={onPaste} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onBlur={() => { space.current = false; }}>
          <div ref={world} className="cv-world" data-rendered={nodes.length}>
            <svg className="cv-edges" aria-hidden={edges.length === 0}>
              {edges.map(({ e, a, b }) => <EdgeView key={e.id} edge={e} a={a} b={b} selected={selEdge === e.id} editing={edgeEdit === e.id} />)}
              {wire && <path className="cv-wire" d={`M${wire.from.x} ${wire.from.y} L${wire.to.x} ${wire.to.y}`} />}
              {guides.map((gd, i) => (gd.axis === "x" ? <line key={i} className="cv-guide" x1={gd.at} x2={gd.at} y1={gd.from - 12} y2={gd.to + 12} /> : <line key={i} className="cv-guide" y1={gd.at} y2={gd.at} x1={gd.from - 12} x2={gd.to + 12} />))}
            </svg>
            {nodes.map((n) => (ink.replaces === n.id ? null : <NodeView key={n.id} node={n} selected={selSet.has(n.id)} editing={editing === n.id} lod={(lodAll || zoomLod < 0.3 || Math.min(n.w, n.h) * zoomLod < 18) && editing !== n.id} store={store} readOnly={readOnly} />))}
            {(ink.strokes.length > 0 || live) && <svg className="cv-edges cv-inking" data-testid="canvas-ink-layer" data-strokes={ink.strokes.length}>{[...ink.strokes, ...(live ? [live] : [])].map((s, i) => { const c = splitColor(s.color); return <polyline key={i} points={s.points.map((p) => `${p[0]},${p[1]}`).join(" ")} fill="none" stroke={c.rgb} strokeOpacity={c.alpha} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />; })}</svg>}
            {edgeEdit && (() => { const x = edges.find((v) => v.e.id === edgeEdit); if (!x) return null; const r = M.routeEdge(x.a, x.b, M.routeStyleOf(x.e)); return <EdgeLabelInput key={x.e.id} at={r.label} value={typeof x.e.label === "string" ? x.e.label : ""} onDone={(label) => { setEdgeEdit(null); if (label !== null) store.apply((d) => M.updateEdge(d, x.e.id, { label: label.trim() ? label.trim().slice(0, 500) : undefined })); surface.current?.focus({ preventScroll: true }); }} />; })()}
            {selBox && !readOnly && tool === "select" && (
              <div className="cv-selbox" data-cv-selbox style={{ left: selBox.x, top: selBox.y, width: selBox.w, height: selBox.h }} data-multi={selection.length > 1 || undefined}>
                {HANDLES.filter((h) => selection.length === 1 || h.length === 2).map((h) => <span key={h} className="cv-handle" data-handle={h} role="button" aria-label={`Resize (${h})`} />)}
                {single && M.isKnownKind(single.kind) && SIDES.map((s) => <span key={s} className="cv-connect" data-connect={s} role="button" aria-label={`Connect from the ${s} side`} title="Drag to another card to connect" />)}
              </div>
            )}
            {marquee && <div className="cv-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
          </div>
          {doc.nodes.length === 0 && !ink.strokes.length && !live && <div className="cv-empty" aria-hidden={false}><b>This canvas is empty</b><span>{readOnly ? "Nothing was placed on it." : phone ? "Tap + to add a card. Drag with one finger to move around, pinch to zoom." : "Double-click to write, use the toolbar to add cards, or drop files and pages here."}</span></div>}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal><ContextMenu.Content className="cv-menu" data-cv-ui onCloseAutoFocus={(e) => { e.preventDefault(); surface.current?.focus({ preventScroll: true }); }}>{menu({ ...ctx, node: ctx.node ? M.nodeById(doc, ctx.node.id) ?? null : null, edge: ctx.edge ? M.edgeById(doc, ctx.edge.id) ?? null : null })}</ContextMenu.Content></ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

const EdgeView = React.memo(function EdgeView({ edge, a, b, selected, editing }: { edge: CanvasEdge; a: CanvasNode; b: CanvasNode; selected: boolean; editing: boolean }) {
  const r = React.useMemo(() => M.routeEdge(a, b, M.routeStyleOf(edge)), [a, b, edge]);
  const color = typeof edge.color === "string" && /^#[0-9a-f]{6}$/i.test(edge.color) ? edge.color : undefined; const label = typeof edge.label === "string" ? edge.label : "";
  const head = M.hasArrow(edge) ? M.arrowHead(r.points[r.points.length - 1], r.endAngle, 11) : null;
  const w = Math.min(260, Math.max(28, label.length * 6.8 + 16));
  return (
    <g className="cv-edge" data-edge={edge.id} data-selected={selected || undefined} style={color ? ({ "--cv-color": color } as React.CSSProperties) : undefined}>
      <path className="cv-edge-hit" d={r.d} />
      <path className="cv-edge-line" d={r.d} />
      {head && <polygon className="cv-edge-head" points={head.map((p) => `${p.x},${p.y}`).join(" ")} />}
      {label && !editing && <g className="cv-edge-label"><rect x={r.label.x - w / 2} y={r.label.y - 11} width={w} height={22} rx={7} /><text x={r.label.x} y={r.label.y + 4} textAnchor="middle">{label.length > 36 ? `${label.slice(0, 35)}…` : label}</text></g>}
    </g>
  );
});
function EdgeLabelInput({ at, value, onDone }: { at: Point; value: string; onDone: (label: string | null) => void }) {
  const [v, setV] = React.useState(value); const done = React.useRef(false); const finish = (x: string | null) => { if (done.current) return; done.current = true; onDone(x); };
  return <input data-cv-edit className="cv-edge-input" style={{ left: at.x, top: at.y }} autoFocus value={v} maxLength={500} placeholder="Label" aria-label="Connection label" onChange={(e) => setV(e.target.value)} onBlur={() => finish(v)}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); finish(v); } else if (e.key === "Escape") { e.preventDefault(); finish(null); } }} />;
}
/** Lets the page open the label editor of an edge (toolbar button, phone sheet) — the editor lives in the surface. */
export const EDGE_LABEL_EVENT = "note:canvas-edge-label";
