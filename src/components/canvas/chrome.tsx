/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/canvas/chrome.tsx
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
 * file: src/components/canvas/chrome.tsx
 * description: chrome of the desktop canvas — toolbar (tools, add a card, undo / redo, tidy, export), contextual bar of the selection
 *   (colours, stacking, align / distribute, connection style) and of the pen, zoom controls, minimap, context menu, and the
 *   non-blocking review panel of merge conflicts ("keep mine" / "keep theirs" per element).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, ArrowRight, BookMarked, BringToFront, Brush, Check, ClipboardPaste, Copy, CopyPlus, Download, Eraser, FileText, Globe, Hand, Highlighter, LayoutGrid, Maximize, Minus, MousePointer2, MoveRight, PenLine, Pencil, Plus, Redo2, Scissors, SendToBack, Shapes, Sigma, Spline, Table2, Trash2, TriangleAlert, Type, Undo2, Upload, X, CornerDownRight, ArrowLeftRight, Circle, Diamond, Square } from "lucide-react";
import * as M from "@/lib/canvas/model";
import type { CanvasConflict, CanvasEdge, CanvasNode, Point } from "@/lib/canvas/model";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/primitives";
import { useCanvas, type CanvasStore } from "./store";
import type { InkStyle } from "./CanvasSurface";
import * as A from "./actions";

export interface Commands {
  addFilesDialog: () => void; form: (id: string) => void; tidy: () => void; exportAs: (format: "png" | "svg" | "md") => void; editEdgeLabel: (id: string) => void;
  openNode: (n: CanvasNode) => void; pasteAt: (at?: Point) => void; inkDone: () => void; inkUndo: () => void;
}
/** Pen colours (content, not chrome) — the same as the drawing block of the editor. */
export const INK_COLORS: { name: string; hex: string }[] = [{ name: "Ink", hex: "#64748b" }, { name: "Black", hex: "#111827" }, { name: "Red", hex: "#dc2626" }, { name: "Orange", hex: "#ea580c" }, { name: "Yellow", hex: "#eab308" }, { name: "Green", hex: "#16a34a" }, { name: "Blue", hex: "#2563eb" }, { name: "Purple", hex: "#9333ea" }];
export const INK_WIDTHS: Record<InkStyle["tool"], [number, number, number]> = { pen: [3, 5, 9], marker: [7, 11, 17], highlighter: [16, 26, 40], eraser: [8, 16, 30] };
const Btn = ({ label, kbd, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; kbd?: string }) => <button type="button" className="cv-btn" aria-label={label} title={kbd ? `${label} (${kbd})` : label} {...p}>{children}</button>;
const Sep = () => <span className="cv-sep" aria-hidden />;

export function Toolbar({ store, cmd }: { store: CanvasStore; cmd: Commands }) {
  const tool = useCanvas(store, (s) => s.tool); const canUndo = useCanvas(store, (s) => s.canUndo), canRedo = useCanvas(store, (s) => s.canRedo); const readOnly = useCanvas(store, (s) => s.readOnly);
  const add = (kind: M.NodeKind, extra: Partial<CanvasNode> = {}, then?: "edit" | "form") => { const id = A.addCard(store, kind, extra, undefined, { centre: true }); if (!id) return; if (then === "edit") store.edit(id); else if (then === "form") cmd.form(id); };
  return (
    <div className="cv-bar" data-pos="top" data-cv-ui role="toolbar" aria-label="Canvas tools" data-testid="canvas-toolbar">
      <Btn label="Select" kbd="V" aria-pressed={tool === "select"} onClick={() => store.setTool("select")}><MousePointer2 /></Btn>
      <Btn label="Pan" kbd="H or hold Space" aria-pressed={tool === "hand"} onClick={() => store.setTool("hand")}><Hand /></Btn>
      {!readOnly && <>
        <Btn label="Draw" kbd="D" aria-pressed={tool === "draw"} onClick={() => store.setTool(tool === "draw" ? "select" : "draw")}><PenLine /></Btn>
        <Sep />
        <Btn label="Add text" kbd="T" onClick={() => add("text", {}, "edit")}><Type /></Btn>
        <Menu><MenuTrigger asChild><button type="button" className="cv-btn" aria-label="Add shape" title="Add shape (S)"><Shapes /></button></MenuTrigger>
          <MenuContent align="start"><MenuItem onSelect={() => add("shape", { shape: "rect" })}><Square /> Rectangle</MenuItem><MenuItem onSelect={() => add("shape", { shape: "ellipse" })}><Circle /> Ellipse</MenuItem><MenuItem onSelect={() => add("shape", { shape: "diamond" })}><Diamond /> Diamond</MenuItem></MenuContent></Menu>
        <Btn label="Add page card" onClick={() => add("page", {}, "form")}><FileText /></Btn>
        <Btn label="Add link" onClick={() => add("link", {}, "form")}><Globe /></Btn>
        <Btn label="Add image or PDF" onClick={cmd.addFilesDialog}><Upload /></Btn>
        <Btn label="Add reference" onClick={() => add("reference", {}, "form")}><BookMarked /></Btn>
        <Btn label="Add formula" onClick={() => add("math", {}, "edit")}><Sigma /></Btn>
        <Btn label="Add table" onClick={() => add("table", {}, "edit")}><Table2 /></Btn>
        <Sep />
        <Btn label="Undo" kbd="⌘Z" disabled={!canUndo} onClick={() => store.undo()}><Undo2 /></Btn>
        <Btn label="Redo" kbd="⇧⌘Z" disabled={!canRedo} onClick={() => store.redo()}><Redo2 /></Btn>
        <Btn label="Tidy up" onClick={cmd.tidy}><LayoutGrid /><span className="max-lg:hidden">Tidy up</span></Btn>
      </>}
      <Sep />
      <Menu><MenuTrigger asChild><button type="button" className="cv-btn" aria-label="Export" title="Export"><Download /></button></MenuTrigger>
        <MenuContent><MenuItem onSelect={() => cmd.exportAs("png")}><Download /> Export as PNG</MenuItem><MenuItem onSelect={() => cmd.exportAs("svg")}><Download /> Export as SVG</MenuItem><MenuItem onSelect={() => cmd.exportAs("md")}><FileText /> Export as Markdown outline</MenuItem></MenuContent></Menu>
    </div>
  );
}

function Swatches({ value, onPick }: { value: string | null; onPick: (hex: string | null) => void }) {
  return <>
    <button type="button" className="cv-swatch" data-none aria-label="No colour" title="No colour" aria-pressed={!value} onClick={() => onPick(null)}><span /></button>
    {M.NODE_COLORS.map((c) => <button key={c.hex} type="button" className="cv-swatch" aria-label={c.name} title={c.name} aria-pressed={value?.toLowerCase() === c.hex} onClick={() => onPick(c.hex)}><span style={{ background: c.hex }} /></button>)}
  </>;
}
/** Contextual bar: the pen while drawing, else the tools of the selected cards or of the selected connection. */
export function SelectionBar({ store, cmd, ink, setInk, inkStrokes }: { store: CanvasStore; cmd: Commands; ink: InkStyle; setInk: (s: InkStyle) => void; inkStrokes: number }) {
  const selection = useCanvas(store, (s) => s.selection); const edgeId = useCanvas(store, (s) => s.edge); const doc = useCanvas(store, (s) => s.doc); const tool = useCanvas(store, (s) => s.tool); const readOnly = useCanvas(store, (s) => s.readOnly); const editing = useCanvas(store, (s) => s.editing);
  if (readOnly) return null;
  if (tool === "draw") return (
    <div className="cv-bar" data-pos="sel" data-cv-ui role="toolbar" aria-label="Pen" data-testid="canvas-ink-bar">
      {([["pen", "Pen", <PenLine key="p" />], ["marker", "Marker", <Brush key="m" />], ["highlighter", "Highlighter", <Highlighter key="h" />], ["eraser", "Eraser", <Eraser key="e" />]] as const).map(([t, label, icon]) => <Btn key={t} label={label} aria-pressed={ink.tool === t} onClick={() => setInk({ ...ink, tool: t, width: INK_WIDTHS[t][1] })}>{icon}</Btn>)}
      <Sep />
      {INK_COLORS.map((c) => <button key={c.hex} type="button" className="cv-swatch" aria-label={c.name} title={c.name} aria-pressed={ink.color === c.hex} disabled={ink.tool === "eraser"} onClick={() => setInk({ ...ink, color: c.hex })}><span style={{ background: c.hex }} /></button>)}
      <Sep />
      {INK_WIDTHS[ink.tool].map((w, i) => <Btn key={w} label={["Thin", "Medium", "Thick"][i]} aria-pressed={ink.width === w} onClick={() => setInk({ ...ink, width: w })}><span style={{ width: 4 + i * 4, height: 4 + i * 4, borderRadius: 999, background: "currentColor" }} /></Btn>)}
      <Sep />
      <Btn label="Undo stroke" disabled={!inkStrokes} onClick={cmd.inkUndo}><Undo2 /></Btn>
      <button type="button" className="cv-btn" data-active onClick={cmd.inkDone}><Check /> Done</button>
    </div>
  );
  const edge = edgeId ? M.edgeById(doc, edgeId) : null;
  if (edge) {
    const set = (patch: Partial<CanvasEdge>) => store.apply((d) => M.updateEdge(d, edge.id, patch)); const route = M.routeStyleOf(edge);
    return (
      <div className="cv-bar" data-pos="sel" data-cv-ui role="toolbar" aria-label="Connection" data-testid="canvas-edge-bar">
        <Btn label="Edit label" kbd="Enter" onClick={() => cmd.editEdgeLabel(edge.id)}><Pencil /><span>Label</span></Btn>
        <Sep />
        <Btn label="Arrow" aria-pressed={M.hasArrow(edge)} onClick={() => set({ kind: "arrow" })}><ArrowRight /></Btn>
        <Btn label="Plain line" aria-pressed={!M.hasArrow(edge)} onClick={() => set({ kind: "line" })}><Minus /></Btn>
        <Btn label="Reverse direction" onClick={() => set({ from: edge.to, to: edge.from })}><ArrowLeftRight /></Btn>
        <Sep />
        <Btn label="Straight" aria-pressed={route === "straight"} onClick={() => set({ route: undefined })}><MoveRight /></Btn>
        <Btn label="Right angles" aria-pressed={route === "orthogonal"} onClick={() => set({ route: "orthogonal" })}><CornerDownRight /></Btn>
        <Btn label="Curved" aria-pressed={route === "curved"} onClick={() => set({ route: "curved" })}><Spline /></Btn>
        <Sep />
        <Swatches value={typeof edge.color === "string" ? edge.color : null} onPick={(c) => A.setColor(store, c)} />
        <Sep />
        <Btn label="Delete connection" kbd="⌫" data-tone="danger" onClick={() => A.deleteSelection(store)}><Trash2 /></Btn>
      </div>
    );
  }
  if (!selection.length || editing) return null;
  const nodes = store.selectedNodes(); const color = nodes.every((n) => n.color === nodes[0]?.color) && typeof nodes[0]?.color === "string" ? (nodes[0].color as string) : null; const many = selection.length > 1;
  return (
    <div className="cv-bar" data-pos="sel" data-cv-ui role="toolbar" aria-label="Selection" data-testid="canvas-selection-bar">
      {!many && nodes[0] && M.isKnownKind(nodes[0].kind) && <><Btn label="Edit" kbd="Enter" onClick={() => cmd.openNode(nodes[0])}><Pencil /></Btn><Sep /></>}
      <Swatches value={color} onPick={(c) => A.setColor(store, c)} />
      <Sep />
      <Btn label="Bring to front" kbd="⇧⌘]" onClick={() => A.zOrder(store, "front")}><BringToFront /></Btn>
      <Btn label="Send to back" kbd="⇧⌘[" onClick={() => A.zOrder(store, "back")}><SendToBack /></Btn>
      {many && <>
        <Sep />
        <Menu><MenuTrigger asChild><button type="button" className="cv-btn" aria-label="Align and distribute" title="Align and distribute"><AlignStartVertical /><span>Align</span></button></MenuTrigger>
          <MenuContent align="start">
            <MenuItem onSelect={() => A.align(store, "left")}><AlignStartVertical /> Align left</MenuItem><MenuItem onSelect={() => A.align(store, "center")}><AlignCenterVertical /> Align centres</MenuItem><MenuItem onSelect={() => A.align(store, "right")}><AlignEndVertical /> Align right</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => A.align(store, "top")}><AlignStartHorizontal /> Align top</MenuItem><MenuItem onSelect={() => A.align(store, "middle")}><AlignCenterHorizontal /> Align middles</MenuItem><MenuItem onSelect={() => A.align(store, "bottom")}><AlignEndHorizontal /> Align bottom</MenuItem>
            <MenuSeparator />
            <MenuItem disabled={selection.length < 3} onSelect={() => A.distribute(store, "horizontal")}><AlignHorizontalSpaceAround /> Distribute horizontally</MenuItem><MenuItem disabled={selection.length < 3} onSelect={() => A.distribute(store, "vertical")}><AlignVerticalSpaceAround /> Distribute vertically</MenuItem>
          </MenuContent></Menu>
        <Btn label="Tidy up the selection" onClick={cmd.tidy}><LayoutGrid /></Btn>
      </>}
      <Sep />
      <Btn label="Duplicate" kbd="⌘D" onClick={() => A.duplicateSelection(store)}><CopyPlus /></Btn>
      <Btn label="Delete" kbd="⌫" data-tone="danger" onClick={() => A.deleteSelection(store)}><Trash2 /></Btn>
    </div>
  );
}

export function ZoomBar({ store }: { store: CanvasStore }) {
  const [zoom, setZoom] = React.useState(store.viewport.zoom);
  React.useEffect(() => store.onViewport((v) => setZoom(v.zoom)), [store]);
  return (
    <div className="cv-bar" data-pos="zoom" data-cv-ui role="group" aria-label="Zoom">
      <Btn label="Zoom out" kbd="−" onClick={() => A.zoomStep(store, 0.8)}><Minus /></Btn>
      <button type="button" className="cv-btn" style={{ minWidth: "3.25rem" }} aria-label={`Zoom ${Math.round(zoom * 100)} % — reset to 100 %`} title="Reset to 100 % (0)" data-testid="canvas-zoom" onClick={() => A.zoomReset(store)}>{Math.round(zoom * 100)} %</button>
      <Btn label="Zoom in" kbd="+" onClick={() => A.zoomStep(store, 1.25)}><Plus /></Btn>
      <Btn label="Zoom to fit" kbd="⇧1" onClick={() => A.zoomToFit(store)}><Maximize /></Btn>
    </div>
  );
}

/** Overview of the whole canvas with the visible region; click or drag to go there. Drawn on a small 2D canvas (cheap for thousands of cards). */
export function Minimap({ store }: { store: CanvasStore }) {
  const doc = useCanvas(store, (s) => s.doc); const ref = React.useRef<HTMLCanvasElement | null>(null); const map = React.useRef({ x: 0, y: 0, scale: 1, ox: 0, oy: 0 }); const raf = React.useRef(0);
  const draw = React.useCallback(() => {
    raf.current = 0; const c = ref.current; if (!c) return; const dpr = Math.min(2, window.devicePixelRatio || 1); const W = c.clientWidth, H = c.clientHeight; if (!W || !H) return;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext("2d"); if (!ctx) return; const css = getComputedStyle(c);
    const vis = M.visibleRect(store.viewport, store.size); const all = M.unionRects([...(M.contentBounds(store.doc) ? [M.contentBounds(store.doc)!] : []), vis])!;
    const pad = 8; const scale = Math.min((W - 2 * pad) / Math.max(1, all.w), (H - 2 * pad) / Math.max(1, all.h)); const ox = (W - all.w * scale) / 2, oy = (H - all.h * scale) / 2;
    map.current = { x: all.x, y: all.y, scale, ox, oy };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const muted = css.getPropertyValue("--fg-faint").trim() || "#888", accent = css.getPropertyValue("--accent").trim() || "#36c";
    for (const n of store.doc.nodes) { ctx.fillStyle = typeof n.color === "string" && /^#[0-9a-f]{6}$/i.test(n.color) ? n.color : muted; ctx.globalAlpha = 0.55; ctx.fillRect(ox + (n.x - all.x) * scale, oy + (n.y - all.y) * scale, Math.max(1.5, n.w * scale), Math.max(1.5, n.h * scale)); }
    ctx.globalAlpha = 1; ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.strokeRect(ox + (vis.x - all.x) * scale, oy + (vis.y - all.y) * scale, vis.w * scale, vis.h * scale);
    ctx.globalAlpha = 0.08; ctx.fillStyle = accent; ctx.fillRect(ox + (vis.x - all.x) * scale, oy + (vis.y - all.y) * scale, vis.w * scale, vis.h * scale); ctx.globalAlpha = 1;
  }, [store]);
  const schedule = React.useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(draw); }, [draw]);
  React.useEffect(() => { schedule(); }, [doc, schedule]);
  React.useEffect(() => { const off = store.onViewport(schedule); const ro = new ResizeObserver(schedule); if (ref.current) ro.observe(ref.current); return () => { off(); ro.disconnect(); cancelAnimationFrame(raf.current); raf.current = 0; }; }, [store, schedule]);
  const go = (e: React.PointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); const m = map.current; store.setViewport(M.centerOn(store.viewport, { x: m.x + (e.clientX - r.left - m.ox) / m.scale, y: m.y + (e.clientY - r.top - m.oy) / m.scale }, store.size)); };
  return <div className="cv-minimap" data-cv-ui data-testid="canvas-minimap" role="img" aria-label="Minimap: overview of the canvas. Click to move the view."
    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); go(e); }} onPointerMove={(e) => { if (e.buttons & 1 || e.pointerType === "touch") go(e); }}><canvas ref={ref} /></div>;
}

/** Items of the context menu for what is under the pointer: a card (the selection), a connection, or the empty canvas. */
export function ContextItems({ store, cmd, target }: { store: CanvasStore; cmd: Commands; target: { node: CanvasNode | null; edge: CanvasEdge | null; at: Point } }) {
  const st = store.get(); const Item = ({ onSelect, children, kbd, danger, disabled }: { onSelect: () => void; children: React.ReactNode; kbd?: string; danger?: boolean; disabled?: boolean }) => <ContextMenu.Item className="cv-menu-item" data-tone={danger ? "danger" : undefined} disabled={disabled} onSelect={onSelect}>{children}{kbd && <kbd>{kbd}</kbd>}</ContextMenu.Item>;
  const SepI = () => <ContextMenu.Separator className="cv-menu-sep" />;
  const exportItems = <><Item onSelect={() => cmd.exportAs("png")}><Download /> Export as PNG</Item><Item onSelect={() => cmd.exportAs("svg")}><Download /> Export as SVG</Item><Item onSelect={() => cmd.exportAs("md")}><FileText /> Export as Markdown outline</Item></>;
  if (st.readOnly) return <><Item onSelect={() => A.zoomToFit(store)}><Maximize /> Zoom to fit</Item><SepI />{exportItems}</>;
  if (target.edge) { const e = target.edge; const set = (patch: Partial<CanvasEdge>) => store.apply((d) => M.updateEdge(d, e.id, patch)); return <>
    <Item onSelect={() => cmd.editEdgeLabel(e.id)}><Pencil /> Edit label</Item>
    <Item onSelect={() => set({ kind: M.hasArrow(e) ? "line" : "arrow" })}>{M.hasArrow(e) ? <Minus /> : <ArrowRight />} {M.hasArrow(e) ? "Plain line" : "Arrow"}</Item>
    <Item onSelect={() => set({ from: e.to, to: e.from })}><ArrowLeftRight /> Reverse direction</Item>
    <SepI /><ContextMenu.Label className="cv-menu-label">Route</ContextMenu.Label>
    <Item onSelect={() => set({ route: undefined })}><MoveRight /> Straight</Item><Item onSelect={() => set({ route: "orthogonal" })}><CornerDownRight /> Right angles</Item><Item onSelect={() => set({ route: "curved" })}><Spline /> Curved</Item>
    <SepI /><Item danger onSelect={() => { store.selectEdge(e.id); A.deleteSelection(store); }} kbd="⌫"><Trash2 /> Delete connection</Item></>; }
  if (target.node) { const n = target.node; const many = st.selection.length > 1; return <>
    {!many && M.isKnownKind(n.kind) && <Item onSelect={() => cmd.openNode(n)} kbd="⏎"><Pencil /> {n.kind === "page" && typeof n.pageId === "string" ? "Open the note" : n.kind === "drawing" ? "Continue drawing" : "Edit"}</Item>}
    {!many && M.isKnownKind(n.kind) && n.kind !== "drawing" && <Item onSelect={() => cmd.form(n.id)}><Shapes /> Card details…</Item>}
    <Item onSelect={() => A.duplicateSelection(store)} kbd="⌘D"><CopyPlus /> Duplicate</Item>
    <Item onSelect={() => { const t = A.copySelection(store); if (t) void navigator.clipboard?.writeText(t).catch(() => {}); }} kbd="⌘C"><Copy /> Copy</Item>
    <Item onSelect={() => { const t = A.copySelection(store); if (t) void navigator.clipboard?.writeText(t).catch(() => {}); A.deleteSelection(store); }} kbd="⌘X"><Scissors /> Cut</Item>
    <SepI />
    <Item onSelect={() => A.zOrder(store, "front")} kbd="⇧⌘]"><BringToFront /> Bring to front</Item><Item onSelect={() => A.zOrder(store, "forward")} kbd="⌘]"><BringToFront /> Bring forward</Item>
    <Item onSelect={() => A.zOrder(store, "backward")} kbd="⌘["><SendToBack /> Send backward</Item><Item onSelect={() => A.zOrder(store, "back")} kbd="⇧⌘["><SendToBack /> Send to back</Item>
    {many && <><SepI /><Item onSelect={() => A.align(store, "left")}><AlignStartVertical /> Align left</Item><Item onSelect={() => A.align(store, "top")}><AlignStartHorizontal /> Align top</Item><Item disabled={st.selection.length < 3} onSelect={() => A.distribute(store, "horizontal")}><AlignHorizontalSpaceAround /> Distribute horizontally</Item><Item disabled={st.selection.length < 3} onSelect={() => A.distribute(store, "vertical")}><AlignVerticalSpaceAround /> Distribute vertically</Item><Item onSelect={cmd.tidy}><LayoutGrid /> Tidy up the selection</Item></>}
    <SepI /><ContextMenu.Label className="cv-menu-label">Colour</ContextMenu.Label>
    <div style={{ display: "flex", padding: "0 4px" }}><Swatches value={typeof n.color === "string" ? n.color : null} onPick={(c) => A.setColor(store, c)} /></div>
    <SepI /><Item danger onSelect={() => A.deleteSelection(store)} kbd="⌫"><Trash2 /> Delete</Item></>; }
  return <>
    <Item onSelect={() => { const id = A.addCard(store, "text", {}, target.at); if (id) cmd.openNode(M.nodeById(store.doc, id)!); }}><Type /> Add text here</Item>
    <Item onSelect={() => A.addCard(store, "shape", {}, target.at)}><Shapes /> Add shape here</Item>
    <Item onSelect={() => { const id = A.addCard(store, "page", {}, target.at); if (id) cmd.form(id); }}><FileText /> Add page card here</Item>
    <Item onSelect={() => cmd.pasteAt(target.at)} kbd="⌘V"><ClipboardPaste /> Paste here</Item>
    <SepI />
    <Item onSelect={() => A.selectAll(store)} kbd="⌘A"><MousePointer2 /> Select all</Item>
    <Item onSelect={cmd.tidy}><LayoutGrid /> Tidy up</Item>
    <Item onSelect={() => A.zoomToFit(store)} kbd="⇧1"><Maximize /> Zoom to fit</Item>
    <SepI />{exportItems}</>;
}

const reasonText: Record<M.ConflictReason, string> = { bothEdited: "Changed here and in another session", editedAndDeleted: "Changed on one side, deleted on the other", deletedButReferenced: "Deleted on one side, but a new connection uses it" };
function describe(v: unknown, kind: CanvasConflict["kind"], doc: M.CanvasData): string {
  if (v === undefined) return "Deleted";
  if (kind === "node") return M.nodeLabel(v as CanvasNode);
  if (kind === "edge") { const e = v as CanvasEdge; const a = M.nodeById(doc, e.from), b = M.nodeById(doc, e.to); return `${a ? M.nodeLabel(a) : "?"} → ${b ? M.nodeLabel(b) : "?"}${typeof e.label === "string" && e.label ? ` · ${e.label}` : ""}`; }
  return typeof v === "string" ? v : JSON.stringify(v).slice(0, 80);
}
/**
 * Review of what a merge could not settle. Non-blocking: the canvas stays editable, the panel can be closed and nothing is lost —
 * the canvas holds this device's version (or the surviving one); "Keep theirs" swaps in the other session's version.
 */
export function ReviewPanel({ store, conflicts, onKeep, onDismissAll }: { store: CanvasStore; conflicts: CanvasConflict[]; onKeep: (c: CanvasConflict, side: "mine" | "theirs") => void; onDismissAll: () => void }) {
  const doc = useCanvas(store, (s) => s.doc);
  if (!conflicts.length) return null;
  return (
    <section className="cv-review" data-cv-ui role="region" aria-label="Changes to review" data-testid="canvas-review">
      <div className="cv-review-head"><TriangleAlert aria-hidden /><div className="min-w-0 flex-1"><b>{conflicts.length} change{conflicts.length > 1 ? "s" : ""} to review</b><span>This canvas was also edited in another session. Everything else was merged; nothing was lost. Your version is on the canvas.</span></div>
        <button type="button" className="cv-btn" aria-label="Keep my version of everything and close" title="Keep mine for all" onClick={onDismissAll}><X /></button></div>
      <div className="cv-review-list">
        {conflicts.map((c) => (
          <div key={`${c.kind}:${c.id}`} className="cv-review-item" data-testid="canvas-conflict" data-kind={c.kind} data-reason={c.reason}>
            <b>{c.kind === "field" ? `Canvas setting “${c.id}”` : describe(c.local ?? c.remote ?? c.base, c.kind, doc)}</b><span>{reasonText[c.reason]}</span>
            <div className="cv-review-versions"><div><i>This device</i><p>{describe(c.local, c.kind, doc)}</p></div><div><i>Other session</i><p>{describe(c.remote, c.kind, doc)}</p></div></div>
            <div className="cv-review-actions">
              {c.kind === "node" && M.nodeById(doc, c.id) && <button type="button" onClick={() => { store.select([c.id]); A.revealNode(store, c.id); }}>Show</button>}
              <button type="button" data-primary onClick={() => onKeep(c, "mine")}>Keep mine</button><button type="button" onClick={() => onKeep(c, "theirs")}>Keep theirs</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
