"use client";
/**
 * file: src/components/canvas/forms.tsx
 * description: the "card details" sheet (bottom sheet on phones, dialog on desktop) — the fields of a card by kind: text, shape,
 *   formula, table, link, page (search and pick), reference (pick from the library), image / PDF (choose a file), plus colour and
 *   stacking. On a phone it is how every card is edited (large fields, no hover). Changes apply live and count as one undo step.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import katex from "katex";
import { useQuery } from "@tanstack/react-query";
import { BringToFront, Circle, CopyPlus, Diamond, ExternalLink, PenLine, Search, SendToBack, Square, Trash2, Upload, Waypoints } from "lucide-react";
import { Dialog, SheetContent, Spinner } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { fileUrl, uploadFile } from "@/lib/client/upload";
import * as M from "@/lib/canvas/model";
import type { CanvasNode } from "@/lib/canvas/model";
import { useCanvas, type CanvasStore } from "./store";
import { KIND_LABEL, TableBody, safeHref, usePageLite, useRefLite, type RefLite } from "./NodeView";
import { imageSize } from "./resources";
import * as A from "./actions";

const str = (v: unknown) => (typeof v === "string" ? v : "");
interface Hit { id: string; title: string; icon: string | null; type?: string }

function PagePicker({ value, self, onPick }: { value: string | null; self: string; onPick: (id: string) => void }) {
  const [q, setQ] = React.useState(""); const cur = usePageLite(value);
  const hits = useQuery({ queryKey: ["canvas-page-search", q], staleTime: 10_000, queryFn: () => api<Hit[]>(`/api/search?mode=quick&q=${encodeURIComponent(q)}&limit=12`) });
  return (
    <div className="cv-form">
      {value && <div className="text-ui text-fg-muted">Current: <b className="text-fg">{cur.data ? `${cur.data.icon ?? ""} ${cur.data.title || "Untitled"}`.trim() : cur.isLoading ? "…" : "not found"}</b></div>}
      <label>Find a page<span className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title…" style={{ paddingLeft: "2rem", width: "100%" }} autoCapitalize="none" enterKeyHint="search" /></span></label>
      <div className="cv-pick" role="listbox" aria-label="Pages">
        {(hits.data ?? []).filter((h) => h.id !== self).map((h) => <button key={h.id} type="button" role="option" aria-selected={h.id === value} onClick={() => onPick(h.id)}><span aria-hidden>{h.icon ?? (h.type === "canvas" ? "◇" : h.type === "database" ? "🗂" : "📄")}</span><span>{h.title || "Untitled"}</span></button>)}
        {hits.isLoading && <div className="cv-pick-empty">Searching…</div>}
        {hits.data && hits.data.filter((h) => h.id !== self).length === 0 && <div className="cv-pick-empty">No page matches.</div>}
      </div>
    </div>
  );
}
function RefPicker({ value, onPick }: { value: string | null; onPick: (id: string) => void }) {
  const [q, setQ] = React.useState(""); const cur = useRefLite(value);
  const lib = useQuery({ queryKey: ["canvas-ref-library"], staleTime: 30_000, queryFn: () => api<RefLite[]>("/api/research/references") });
  const list = (lib.data ?? []).filter((r) => { const t = `${r.title} ${(r.authors ?? []).join(" ")} ${r.year ?? ""}`.toLowerCase(); return q.trim().toLowerCase().split(/\s+/).every((w) => t.includes(w)); }).slice(0, 40);
  return (
    <div className="cv-form">
      {value && <div className="text-ui text-fg-muted">Current: <b className="text-fg">{cur.data?.title ?? (cur.isLoading ? "…" : "not found")}</b></div>}
      <label>Find a reference<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, author, year…" autoCapitalize="none" /></label>
      <div className="cv-pick" role="listbox" aria-label="References">
        {list.map((r) => <button key={r.id} type="button" role="option" aria-selected={r.id === value} onClick={() => onPick(r.id)}><span>{r.title}{r.year ? ` (${r.year})` : ""}</span></button>)}
        {lib.isLoading && <div className="cv-pick-empty">Loading the library…</div>}
        {lib.data && list.length === 0 && <div className="cv-pick-empty">{lib.data.length ? "No reference matches." : "The reference library is empty — add references in Research."}</div>}
      </div>
    </div>
  );
}
function FileField({ node, pageId, accept, onDone }: { node: CanvasNode; pageId: string; accept: string; onDone: (patch: Partial<CanvasNode>) => void }) {
  const [busy, setBusy] = React.useState(false); const input = React.useRef<HTMLInputElement | null>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return; setBusy(true);
    try { const dim = node.kind === "image" ? await imageSize(f) : null; const up = await uploadFile(f, pageId); onDone({ attachmentId: up.id, text: f.name, ...(dim ? { h: Math.max(40, Math.round((node.w * dim.h) / dim.w)) } : {}) }); }
    catch (e) { toast("File not added", { description: e instanceof Error ? e.message : "Upload failed", tone: "danger" }); } finally { setBusy(false); }
  };
  return (
    <div className="cv-form">
      {typeof node.attachmentId === "string" && <a className="inline-flex min-h-11 items-center gap-2 text-ui font-medium text-accent" href={fileUrl(node.attachmentId)} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" aria-hidden /> Open {str(node.text) || "the file"}</a>}
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      <Button variant="outline" className="h-11" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Spinner /> : <Upload />} {typeof node.attachmentId === "string" ? "Replace the file" : node.kind === "image" ? "Choose an image" : "Choose a PDF"}</Button>
    </div>
  );
}

export function CardForm({ store, nodeId, pageId, onClose, onOpenPage, onConnect, onDraw }: { store: CanvasStore; nodeId: string | null; pageId: string; onClose: () => void; onOpenPage: (id: string) => void; onConnect: (id: string) => void; onDraw: (n: CanvasNode) => void }) {
  const node = useCanvas(store, (s) => (nodeId ? s.doc.nodes.find((n) => n.id === nodeId) ?? null : null));
  const close = () => { store.settle(); onClose(); };
  React.useEffect(() => { if (nodeId && !node) onClose(); }, [nodeId, node, onClose]);
  if (!nodeId || !node) return null;
  const set = (patch: Partial<CanvasNode>, kind: "typing" | "commit" = "typing") => store.apply((d) => M.updateNode(d, node.id, patch), kind);
  const kind = node.kind as M.NodeKind; const color = typeof node.color === "string" ? node.color.toLowerCase() : null;
  const latex = str(node.latex); let mathHtml = ""; if (kind === "math" && latex.trim()) { try { mathHtml = katex.renderToString(latex, { displayMode: true, throwOnError: false, output: "html", strict: "ignore" }); } catch { /* shown as source */ } }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent title={`${KIND_LABEL[kind] ?? "Card"} card`} description={undefined} data-cv-ui data-testid="canvas-card-form" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="cv-form">
          {kind === "text" && <label>Text<textarea autoFocus value={str(node.text)} onChange={(e) => set({ text: e.target.value })} placeholder="Markdown works: **bold**, *italic*, lists, # titles" aria-label="Card text" /></label>}
          {kind === "shape" && <>
            <div className="cv-chips" role="group" aria-label="Shape">{([["rect", "Rectangle", <Square key="r" />], ["ellipse", "Ellipse", <Circle key="e" />], ["diamond", "Diamond", <Diamond key="d" />]] as const).map(([s, label, icon]) => <button key={s} type="button" aria-pressed={(str(node.shape) || "rect") === s} onClick={() => set({ shape: s }, "commit")}>{icon}{label}</button>)}</div>
            <label>Label<textarea value={str(node.text)} onChange={(e) => set({ text: e.target.value })} style={{ minHeight: "4.5rem" }} aria-label="Card text" /></label>
          </>}
          {kind === "math" && <>
            <label>LaTeX<textarea autoFocus value={latex} onChange={(e) => set({ latex: e.target.value })} placeholder="\frac{a}{b}" style={{ fontFamily: "var(--font-mono, monospace)", minHeight: "5rem" }} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="LaTeX source" /></label>
            {mathHtml && <div className="overflow-x-auto rounded-pop border border-line bg-bg p-3" dangerouslySetInnerHTML={{ __html: mathHtml }} />}
          </>}
          {kind === "table" && <div><div className="mb-1 text-[12px] font-semibold text-fg-muted">Cells (the first row is the header)</div><TableBody text={str(node.text)} editing onChange={(text) => set({ text })} /></div>}
          {kind === "link" && <>
            <label>Address<input type="url" inputMode="url" autoFocus={!str(node.url)} value={str(node.url)} onChange={(e) => set({ url: e.target.value.trim().slice(0, 2000) || undefined })} placeholder="https://…" autoCapitalize="none" autoCorrect="off" aria-label="Link address" /></label>
            <label>Title<input type="text" value={str(node.text)} onChange={(e) => set({ text: e.target.value || undefined })} placeholder="Optional" aria-label="Link title" /></label>
            {str(node.url) && !safeHref(str(node.url)) && <div className="text-ui text-danger">This address cannot be opened from the canvas (only http, https, mailto and pages of this site).</div>}
          </>}
          {kind === "page" && <>
            <PagePicker value={typeof node.pageId === "string" ? node.pageId : null} self={pageId} onPick={(id) => set({ pageId: id }, "commit")} />
            {typeof node.pageId === "string" && <Button variant="outline" className="h-11" onClick={() => { close(); onOpenPage(node.pageId as string); }}><ExternalLink /> Open the note</Button>}
          </>}
          {kind === "reference" && <RefPicker value={typeof node.refId === "string" ? node.refId : null} onPick={(id) => set({ refId: id }, "commit")} />}
          {(kind === "image" || kind === "pdf") && <FileField node={node} pageId={pageId} accept={kind === "image" ? "image/*" : "application/pdf,.pdf"} onDone={(patch) => set(patch, "commit")} />}
          {kind === "drawing" && <Button variant="outline" className="h-11" onClick={() => { close(); onDraw(node); }}><PenLine /> Continue drawing</Button>}
          {!M.isKnownKind(node.kind) && <div className="text-ui text-fg-muted">This card was made with a newer version of SP Note. It can be moved, resized and deleted; its content is kept as it is.</div>}
          <div>
            <div className="mb-1 text-[12px] font-semibold text-fg-muted">Colour</div>
            <div className="cv-chips" role="group" aria-label="Colour"><button type="button" aria-pressed={!color} onClick={() => set({ color: undefined }, "commit")}>None</button>{M.NODE_COLORS.map((c) => <button key={c.hex} type="button" aria-pressed={color === c.hex} onClick={() => set({ color: c.hex }, "commit")}><i style={{ background: c.hex }} />{c.name}</button>)}</div>
          </div>
          <div className="cv-chips" role="group" aria-label="Card actions">
            <button type="button" onClick={() => { close(); onConnect(node.id); }}><Waypoints />Connect to…</button>
            <button type="button" onClick={() => store.apply((d) => M.bringToFront(d, [node.id]))}><BringToFront />To front</button>
            <button type="button" onClick={() => store.apply((d) => M.sendToBack(d, [node.id]))}><SendToBack />To back</button>
            <button type="button" onClick={() => { store.select([node.id]); A.duplicateSelection(store); close(); }}><CopyPlus />Duplicate</button>
          </div>
        </div>
        <div className="cv-sheet-actions"><Button variant="danger" className="h-11" onClick={() => { store.select([node.id]); A.deleteSelection(store); onClose(); }}><Trash2 /> Delete</Button><Button className="h-11" onClick={close}>Done</Button></div>
      </SheetContent>
    </Dialog>
  );
}
