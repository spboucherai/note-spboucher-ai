"use client";
/**
 * file: src/components/editor/nodes/DrawingView.tsx
 * description: node view of the `drawing` block (SPEC §2). In the page it shows the PNG preview; "Edit" opens a vector ink editor in a
 *   sheet: one canvas driven by pointer events (mouse, finger, stylus with real pressure), pen / marker / highlighter / stroke eraser,
 *   colours, widths, undo / redo. Saving uploads the `spn-ink-1` JSON and a 2× PNG render, then writes `ink`, `preview`, `width`,
 *   `height` and `pk: null` (the native PencilKit data no longer matches). Nothing is drawn or measured until the sheet is opened.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { Brush, Eraser, Highlighter, PenLine, Pencil, Redo2, Trash2, Undo2 } from "lucide-react";
import { Dialog, SheetContent, Spinner } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { fileUrl, uploadBlob } from "@/lib/client/upload";
import type { DrawingAttrs } from "@/lib/editor/next-node-defs";
import { backgroundFill, drawInk, drawStroke, emptyInk, eraseAt, parseInk, serializeInk, simplifyStroke, type InkDoc, type InkPoint, type InkStroke, type InkTool } from "@/lib/editor/ink";
import { NodeButton, NodeFrame, NodeState, type LeafViewProps } from "./frame";

const DEFAULT_W = 1200, DEFAULT_H = 800;
type Tool = InkTool | "eraser";
/** Stroke colours (content, not chrome). "Ink" is a mid slate that stays readable on the light and on the dark page. */
const COLORS: { name: string; hex: string }[] = [
  { name: "Ink", hex: "#64748b" }, { name: "Black", hex: "#111827" }, { name: "Red", hex: "#dc2626" }, { name: "Orange", hex: "#ea580c" },
  { name: "Yellow", hex: "#eab308" }, { name: "Green", hex: "#16a34a" }, { name: "Blue", hex: "#2563eb" }, { name: "Purple", hex: "#9333ea" },
];
/** Widths in canvas units per tool (for the eraser: its radius). */
const WIDTHS: Record<Tool, [number, number, number]> = { pen: [3, 5, 9], marker: [7, 11, 17], highlighter: [16, 26, 40], eraser: [8, 16, 30] };
const WIDTH_NAMES = ["Thin", "Medium", "Thick"] as const;
const TOOLS: { tool: Tool; label: string; icon: React.ReactNode }[] = [
  { tool: "pen", label: "Pen", icon: <PenLine /> }, { tool: "marker", label: "Marker", icon: <Brush /> }, { tool: "highlighter", label: "Highlighter", icon: <Highlighter /> }, { tool: "eraser", label: "Eraser", icon: <Eraser /> },
];
const HISTORY_LIMIT = 200;

export function DrawingView({ attrs, update, editable, selected, pageId }: LeafViewProps<DrawingAttrs>) {
  const [open, setOpen] = React.useState(false);
  const [broken, setBroken] = React.useState<string | null>(null);
  const has = !!(attrs.ink || attrs.preview), w = attrs.width > 0 ? attrs.width : DEFAULT_W, h = attrs.height > 0 ? attrs.height : DEFAULT_H;
  return (
    <NodeFrame kind="drawing" icon={<PenLine />} label="Drawing" selected={selected} actions={editable && has ? <NodeButton label="Edit" text onClick={() => setOpen(true)}><Pencil /></NodeButton> : undefined}>
      {attrs.preview && broken !== attrs.preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated attachment, intrinsic size known, no optimiser
        <img className="dr-preview" src={fileUrl(attrs.preview)} width={w} height={h} alt="Drawing" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(attrs.preview)} />
      ) : has ? (
        <NodeState icon={<PenLine />} title="Preview unavailable" hint={attrs.preview ? "The image of this drawing could not be loaded." : "This drawing has no image yet."} tone={attrs.preview ? "danger" : "neutral"} />
      ) : (
        <NodeState icon={<PenLine />} title="Empty drawing" hint={editable ? "Sketch with a mouse, a finger or a stylus." : undefined}>
          {editable && <NodeButton label="Draw" text tone="accent" onClick={() => setOpen(true)}><PenLine /></NodeButton>}
        </NodeState>
      )}
      {open && editable && <InkDialog attrs={attrs} pageId={pageId} onClose={() => setOpen(false)} onSaved={(patch) => { update(patch); setOpen(false); }} />}
    </NodeFrame>
  );
}

type Phase = { state: "loading" } | { state: "ready" } | { state: "error"; message: string };
interface Gesture { id: number; left: number; top: number; live: InkStroke | null; /** eraser: the document when the gesture began */ before: InkDoc | null; last: [number, number] }

function InkDialog({ attrs, pageId, onClose, onSaved }: { attrs: DrawingAttrs; pageId: string | null; onClose: () => void; onSaved: (patch: Partial<DrawingAttrs>) => void }) {
  const [phase, setPhase] = React.useState<Phase>({ state: "loading" });
  const [tool, setTool] = React.useState<Tool>("pen");
  const [color, setColor] = React.useState(COLORS[0].hex);
  const [size, setSize] = React.useState(1);
  const [saving, setSaving] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [, setRev] = React.useState(0);
  const doc = React.useRef<InkDoc>(emptyInk(DEFAULT_W, DEFAULT_H)), initial = React.useRef<InkDoc>(doc.current);
  const past = React.useRef<InkDoc[]>([]), future = React.useRef<InkDoc[]>([]);
  const canvas = React.useRef<HTMLCanvasElement | null>(null), stage = React.useRef<HTMLDivElement | null>(null), cache = React.useRef<HTMLCanvasElement | null>(null);
  const geom = React.useRef({ css: 1, px: 1 }), gesture = React.useRef<Gesture | null>(null), raf = React.useRef(0), alive = React.useRef(true);
  const style = React.useRef({ tool, color, size }); style.current = { tool, color, size };
  const paper = backgroundFill(attrs.background);
  const bump = () => setRev((n) => n + 1);

  // ---- painting: committed strokes live in an offscreen cache, a frame = cache + the stroke being drawn ----
  const rebuild = React.useCallback(() => {
    const c = canvas.current; if (!c) return;
    const off = (cache.current ??= document.createElement("canvas")); if (off.width !== c.width || off.height !== c.height) { off.width = c.width; off.height = c.height; }
    const ctx = off.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, off.width, off.height); if (paper) { ctx.fillStyle = paper; ctx.fillRect(0, 0, off.width, off.height); }
    drawInk(ctx, doc.current, geom.current.px);
  }, [paper]);
  const paint = React.useCallback(() => {
    raf.current = 0; const c = canvas.current, ctx = c?.getContext("2d"); if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height); if (cache.current && cache.current.width > 0) ctx.drawImage(cache.current, 0, 0);
    const g = gesture.current; if (!g) return;
    if (g.live) drawStroke(ctx, g.live, geom.current.px);
    else { ctx.save(); ctx.beginPath(); ctx.arc(g.last[0] * geom.current.px, g.last[1] * geom.current.px, WIDTHS.eraser[style.current.size] * geom.current.px, 0, Math.PI * 2); ctx.lineWidth = Math.max(1, geom.current.px / geom.current.css); ctx.strokeStyle = "#8a8f98"; ctx.stroke(); ctx.restore(); }
  }, []);
  const schedule = React.useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(paint); }, [paint]);
  const refresh = React.useCallback(() => { rebuild(); schedule(); }, [rebuild, schedule]);

  // ---- load the existing ink (never start blank over a drawing that cannot be read) ----
  React.useEffect(() => {
    alive.current = true; const ac = new AbortController();
    (async () => {
      if (!attrs.ink) {
        if (attrs.preview) return setPhase({ state: "error", message: "This drawing has an image but no editable ink data, so it cannot be edited here." });
        doc.current = initial.current = emptyInk(DEFAULT_W, DEFAULT_H); return setPhase({ state: "ready" });
      }
      try {
        const r = await fetch(fileUrl(attrs.ink), { credentials: "same-origin", signal: ac.signal });
        if (!r.ok) throw new Error(r.status === 404 ? "The ink file of this drawing no longer exists." : `The ink file could not be loaded (${r.status}).`);
        const parsed = parseInk(await r.text()); if (ac.signal.aborted) return;
        doc.current = initial.current = parsed; setPhase({ state: "ready" });
      } catch (e) { if (!ac.signal.aborted) setPhase({ state: "error", message: e instanceof Error ? e.message : "The ink file could not be read." }); }
    })();
    return () => { alive.current = false; ac.abort(); if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [attrs.ink, attrs.preview]);

  // ---- size: canvas units → CSS px (fit width and the visible height) → device px; measured only when the stage resizes ----
  const ready = phase.state === "ready";
  React.useLayoutEffect(() => {
    const el = stage.current, c = canvas.current; if (!ready || !el || !c) return;
    const fit = (avail: number) => {
      if (!(avail > 0)) return; const W = doc.current.width, H = doc.current.height, dpr = Math.min(3, window.devicePixelRatio || 1);
      const room = Math.max(160, (window.visualViewport?.height ?? window.innerHeight) - 270), css = Math.min(avail / W, room / H), cw = Math.max(1, Math.floor(W * css)), ch = Math.max(1, Math.floor(H * css));
      const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr); if (c.width === pw && c.height === ph) return;
      c.style.width = `${cw}px`; c.style.height = `${ch}px`; c.width = pw; c.height = ph; geom.current = { css: cw / W, px: pw / W }; rebuild(); paint();
    };
    fit(el.clientWidth);
    const ro = new ResizeObserver((entries) => fit(entries[0].contentRect.width)); ro.observe(el);
    return () => ro.disconnect();
  }, [ready, rebuild, paint]);

  // ---- history ----
  const commit = (next: InkDoc, before: InkDoc = doc.current) => { if (next === before) return; past.current.push(before); if (past.current.length > HISTORY_LIMIT) past.current.shift(); future.current = []; doc.current = next; setConfirm(false); bump(); refresh(); };
  const undo = () => { const p = past.current.pop(); if (!p || gesture.current) return; future.current.push(doc.current); doc.current = p; bump(); refresh(); };
  const redo = () => { const f = future.current.pop(); if (!f || gesture.current) return; past.current.push(doc.current); doc.current = f; bump(); refresh(); };
  const clear = () => { if (doc.current.strokes.length && !gesture.current) commit({ ...doc.current, strokes: [] }); };
  const dirty = doc.current !== initial.current;

  // ---- pointer input ----
  const at = (g: Gesture, e: { clientX: number; clientY: number; pressure: number; pointerType: string }): InkPoint => {
    const d = doc.current, x = Math.max(0, Math.min(d.width, (e.clientX - g.left) / geom.current.css)), y = Math.max(0, Math.min(d.height, (e.clientY - g.top) / geom.current.css));
    let p = e.pressure; if (!(p > 0) || (e.pointerType === "touch" && p >= 1)) p = 0.5; // no force sensor → nominal width
    return [x, y, Math.min(1, p)];
  };
  const erase = (g: Gesture, pts: InkPoint[]) => { const next = eraseAt(doc.current, pts, WIDTHS.eraser[style.current.size]); if (next !== doc.current) { doc.current = next; rebuild(); } };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (gesture.current || saving || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault(); const c = e.currentTarget; try { c.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const r = c.getBoundingClientRect(), s = style.current, g: Gesture = { id: e.pointerId, left: r.left, top: r.top, live: null, before: null, last: [0, 0] }, p = at(g, e); g.last = [p[0], p[1]];
    if (s.tool === "eraser") { g.before = doc.current; erase(g, [p]); }
    else g.live = { tool: s.tool, color: `${s.color}${s.tool === "highlighter" ? "59" : "ff"}`, width: WIDTHS[s.tool][s.size], points: [p] };
    gesture.current = g; schedule();
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current; if (!g || g.id !== e.pointerId) return;
    const native = e.nativeEvent, batch = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : []; const events = batch.length ? batch : [native];
    for (const ev of events) {
      const p = at(g, ev); if (Math.hypot(p[0] - g.last[0], p[1] - g.last[1]) < 0.35) continue;
      if (g.live) g.live.points.push(p); else erase(g, [[g.last[0], g.last[1], 0.5], p]);
      g.last = [p[0], p[1]];
    }
    schedule();
  };
  const finish = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const g = gesture.current; if (!g || g.id !== e.pointerId) return;
    gesture.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (g.live) { if (!cancelled) commit({ ...doc.current, strokes: [...doc.current.strokes, { ...g.live, points: simplifyStroke(g.live.points, 0.3) }] }); else schedule(); }
    else if (g.before) { if (cancelled) { doc.current = g.before; refresh(); } else if (doc.current !== g.before) { const after = doc.current; doc.current = g.before; commit(after, g.before); } else schedule(); }
  };

  // ---- save ----
  const save = async () => {
    if (saving || gesture.current) return; setSaving(true);
    try {
      const d = doc.current, ts = Date.now(), png = await renderPng(d, paper);
      const [ink, preview] = await Promise.all([uploadBlob(serializeInk(d), `drawing-${ts}.ink.json`, "application/json", pageId), uploadBlob(png, `drawing-${ts}.png`, "image/png", pageId)]);
      if (alive.current) onSaved({ ink: ink.id, preview: preview.id, pk: null, width: Math.round(d.width), height: Math.round(d.height) });
    } catch (e) {
      toast("Drawing not saved", { description: `${e instanceof Error ? e.message : "Upload failed"} — your strokes are still here, try again.`, tone: "danger" });
      if (alive.current) setSaving(false);
    }
  };
  const requestClose = () => { if (saving) return; if (dirty && !confirm) setConfirm(true); else onClose(); };
  const onKey = (e: React.KeyboardEvent) => { if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || !ready) return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); };

  const n = doc.current.strokes.length;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent title={attrs.ink ? "Edit drawing" : "New drawing"} className="sm:w-[min(60rem,calc(100vw-2rem))] sm:max-h-[94dvh]" onCloseAutoFocus={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} onKeyDown={onKey}>
        {phase.state === "loading" && <div className="flex items-center gap-2 py-10 text-ui text-fg-muted" role="status"><Spinner /> Loading the drawing…</div>}
        {phase.state === "error" && (
          <div className="py-4">
            <NodeState icon={<PenLine />} tone="danger" title="This drawing cannot be edited" hint={`${phase.message} Nothing was changed.`} />
            <div className="mt-3 flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
          </div>
        )}
        {ready && (
          <div className="dr-editor">
            <div className="dr-tools" role="toolbar" aria-label="Drawing tools">
              <div className="dr-group">{TOOLS.map((t) => <NodeButton key={t.tool} label={t.label} active={tool === t.tool} onClick={() => setTool(t.tool)}>{t.icon}</NodeButton>)}</div>
              <div className="dr-group" role="group" aria-label="Colour">
                {COLORS.map((c) => <button key={c.hex} type="button" className="dr-swatch" title={c.name} aria-label={c.name} aria-pressed={color === c.hex} disabled={tool === "eraser"} onClick={() => setColor(c.hex)}><span style={{ background: c.hex }} /></button>)}
              </div>
              <div className="dr-group" role="group" aria-label="Width">
                {WIDTH_NAMES.map((name, i) => <NodeButton key={name} label={name} active={size === i} onClick={() => setSize(i)}><span className="dr-dot" style={{ width: 4 + i * 4, height: 4 + i * 4 }} /></NodeButton>)}
              </div>
              <div className="dr-group">
                <NodeButton label="Undo" disabled={!past.current.length} onClick={undo}><Undo2 /></NodeButton>
                <NodeButton label="Redo" disabled={!future.current.length} onClick={redo}><Redo2 /></NodeButton>
                <NodeButton label="Clear" tone="danger" disabled={!n} onClick={clear}><Trash2 /></NodeButton>
              </div>
            </div>
            <div ref={stage} className="dr-stage">
              <canvas ref={canvas} data-testid="ink-canvas" className="dr-canvas" data-tool={tool} aria-label="Drawing surface" style={{ touchAction: "none", background: paper ?? undefined }}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={(e) => finish(e, false)} onPointerCancel={(e) => finish(e, true)} onContextMenu={(e) => e.preventDefault()} />
            </div>
            <div className="dr-foot">
              {confirm ? (
                <><span className="min-w-0 flex-1 text-ui text-fg" role="alert">Discard the changes to this drawing?</span><Button variant="secondary" onClick={() => setConfirm(false)}>Keep editing</Button><Button variant="danger" onClick={onClose}>Discard</Button></>
              ) : (
                <><span className="nb-meta min-w-0 flex-1" aria-live="polite">{n} stroke{n === 1 ? "" : "s"}{dirty ? " · unsaved" : ""}</span><Button variant="ghost" onClick={requestClose} disabled={saving}>Cancel</Button>
                  <Button onClick={save} disabled={saving || !dirty} aria-label="Save drawing">{saving && <Spinner className="size-3.5" />}Save drawing</Button></>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Dialog>
  );
}

/** PNG of the strokes at 2× (less for a very large canvas, to stay under mobile canvas limits); transparent unless there is paper. */
function renderPng(doc: InkDoc, paper: string | null): Promise<Blob> {
  const scale = Math.min(2, Math.sqrt(16_000_000 / Math.max(1, doc.width * doc.height)));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(doc.width * scale)); c.height = Math.max(1, Math.round(doc.height * scale));
  const ctx = c.getContext("2d"); if (!ctx) return Promise.reject(new Error("This browser could not render the drawing"));
  if (paper) { ctx.fillStyle = paper; ctx.fillRect(0, 0, c.width, c.height); }
  drawInk(ctx, doc, c.width / doc.width);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("This browser could not render the drawing"))), "image/png"));
}
