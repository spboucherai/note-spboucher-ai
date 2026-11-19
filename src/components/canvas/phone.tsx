"use client";
/**
 * file: src/components/canvas/phone.tsx
 * description: the touch interface of the canvas on phones — not a shrunken desktop: a bottom dock with large targets (add, undo,
 *   fit; and for the selection: edit, connect, duplicate, delete), a bottom sheet to add cards, pen controls, and an OUTLINE mode that
 *   lists every card (open, edit, reorder, locate, see its connections) for when a list is easier than a map. No hover-only affordance.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { ArrowDown, ArrowUp, Check, CopyPlus, Eraser, LocateFixed, Maximize, PenLine, Pencil, Plus, Redo2, Trash2, Type, Undo2, Upload, Waypoints, LayoutGrid, Download, FileText } from "lucide-react";
import { Dialog, SheetContent } from "@/components/ui/primitives";
import * as M from "@/lib/canvas/model";
import type { CanvasNode } from "@/lib/canvas/model";
import { useCanvas, type CanvasStore } from "./store";
import type { InkStyle } from "./CanvasSurface";
import { INK_COLORS, INK_WIDTHS, type Commands } from "./chrome";
import { KIND_ICON, KIND_LABEL, usePageLite, useRefLite } from "./NodeView";
import * as A from "./actions";

const DockBtn = ({ label, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) => <button type="button" className="cv-dock-btn" aria-label={label} {...p}>{children}<span aria-hidden>{label}</span></button>;

export function PhoneDock({ store, cmd, ink, setInk, inkStrokes, onAdd, onConnect, onMore }: { store: CanvasStore; cmd: Commands; ink: InkStyle; setInk: (s: InkStyle) => void; inkStrokes: number; onAdd: () => void; onConnect: (id: string) => void; onMore: () => void }) {
  const selection = useCanvas(store, (s) => s.selection); const edge = useCanvas(store, (s) => s.edge); const tool = useCanvas(store, (s) => s.tool); const canUndo = useCanvas(store, (s) => s.canUndo), canRedo = useCanvas(store, (s) => s.canRedo); const readOnly = useCanvas(store, (s) => s.readOnly);
  if (readOnly) return <div className="cv-dock" data-cv-ui role="toolbar" aria-label="Canvas"><DockBtn label="Fit" onClick={() => A.zoomToFit(store)}><Maximize /></DockBtn><span className="cv-dock-grow" /><DockBtn label="Export" onClick={onMore}><Download /></DockBtn></div>;
  if (tool === "draw") return (
    <div className="cv-dock" data-cv-ui role="toolbar" aria-label="Pen" data-testid="canvas-dock">
      <DockBtn label="Pen" aria-pressed={ink.tool === "pen"} onClick={() => setInk({ ...ink, tool: "pen", width: INK_WIDTHS.pen[1] })}><PenLine /></DockBtn>
      <DockBtn label="Eraser" aria-pressed={ink.tool === "eraser"} onClick={() => setInk({ ...ink, tool: "eraser", width: INK_WIDTHS.eraser[1] })}><Eraser /></DockBtn>
      {INK_COLORS.slice(0, 5).map((c) => <button key={c.hex} type="button" className="cv-dock-btn" aria-label={c.name} aria-pressed={ink.color === c.hex && ink.tool !== "eraser"} onClick={() => setInk({ ...ink, tool: ink.tool === "eraser" ? "pen" : ink.tool, color: c.hex })}><span style={{ width: 22, height: 22, borderRadius: 999, background: c.hex, border: "1px solid color-mix(in oklab, var(--fg) 20%, transparent)" }} /></button>)}
      <span className="cv-dock-grow" />
      <DockBtn label="Undo" disabled={!inkStrokes} onClick={cmd.inkUndo}><Undo2 /></DockBtn>
      <DockBtn label="Done" data-primary onClick={cmd.inkDone}><Check /></DockBtn>
    </div>
  );
  const one = selection.length === 1 ? M.nodeById(store.doc, selection[0]) : null;
  return (
    <div className="cv-dock" data-cv-ui role="toolbar" aria-label="Canvas" data-testid="canvas-dock">
      <DockBtn label="Add" data-primary onClick={onAdd}><Plus /></DockBtn>
      {edge ? <>
        <DockBtn label="Label" onClick={() => cmd.editEdgeLabel(edge)}><Type /></DockBtn>
        <DockBtn label="Delete" data-tone="danger" onClick={() => A.deleteSelection(store)}><Trash2 /></DockBtn>
      </> : selection.length ? <>
        {one && <DockBtn label="Edit" onClick={() => cmd.form(one.id)}><Pencil /></DockBtn>}
        {one && <DockBtn label="Connect" onClick={() => onConnect(one.id)}><Waypoints /></DockBtn>}
        <DockBtn label="Copy" onClick={() => A.duplicateSelection(store)}><CopyPlus /></DockBtn>
        <DockBtn label="Delete" data-tone="danger" onClick={() => A.deleteSelection(store)}><Trash2 /></DockBtn>
      </> : null}
      <span className="cv-dock-grow" />
      <DockBtn label="Undo" disabled={!canUndo} onClick={() => store.undo()}><Undo2 /></DockBtn>
      <DockBtn label="Redo" disabled={!canRedo} onClick={() => store.redo()}><Redo2 /></DockBtn>
      <DockBtn label="Fit" onClick={() => A.zoomToFit(store)}><Maximize /></DockBtn>
      <DockBtn label="More" onClick={onMore}><LayoutGrid /></DockBtn>
    </div>
  );
}

/** Bottom sheet: the kinds of cards, as large buttons. */
export function AddSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (kind: M.NodeKind | "file", extra?: Partial<CanvasNode>) => void }) {
  const items: [M.NodeKind | "file", string, React.ReactNode, Partial<CanvasNode>?][] = [["text", "Text", KIND_ICON.text], ["page", "Page", <FileText key="p" />], ["file", "Image or PDF", <Upload key="u" />], ["link", "Link", KIND_ICON.link], ["drawing", "Drawing", KIND_ICON.drawing], ["shape", "Shape", KIND_ICON.shape], ["reference", "Reference", KIND_ICON.reference], ["math", "Formula", KIND_ICON.math], ["table", "Table", KIND_ICON.table]];
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent title="Add to the canvas" description="The card is placed in the middle of the view." data-cv-ui data-testid="canvas-add-sheet" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="cv-add-grid">{items.map(([kind, label, icon, extra]) => <button key={label} type="button" onClick={() => onPick(kind, extra)}>{icon}{label}</button>)}</div>
      </SheetContent>
    </Dialog>
  );
}
/** Bottom sheet: actions on the whole canvas (tidy, export). */
export function MoreSheet({ open, onClose, cmd, readOnly }: { open: boolean; onClose: () => void; cmd: Commands; readOnly: boolean }) {
  const run = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent title="Canvas" data-cv-ui onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="cv-add-grid">
          {!readOnly && <button type="button" onClick={run(cmd.tidy)}><LayoutGrid />Tidy up</button>}
          <button type="button" onClick={run(() => cmd.exportAs("png"))}><Download />PNG</button>
          <button type="button" onClick={run(() => cmd.exportAs("svg"))}><Download />SVG</button>
          <button type="button" onClick={run(() => cmd.exportAs("md"))}><FileText />Markdown</button>
        </div>
      </SheetContent>
    </Dialog>
  );
}

function OutlineRow({ node, index, count, selected, links, store, onOpen, onLocate }: { node: CanvasNode; index: number; count: number; selected: boolean; links: { out: number; in: number }; store: CanvasStore; onOpen: () => void; onLocate: () => void }) {
  const page = usePageLite(node.kind === "page" && typeof node.pageId === "string" ? node.pageId : null); const ref = useRefLite(node.kind === "reference" && typeof node.refId === "string" ? node.refId : null);
  const label = M.nodeLabel(node, (id) => (id === node.pageId ? page.data?.title : id === node.refId ? ref.data?.title : undefined));
  const known = M.isKnownKind(node.kind); const color = typeof node.color === "string" && /^#[0-9a-f]{6}$/i.test(node.color) ? node.color : undefined; const readOnly = store.get().readOnly;
  return (
    <li className="cv-outline-row" data-selected={selected || undefined} data-testid="canvas-outline-row" data-id={node.id} style={color ? ({ "--cv-color": color } as React.CSSProperties) : undefined}>
      <button type="button" className="cv-outline-main" onClick={onOpen} aria-label={`${known ? KIND_LABEL[node.kind as M.NodeKind] : "Unsupported card"}: ${label}`}>
        <span className="cv-outline-kind" aria-hidden>{known ? KIND_ICON[node.kind as M.NodeKind] : "?"}</span>
        <span className="cv-outline-text"><b>{label}</b><span>{known ? KIND_LABEL[node.kind as M.NodeKind] : `Unsupported (${node.kind})`}{links.out ? ` · → ${links.out}` : ""}{links.in ? ` · ← ${links.in}` : ""}</span></span>
      </button>
      <div className="cv-outline-tools">
        {!readOnly && <><button type="button" aria-label={`Move “${label}” up`} disabled={index === 0} onClick={() => store.apply((d) => M.reorderNode(d, node.id, index - 1))}><ArrowUp /></button>
        <button type="button" aria-label={`Move “${label}” down`} disabled={index === count - 1} onClick={() => store.apply((d) => M.reorderNode(d, node.id, index + 1))}><ArrowDown /></button></>}
        <button type="button" aria-label={`Show “${label}” on the canvas`} onClick={onLocate}><LocateFixed /></button>
      </div>
    </li>
  );
}
/** Outline / list mode: every card in the order of the document, with its kind and its connections. */
export function Outline({ store, onOpen, onLocate }: { store: CanvasStore; onOpen: (n: CanvasNode) => void; onLocate: (n: CanvasNode) => void }) {
  const doc = useCanvas(store, (s) => s.doc); const selection = useCanvas(store, (s) => s.selection);
  const links = React.useMemo(() => { const m = new Map<string, { out: number; in: number }>(); const at = (id: string) => { let v = m.get(id); if (!v) { v = { out: 0, in: 0 }; m.set(id, v); } return v; }; for (const e of doc.edges) { at(e.from).out++; at(e.to).in++; } return m; }, [doc.edges]);
  if (!doc.nodes.length) return <div className="cv-outline" data-testid="canvas-outline"><div className="cv-outline-empty">No card yet. Tap + to add one.</div></div>;
  return (
    <div className="cv-outline" data-testid="canvas-outline" data-cv-scroll>
      <ul aria-label="Cards of the canvas">
        {doc.nodes.map((n, i) => <OutlineRow key={n.id} node={n} index={i} count={doc.nodes.length} selected={selection.includes(n.id)} links={links.get(n.id) ?? { out: 0, in: 0 }} store={store} onOpen={() => onOpen(n)} onLocate={() => onLocate(n)} />)}
      </ul>
    </div>
  );
}
