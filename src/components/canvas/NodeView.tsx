/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/canvas/NodeView.tsx
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
 * file: src/components/canvas/NodeView.tsx
 * description: one card of the canvas, by kind (SPEC §3.4): text (Markdown), page (live title + excerpt), image, pdf (first-page
 *   thumbnail), link, drawing (spn-ink-1 strokes), shape (rect / ellipse / diamond), reference, math (KaTeX), table (GFM in `text`).
 *   A kind this client does not know is a neutral, movable, read-only card — its data is never touched. Memoised on the node object:
 *   an untouched card is not re-rendered when another one moves. Pointer gestures are handled by the surface (event delegation on
 *   `data-id`); `data-cv-edit` marks the areas that keep their own pointer and key events (fields being edited).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import katex from "katex";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, FileWarning, Globe, Image as ImageIcon, BookMarked, PenLine, Plus, Shapes, Sigma, Table2, Trash2, Unlink } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { api, ApiError } from "@/lib/client/api";
import { fileUrl } from "@/lib/client/upload";
import { drawInk, type InkDoc } from "@/lib/editor/ink";
import * as M from "@/lib/canvas/model";
import type { CanvasNode } from "@/lib/canvas/model";
import type { CanvasStore } from "./store";
import { loadInk, loadPdfThumb, peekInk, peekPdfThumb } from "./resources";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const HEX = /^#[0-9a-f]{6}$/i;
export interface PageLite { id: string; title: string; icon: string | null; type: string; plainText?: string; deletedAt?: string | null }
export interface RefLite { id: string; title: string; authors: string[]; year: number | null; label?: string; journal?: string | null }
export const usePageLite = (id: string | null) => useQuery({ queryKey: ["canvas-page", id], enabled: Boolean(id), staleTime: 15_000, refetchOnWindowFocus: true, retry: false,
  queryFn: async () => { try { const p = await api<PageLite>(`/api/pages/${id}`); return { id: p.id, title: p.title, icon: p.icon, type: p.type, plainText: (p.plainText ?? "").slice(0, 400), deletedAt: p.deletedAt ?? null } as PageLite; } catch (e) { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return null; throw e; } } });
export const useRefLite = (id: string | null) => useQuery({ queryKey: ["canvas-ref", id], enabled: Boolean(id), staleTime: 60_000, retry: false,
  queryFn: async () => { try { const r = await api<RefLite[]>(`/api/research/references?ids=${id}`); return r[0] ?? null; } catch (e) { if (e instanceof ApiError && e.status < 500 && e.status !== 0) return null; throw e; } } });

export interface NodeViewProps { node: CanvasNode; selected: boolean; editing: boolean; /** far away or tiny on screen: draw a light placeholder */ lod: boolean; store: CanvasStore; readOnly: boolean }
export const NodeView = React.memo(function NodeView({ node, selected, editing, lod, store, readOnly }: NodeViewProps) {
  const color = HEX.test(str(node.color)) ? str(node.color) : undefined; const known = M.isKnownKind(node.kind);
  const style: React.CSSProperties = { left: node.x, top: node.y, width: Math.max(0, node.w), height: Math.max(0, node.h), ...(color ? ({ "--cv-color": color } as React.CSSProperties) : {}) };
  return (
    <div className="cv-node" data-id={node.id} data-kind={known ? node.kind : "unknown"} data-shape={node.kind === "shape" ? str(node.shape) || "rect" : undefined} data-selected={selected || undefined} data-editing={editing || undefined} data-colored={color ? "" : undefined} data-lod={lod || undefined} style={style}
      role="group" aria-label={`${known ? node.kind : "unsupported"} card: ${M.nodeLabel(node)}`} aria-selected={selected}>
      {lod ? <span className="cv-lod-label">{M.nodeLabel(node)}</span> : <Body node={node} editing={editing} store={store} readOnly={readOnly} />}
    </div>
  );
});

function Body({ node, editing, store, readOnly }: { node: CanvasNode; editing: boolean; store: CanvasStore; readOnly: boolean }) {
  const set = React.useCallback((patch: Partial<CanvasNode>) => { store.apply((d) => M.updateNode(d, node.id, patch), "typing"); }, [store, node.id]);
  switch (node.kind) {
    case "text": return editing ? <TextEditor value={str(node.text)} onChange={(text) => set({ text })} onDone={() => store.edit(null)} placeholder="Write… Markdown works: **bold**, *italic*, lists, # titles" /> : str(node.text).trim() ? <div className="cv-text"><Markdown text={str(node.text)} /></div> : <Hint icon={<FileText />} text={readOnly ? "Empty text" : "Double-click to write"} />;
    case "shape": return <ShapeBody node={node} editing={editing} onChange={(text) => set({ text })} onDone={() => store.edit(null)} />;
    case "math": return <MathBody latex={str(node.latex)} editing={editing} onChange={(latex) => set({ latex })} onDone={() => store.edit(null)} readOnly={readOnly} />;
    case "table": return <TableBody text={str(node.text)} editing={editing} onChange={(text) => set({ text })} onDone={() => store.edit(null)} />;
    case "page": return <PageBody node={node} readOnly={readOnly} />;
    case "image": return typeof node.attachmentId === "string" ? <ImageBody id={node.attachmentId} alt={str(node.text) || "Image"} /> : <Hint icon={<ImageIcon />} text={readOnly ? "No image" : "Double-click to choose an image"} />;
    case "pdf": return typeof node.attachmentId === "string" ? <PdfBody id={node.attachmentId} name={str(node.text)} /> : <Hint icon={<FileText />} text={readOnly ? "No PDF" : "Double-click to choose a PDF"} />;
    case "link": return <LinkBody node={node} readOnly={readOnly} />;
    case "drawing": return typeof node.ink === "string" ? <InkBody id={node.ink} /> : <Hint icon={<PenLine />} text="Empty drawing" />;
    case "reference": return <ReferenceBody node={node} readOnly={readOnly} />;
    default: return <div className="cv-unknown"><Shapes aria-hidden /><span><b>Unsupported card</b><span>“{node.kind}” was made with a newer version of SP Note. It is kept as it is.</span></span></div>;
  }
}
const Hint = ({ icon, text }: { icon: React.ReactNode; text: string }) => <div className="cv-hint">{icon}<span>{text}</span></div>;

/** Plain-text field that fills its card. Enter adds a line; Escape or ⌘/Ctrl+Enter ends the edit; leaving the field ends it too. */
function TextEditor({ value, onChange, onDone, placeholder, center, mono }: { value: string; onChange: (v: string) => void; onDone: () => void; placeholder: string; center?: boolean; mono?: boolean }) {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => { const el = ref.current; if (!el) return; el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length); }, []);
  return <textarea ref={ref} data-cv-edit className="cv-field" data-center={center || undefined} data-mono={mono || undefined} value={value} placeholder={placeholder} aria-label="Card text" spellCheck
    onChange={(e) => onChange(e.target.value)} onBlur={onDone}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); onDone(); } }} />;
}
function ShapeBody({ node, editing, onChange, onDone }: { node: CanvasNode; editing: boolean; onChange: (v: string) => void; onDone: () => void }) {
  const shape = str(node.shape) || "rect";
  return (
    <>
      <svg className="cv-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {shape === "ellipse" ? <ellipse cx="50" cy="50" rx="49" ry="49" vectorEffect="non-scaling-stroke" /> : shape === "diamond" ? <polygon points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" /> : <rect x="1" y="1" width="98" height="98" rx="6" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="cv-shape-text">{editing ? <TextEditor center value={str(node.text)} onChange={onChange} onDone={onDone} placeholder="Label" /> : <span>{str(node.text)}</span>}</div>
    </>
  );
}
function MathBody({ latex, editing, onChange, onDone, readOnly }: { latex: string; editing: boolean; onChange: (v: string) => void; onDone: () => void; readOnly: boolean }) {
  const html = React.useMemo(() => { if (!latex.trim()) return ""; try { return katex.renderToString(latex, { displayMode: true, throwOnError: false, output: "html", strict: "ignore" }); } catch { return ""; } }, [latex]);
  return (
    <div className="cv-math">
      {html ? <div className="cv-math-out" dangerouslySetInnerHTML={{ __html: html }} /> : !editing && <Hint icon={<Sigma />} text={readOnly ? "Empty formula" : "Double-click to write LaTeX"} />}
      {editing && <div className="cv-math-src"><TextEditor mono value={latex} onChange={onChange} onDone={onDone} placeholder="LaTeX, e.g. \frac{a}{b}" /></div>}
    </div>
  );
}
/** Small editable grid. Cells are stored as a GitHub-flavoured Markdown table in `text` (readable by every client). */
export function TableBody({ text, editing, onChange, onDone }: { text: string; editing: boolean; onChange: (v: string) => void; onDone?: () => void }) {
  const cells = React.useMemo(() => { const c = M.parseTable(text); return c.length ? c : [[""]]; }, [text]);
  const write = (next: string[][]) => onChange(M.serializeTable(next));
  const setCell = (r: number, c: number, v: string) => write(cells.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  if (!editing) return <div className="cv-table"><table><tbody>{cells.map((row, r) => <tr key={r}>{row.map((c, j) => (r === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody></table></div>;
  const leave = (e: React.FocusEvent<HTMLDivElement>) => { if (onDone && !e.currentTarget.contains(e.relatedTarget as Node | null)) onDone(); };
  return (
    <div className="cv-table" data-cv-edit data-editing onBlur={leave} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onDone?.(); } }}>
      <table><tbody>{cells.map((row, r) => <tr key={r}>{row.map((c, j) => { const Cell = r === 0 ? "th" : "td"; return <Cell key={j}><input value={c} aria-label={`Row ${r + 1}, column ${j + 1}`} autoFocus={r === 0 && j === 0} onChange={(e) => setCell(r, j, e.target.value)} /></Cell>; })}</tr>)}</tbody></table>
      <div className="cv-table-tools">
        <button type="button" onClick={() => write([...cells, cells[0].map(() => "")])}><Plus aria-hidden />Row</button>
        <button type="button" onClick={() => write(cells.map((r) => [...r, ""]))}><Plus aria-hidden />Column</button>
        <button type="button" disabled={cells.length < 2} onClick={() => write(cells.slice(0, -1))}><Trash2 aria-hidden />Row</button>
        <button type="button" disabled={cells[0].length < 2} onClick={() => write(cells.map((r) => r.slice(0, -1)))}><Trash2 aria-hidden />Column</button>
      </div>
    </div>
  );
}
function PageBody({ node, readOnly }: { node: CanvasNode; readOnly: boolean }) {
  const id = typeof node.pageId === "string" ? node.pageId : null; const q = usePageLite(id);
  if (!id) return <Hint icon={<FileText />} text={readOnly ? "No page" : "Double-click to choose a page"} />;
  if (q.isLoading) return <div className="cv-card"><div className="skeleton h-4 w-2/3" /><div className="skeleton mt-2 h-3 w-full" /></div>;
  const p = q.data;
  if (!p) return <div className="cv-card cv-missing"><Unlink aria-hidden /><span>Page not found — it may have been deleted.</span></div>;
  return (
    <div className="cv-card" data-testid="canvas-page-card">
      <div className="cv-eyebrow"><span>{p.type === "canvas" ? "Canvas" : p.type === "database" ? "Database" : "Page"}{p.deletedAt ? " · in the trash" : ""}</span><a href={`/p/${p.id}`} className="cv-open" data-cv-edit title="Open the note" aria-label={`Open ${p.title || "Untitled"}`}><ExternalLink aria-hidden /></a></div>
      <div className="cv-title">{p.icon ? `${p.icon} ` : ""}{p.title || "Untitled"}</div>
      {p.plainText?.trim() && <div className="cv-excerpt">{p.plainText.trim().slice(0, 220)}</div>}
    </div>
  );
}
function ImageBody({ id, alt }: { id: string; alt: string }) {
  const [bad, setBad] = React.useState(false);
  if (bad) return <Hint icon={<FileWarning />} text="Image unavailable" />;
  // eslint-disable-next-line @next/next/no-img-element -- authenticated attachment, no optimiser
  return <img className="cv-img" src={fileUrl(id)} alt={alt} draggable={false} loading="lazy" decoding="async" onError={() => setBad(true)} />;
}
function PdfBody({ id, name }: { id: string; name: string }) {
  const [thumb, setThumb] = React.useState(() => peekPdfThumb(id) ?? null); const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { let on = true; setFailed(false); const hit = peekPdfThumb(id); if (hit) { setThumb(hit); return; } setThumb(null); loadPdfThumb(id).then((t) => { if (on) setThumb(t); }).catch(() => { if (on) setFailed(true); }); return () => { on = false; }; }, [id]);
  return (
    <div className="cv-pdf" data-testid="canvas-pdf">
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL rendered by pdf.js */}
      <div className="cv-pdf-page">{thumb ? <img src={thumb.url} alt={`First page of ${name || "the PDF"}`} draggable={false} /> : failed ? <Hint icon={<FileWarning />} text="Preview unavailable" /> : <div className="skeleton h-full w-full" />}</div>
      <div className="cv-pdf-foot"><FileText aria-hidden /><span className="truncate">{name || "PDF"}</span>{thumb && <span className="cv-faint">{thumb.pages} p.</span>}<a href={fileUrl(id)} target="_blank" rel="noopener noreferrer" className="cv-open" data-cv-edit title="Open the PDF" aria-label="Open the PDF"><ExternalLink aria-hidden /></a></div>
    </div>
  );
}
export function hostOf(url: string): string { try { return new URL(url, typeof location !== "undefined" ? location.origin : "http://localhost").host.replace(/^www\./, ""); } catch { return url; } }
/** Only http(s), mailto and same-site paths are ever turned into a clickable link. */
export const safeHref = (url: string) => (/^(https?:\/\/|mailto:|\/(?!\/))/i.test(url.trim()) ? url.trim() : null);
function LinkBody({ node, readOnly }: { node: CanvasNode; readOnly: boolean }) {
  const url = str(node.url); const href = safeHref(url);
  if (!url) return <Hint icon={<Globe />} text={readOnly ? "No address" : "Double-click to set the address"} />;
  return (
    <div className="cv-card">
      <div className="cv-eyebrow"><span><Globe aria-hidden /> {hostOf(url)}</span>{href && <a href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" className="cv-open" data-cv-edit title="Open the link" aria-label="Open the link"><ExternalLink aria-hidden /></a>}</div>
      <div className="cv-title">{str(node.text).trim() || hostOf(url)}</div>
      <div className="cv-excerpt cv-url">{url}</div>
    </div>
  );
}
function ReferenceBody({ node, readOnly }: { node: CanvasNode; readOnly: boolean }) {
  const id = typeof node.refId === "string" ? node.refId : null; const q = useRefLite(id);
  if (!id) return <Hint icon={<BookMarked />} text={readOnly ? "No reference" : "Double-click to choose a reference"} />;
  if (q.isLoading) return <div className="cv-card"><div className="skeleton h-4 w-2/3" /><div className="skeleton mt-2 h-3 w-1/2" /></div>;
  const r = q.data;
  if (!r) return <div className="cv-card cv-missing"><Unlink aria-hidden /><span>Reference not found — it may have been removed from the library.</span></div>;
  return (
    <div className="cv-card" data-testid="canvas-ref-card">
      <div className="cv-eyebrow"><span><BookMarked aria-hidden /> Reference{r.year ? ` · ${r.year}` : ""}</span><a href={`/research?ref=${r.id}`} className="cv-open" data-cv-edit title="Open in Research" aria-label="Open in Research"><ExternalLink aria-hidden /></a></div>
      <div className="cv-title">{r.title}</div>
      <div className="cv-excerpt">{[r.authors?.slice(0, 3).join(", ") + (r.authors?.length > 3 ? " et al." : ""), r.journal].filter(Boolean).join(" · ")}</div>
    </div>
  );
}
/** Strokes of a drawing card, drawn with the editor's ink renderer and stretched to the card. */
export function InkBody({ id, doc: given }: { id?: string; doc?: InkDoc }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null); const [doc, setDoc] = React.useState<InkDoc | null>(() => given ?? (id ? peekInk(id) ?? null : null)); const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { if (given) { setDoc(given); return; } if (!id) return; let on = true; const hit = peekInk(id); if (hit) { setDoc(hit); return; } loadInk(id).then((d) => { if (on) setDoc(d); }).catch(() => { if (on) setFailed(true); }); return () => { on = false; }; }, [id, given]);
  React.useEffect(() => {
    const c = ref.current; if (!c || !doc) return;
    const scale = Math.min(3, Math.max(1, (window.devicePixelRatio || 1) * 1.5), Math.sqrt(4_000_000 / Math.max(1, doc.width * doc.height)));
    c.width = Math.max(1, Math.round(doc.width * scale)); c.height = Math.max(1, Math.round(doc.height * scale));
    const ctx = c.getContext("2d"); if (!ctx) return; ctx.clearRect(0, 0, c.width, c.height); drawInk(ctx, doc, scale);
  }, [doc]);
  if (failed) return <Hint icon={<FileWarning />} text="Drawing unavailable" />;
  return <canvas ref={ref} className="cv-ink" data-testid="canvas-ink" data-strokes={doc?.strokes.length ?? 0} aria-label="Drawing" />;
}
export const KIND_ICON: Record<M.NodeKind, React.ReactNode> = { text: <FileText />, page: <FileText />, image: <ImageIcon />, pdf: <FileText />, link: <Globe />, drawing: <PenLine />, shape: <Shapes />, reference: <BookMarked />, math: <Sigma />, table: <Table2 /> };
export const KIND_LABEL: Record<M.NodeKind, string> = { text: "Text", page: "Page", image: "Image", pdf: "PDF", link: "Link", drawing: "Drawing", shape: "Shape", reference: "Reference", math: "Formula", table: "Table" };
