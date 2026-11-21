/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/editor/nodes/PdfView.tsx
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
 * file: src/components/editor/nodes/PdfView.tsx
 * description: node view of the `pdf` block (SPEC §2) — an annotatable PDF reader. pdf.js is loaded with a dynamic import only when
 *   the block comes into view (or on click); one page is rendered at a time (canvas fitted to the block width, devicePixelRatio-aware,
 *   stale render tasks cancelled) with the pdf.js text layer above it so text can be selected. A selection becomes a highlight or a
 *   note whose rects are stored relative to the page (0..1, origin top-left); `ink` annotations of other clients are drawn read-only
 *   and, like every key this client does not know, written back untouched. `page` is the reading position (debounced). A failed load
 *   never alters the node. The worker and the optional pdf.js assets are served from /vendor/pdfjs (same origin, CSP worker-src 'self').
 *   Research link: when the file is the PDF attached to a reference, highlights and notes are also saved as that reference's extracts
 *   (`useExtractLink`, ids derived in src/lib/research/pdf-extracts.ts so nothing is ever duplicated); the annotations stay in the page.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, ChevronLeft, ChevronRight, ExternalLink, FileText, FileUp, Highlighter, Maximize2, MessageSquarePlus, RotateCw, TextQuote, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import type { PdfAnnotation, PdfAttrs } from "@/lib/editor/next-node-defs";
import { annotationAt, annotationLine, clampPage, cleanSelectionText, DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_COLORS, inkPointsOf, listAnnotations, newAnnotation, normaliseRects, patchAnnotation, rectsOf, removeAnnotation, safeColor, sortAnnotations, type BoxLike, type NormRect } from "@/lib/editor/pdf-annotations";
import { extractsOf, type Extract } from "@/lib/research/cite";
import { extractOfAnnotation, linkedAnnotationIds, planExtractSync, removedExtractIds, type ExtractPlan } from "@/lib/research/pdf-extracts";
import { api } from "@/lib/client/api";
import { fileUrl, uploadFile } from "@/lib/client/upload";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { NodeButton, NodeFrame, NodeState, useDebounced, type LeafViewProps } from "./frame";

type PdfJs = typeof import("pdfjs-dist");
/** Same-origin copy of pdfjs-dist's `build/pdf.worker.min.mjs` (+ optional `cmaps/`, `standard_fonts/`, `wasm/`, `iccs/`). */
export const PDFJS_ASSETS = "/vendor/pdfjs";
let pdfjs: Promise<PdfJs> | null = null;
/** pdf.js is fetched on first use, once for all blocks. */
function loadPdfJs(): Promise<PdfJs> {
  return (pdfjs ??= import("pdfjs-dist").then((lib) => {
    if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSETS}/pdf.worker.min.mjs`;
    return lib;
  }).catch((e) => { pdfjs = null; throw e; }));
}
/** Canvas backing stores above this area are refused by some phones: the output scale is lowered instead. */
const MAX_CANVAS_AREA = 16_000_000;
const ZOOM_MIN = 0.5, ZOOM_MAX = 4, ZOOM_STEP = 1.25;
const MAX_PDF_BYTES = 200 * 1024 * 1024;

function describeLoadError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? ""; const message = String((e as { message?: string })?.message ?? e ?? "");
  const status = (e as { status?: number })?.status;
  if (name === "PasswordException") return "This PDF is protected by a password and cannot be opened here.";
  if (name === "InvalidPDFException" || name === "FormatError") return "The file is damaged or is not a PDF.";
  if (name === "ResponseException" || name === "MissingPDFException") return status === 404 || (e as { missing?: boolean })?.missing ? "The file was not found — it may have been deleted." : status === 401 || status === 403 ? "You do not have access to this file." : `The file could not be downloaded${status ? ` (HTTP ${status})` : ""}.`;
  if (/worker/i.test(message)) return "The PDF engine could not start (worker file unavailable).";
  if (/fetch|network|load failed/i.test(message)) return "Network error while downloading the file.";
  return message ? `The PDF could not be opened: ${message}` : "The PDF could not be opened.";
}
const isCancel = (e: unknown) => { const n = (e as { name?: string })?.name; return n === "RenderingCancelledException" || n === "AbortException"; };
const pct = (n: number) => `${Math.round(n * 1e4) / 100}%`;

/** Client rects of the selected text only (text nodes clipped to the range): block boxes, <br> and helper elements never count. */
function selectionTextRects(range: Range, host: HTMLElement): BoxLike[] {
  const out: BoxLike[] = []; const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT); const sub = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    const length = (n.nodeValue ?? "").length; const start = n === range.startContainer ? range.startOffset : 0; const end = n === range.endContainer ? range.endOffset : length;
    if (end <= start) continue;
    sub.setStart(n, Math.min(start, length)); sub.setEnd(n, Math.min(end, length));
    for (const r of Array.from(sub.getClientRects())) out.push({ left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return out;
}

export function PdfView(props: LeafViewProps<PdfAttrs>) {
  const { attrs, selected, editable } = props;
  const name = typeof attrs.name === "string" ? attrs.name : "";
  return (
    <NodeFrame kind="pdf" label="PDF" icon={<FileText />} title={name} selected={selected}>
      {attrs.attachmentId ? <PdfReader key={attrs.attachmentId} {...props} attachmentId={attrs.attachmentId} />
        : editable ? <PdfPicker {...props} />
        : <NodeState icon={<FileText />} title="No PDF attached" />}
    </NodeFrame>
  );
}

/** Empty block: choose a file, upload it with progress, then (and only then) write the attachment into the node. */
function PdfPicker({ update, pageId }: LeafViewProps<PdfAttrs>) {
  const input = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null); const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); }; }, []);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) { setError("Choose a PDF file."); return; }
    if (file.size > MAX_PDF_BYTES) { setError("File too large (200 MB max)."); return; }
    const controller = new AbortController(); abort.current = controller; setError(null); setProgress(0);
    try {
      const up = await uploadFile(file, pageId, { onProgress: (f) => { if (alive.current) setProgress(f); }, signal: controller.signal });
      if (alive.current) update({ attachmentId: up.id, name: up.name || file.name });
    } catch (e) {
      if (alive.current && (e as Error)?.name !== "AbortError") setError((e as Error)?.message || "Upload failed");
    } finally { if (abort.current === controller) abort.current = null; if (alive.current) setProgress(null); }
  };
  const uploading = progress !== null;
  return (
    <NodeState icon={<FileUp />} tone={error ? "danger" : "neutral"} title={uploading ? `Uploading… ${Math.round((progress ?? 0) * 100)} %` : error ?? "Add a PDF to read and annotate"}
      hint={uploading ? <progress className="pdfv-progress" max={1} value={progress ?? 0} aria-label="Upload progress" /> : "Highlights and notes are saved in the page; the file itself is never modified."}>
      <input ref={input} type="file" accept="application/pdf" hidden aria-hidden tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void choose(f); }} />
      {uploading ? <NodeButton label="Cancel upload" text onClick={() => abort.current?.abort()}><X /></NodeButton>
        : <NodeButton label="Choose a PDF" tone="accent" text onClick={() => input.current?.click()}><FileUp /></NodeButton>}
    </NodeState>
  );
}

interface LinkedRef { id: string; citeKey: string; title: string; label?: string; fields?: unknown }
/**
 * Research link of a PDF block. Finds the reference whose attached PDF is this file (`GET /api/research/references?attachmentId=`) and,
 * while the page is editable, mirrors what the user does to the annotations into that reference's extracts: a new or edited highlight /
 * note is created or patched (extract id derived from the annotation, so a repeat addresses the same extract), a removed one is deleted.
 * Only changes made in this session are pushed on their own; annotations that existed before (or failed while offline) are offered
 * through `syncAll`. Calls are serialised; a failure never touches the annotations, which live in the page.
 */
function useExtractLink(attachmentId: string, annotations: PdfAnnotation[], editable: boolean) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["reference-of-attachment", attachmentId], staleTime: 60_000, retry: false, queryFn: () => api<LinkedRef[]>(`/api/research/references?attachmentId=${attachmentId}`).catch(() => [] as LinkedRef[]) });
  const ref = q.data?.[0] ?? null; const refId = ref?.id ?? null;
  const [extracts, setExtracts] = React.useState<Extract[]>([]); const [busy, setBusy] = React.useState(false); const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setExtracts(ref ? extractsOf(ref.fields) : []); }, [ref]);
  const extractsRef = React.useRef(extracts); extractsRef.current = extracts; const latest = React.useRef(annotations); latest.current = annotations;
  const synced = React.useRef<PdfAnnotation[] | null>(null); const chain = React.useRef<Promise<void>>(Promise.resolve());
  React.useEffect(() => { synced.current = null; }, [refId]);
  const run = React.useCallback((plan: ExtractPlan, removed: string[]) => {
    if (!refId || (!plan.create.length && !plan.update.length && !removed.length)) return chain.current;
    const url = `/api/research/references/${refId}/extracts`; setBusy(true);
    chain.current = chain.current.then(async () => {
      let ok = true; const apply = (r: { extracts?: Extract[] }) => { if (Array.isArray(r?.extracts)) { extractsRef.current = r.extracts; setExtracts(r.extracts); } };
      try {
        for (const c of plan.create) { const r = await api<{ extract: Extract; extracts: Extract[] }>(url, { method: "POST", json: { id: c.id, ...c.body }, idempotencyKey: false }); apply(r);
          // the id already existed (same annotation saved earlier) with other content: bring it up to date instead of adding
          if (r.extract && (r.extract.quote !== c.body.quote || (r.extract.page ?? null) !== c.body.page || (r.extract.note ?? null) !== c.body.note)) apply(await api(url, { method: "PATCH", json: { id: c.id, ...c.body } })); }
        for (const u of plan.update) apply(await api(url, { method: "PATCH", json: { id: u.id, ...u.body } }));
        for (const id of removed) apply(await api(`${url}?extractId=${id}`, { method: "DELETE" }));
      } catch { ok = false; }
      setFailed(!ok); setBusy(false);
      qc.invalidateQueries({ queryKey: ["research-ref", refId] }); qc.invalidateQueries({ queryKey: ["reference-of-attachment", attachmentId] });
      if (!ok) toast("Extracts not updated", { description: "Your annotations are saved in the page. Use “Save as extracts” on the PDF to try again.", tone: "danger" });
    });
    return chain.current;
  }, [refId, attachmentId, qc]);
  // user changes → extracts, a moment after the last change (typing a note is one update)
  React.useEffect(() => {
    if (!refId || !editable) { synced.current = null; return; }
    if (synced.current === null) { synced.current = annotations; return; }
    if (synced.current === annotations) return;
    const t = setTimeout(() => {
      const before = synced.current ?? [], now = latest.current; synced.current = now; const old = new Map(before.map((a) => [a.id, a]));
      const touched = now.filter((a) => { const b = old.get(a.id); return !b || JSON.stringify(extractOfAnnotation(b)) !== JSON.stringify(extractOfAnnotation(a)); });
      void run(planExtractSync(attachmentId, touched, extractsRef.current), removedExtractIds(attachmentId, before, now));
    }, 900);
    return () => clearTimeout(t);
  }, [annotations, refId, editable, attachmentId, run]);
  const linked = React.useMemo(() => linkedAnnotationIds(attachmentId, annotations, extracts), [attachmentId, annotations, extracts]);
  const eligible = React.useMemo(() => annotations.filter((a) => extractOfAnnotation(a)), [annotations]);
  const unlinked = eligible.filter((a) => !linked.has(a.id)).length;
  const syncAll = React.useCallback(() => { synced.current = latest.current; return run(planExtractSync(attachmentId, latest.current, extractsRef.current), []); }, [attachmentId, run]);
  return { ref, linked, unlinked, busy, failed, syncAll };
}

interface PendingSelection { page: number; rects: NormRect[]; text: string; /** anchor of the toolbar, page-relative */ x: number; y: number }

function PdfReader({ attrs, update, editable, attachmentId }: LeafViewProps<PdfAttrs> & { attachmentId: string }) {
  const rootRef = React.useRef<HTMLDivElement>(null); const stageRef = React.useRef<HTMLDivElement>(null); const pageRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null); const textRef = React.useRef<HTMLDivElement>(null);

  // ---- lazy load: nothing is imported or downloaded until the block is near the viewport (or the user asks) ----
  const [active, setActive] = React.useState(false);
  React.useEffect(() => {
    if (active) return; const el = rootRef.current; if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setActive(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting)) setActive(true); }, { rootMargin: "200px 0px" });
    io.observe(el); return () => io.disconnect();
  }, [active]);

  const [doc, setDoc] = React.useState<PDFDocumentProxy | null>(null);
  const libRef = React.useRef<PdfJs | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [numPages, setNumPages] = React.useState(0);
  React.useEffect(() => {
    if (!active) return; let cancelled = false; let task: PDFDocumentLoadingTask | null = null;
    setStatus("loading"); setError(null);
    loadPdfJs().then((lib) => {
      if (cancelled) return null; libRef.current = lib;
      task = lib.getDocument({ url: fileUrl(attachmentId), withCredentials: true, enableXfa: false, cMapUrl: `${PDFJS_ASSETS}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDFJS_ASSETS}/standard_fonts/`, wasmUrl: `${PDFJS_ASSETS}/wasm/`, iccUrl: `${PDFJS_ASSETS}/iccs/` });
      return task.promise;
    }).then((d) => {
      if (!d || cancelled) return; // a cancelled load is destroyed by the cleanup below
      setNumPages(d.numPages); setPage((p) => clampPage(p, d.numPages)); setDoc(d); setStatus("ready");
    }).catch((e) => { if (!cancelled) { setError(describeLoadError(e)); setStatus("error"); } });
    return () => { cancelled = true; setDoc(null); void task?.destroy().catch(() => {}); };
  }, [active, attachmentId, attempt]);

  // ---- reading position: local at once, written to the node a moment later (never in a read-only editor) ----
  const storedPage = clampPage(attrs.page, 1e6);
  const [page, setPage] = React.useState(storedPage);
  const writtenPage = React.useRef(storedPage);
  React.useEffect(() => { if (storedPage !== writtenPage.current) { writtenPage.current = storedPage; setPage(clampPage(storedPage, numPages || 1e6)); } }, [storedPage, numPages]);
  const savePage = useDebounced((p: number) => { if (editable && p !== writtenPage.current) { writtenPage.current = p; update({ page: p }); } }, 600);
  const [pageField, setPageField] = React.useState(String(page));
  React.useEffect(() => { setPageField(String(page)); }, [page]);
  const go = React.useCallback((n: number) => {
    const p = clampPage(n, numPages || 1e6); setPending(null); setPage(p); setPageField(String(p)); savePage(p);
  }, [numPages, savePage]);

  // ---- geometry: fit the block width, follow resizes without thrashing ----
  const [width, setWidth] = React.useState(0);
  const [zoom, setZoom] = React.useState(1);
  React.useLayoutEffect(() => {
    const el = stageRef.current; if (!el) return;
    const measure = () => { const w = Math.floor(el.clientWidth); if (w > 0) setWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev)); };
    measure(); if (typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => { if (timer) clearTimeout(timer); timer = setTimeout(measure, 120); });
    ro.observe(el); return () => { ro.disconnect(); if (timer) clearTimeout(timer); };
  }, [status]);

  const [pageSize, setPageSize] = React.useState<{ width: number; height: number } | null>(null);
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const [rendering, setRendering] = React.useState(false);
  React.useEffect(() => {
    const lib = libRef.current; if (!doc || !lib || width <= 0) return;
    let cancelled = false; let task: RenderTask | null = null; let layer: TextLayer | null = null;
    setRendering(true); setRenderError(null);
    (async () => {
      const p = await doc.getPage(clampPage(page, doc.numPages)); if (cancelled) return;
      const base = p.getViewport({ scale: 1 }); const scale = (width / base.width) * zoom; const viewport = p.getViewport({ scale });
      const cssW = Math.floor(viewport.width), cssH = Math.floor(viewport.height);
      const out = Math.max(0.5, Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(MAX_CANVAS_AREA / Math.max(1, cssW * cssH))));
      // Draw off-screen and swap when complete: the visible page never flashes blank and never shows a half-drawn stale page.
      const buffer = document.createElement("canvas"); buffer.width = Math.max(1, Math.floor(cssW * out)); buffer.height = Math.max(1, Math.floor(cssH * out));
      task = p.render({ canvas: buffer, viewport, transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined, background: "#ffffff" });
      await task.promise; if (cancelled) return;
      const canvas = canvasRef.current, host = textRef.current; if (!canvas || !host) return;
      canvas.width = buffer.width; canvas.height = buffer.height; canvas.getContext("2d")?.drawImage(buffer, 0, 0); buffer.width = buffer.height = 0;
      setPageSize({ width: cssW, height: cssH }); setRendering(false);
      // Text layer (selection). pdf.js lays the runs out in page units and scales them with these custom properties.
      host.replaceChildren(); host.style.setProperty("--scale-factor", String(scale)); host.style.setProperty("--total-scale-factor", String(scale));
      layer = new lib.TextLayer({ textContentSource: p.streamTextContent(), container: host, viewport });
      const quarter = viewport.rotation % 180 !== 0; host.style.width = `${quarter ? cssH : cssW}px`; host.style.height = `${quarter ? cssW : cssH}px`;
      await layer.render(); if (cancelled) return;
      const end = document.createElement("div"); end.className = "pdfv-eoc"; host.append(end);
    })().catch((e) => { if (!cancelled && !isCancel(e)) { setRendering(false); setRenderError(describeLoadError(e)); } });
    return () => { cancelled = true; try { task?.cancel(); } catch { /* already finished */ } try { layer?.cancel(); } catch { /* already finished */ } };
  }, [doc, page, width, zoom]);

  // ---- annotations ----
  const annotations = React.useMemo(() => listAnnotations(attrs.annotations), [attrs.annotations]);
  const onPage = React.useMemo(() => annotations.filter((a) => a.page === page), [annotations, page]);
  const sorted = React.useMemo(() => sortAnnotations(annotations), [annotations]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const current = selectedId ? annotations.find((a) => a.id === selectedId) ?? null : null;
  const [color, setColor] = React.useState(DEFAULT_HIGHLIGHT_COLOR);
  const [pending, setPending] = React.useState<PendingSelection | null>(null);
  const research = useExtractLink(attachmentId, annotations, editable);

  const readSelection = React.useCallback(() => {
    if (!editable) return;
    const host = textRef.current, sheet = pageRef.current, sel = window.getSelection();
    if (!host || !sheet || !sel || sel.rangeCount === 0 || sel.isCollapsed) { setPending(null); return; }
    const range = sel.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) { setPending(null); return; }
    const rects = normaliseRects(selectionTextRects(range, host), sheet.getBoundingClientRect()); const text = cleanSelectionText(sel.toString());
    if (!rects.length || !text) { setPending(null); return; }
    const last = rects[rects.length - 1];
    setPending({ page, rects, text, x: last[0] + last[2] / 2, y: last[1] + last[3] });
  }, [editable, page]);
  // The selection is read when a gesture ends, and (debounced) when it changes by other means: keyboard, touch handles.
  React.useEffect(() => {
    if (status !== "ready") return; let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (!editable) return;
      const host = textRef.current, sel = document.getSelection(); if (!host) return;
      const inside = !!sel && sel.rangeCount > 0 && !!sel.anchorNode && host.contains(sel.anchorNode);
      if (timer) clearTimeout(timer); timer = setTimeout(inside ? readSelection : () => setPending((p) => (p ? null : p)), inside ? 180 : 0);
    };
    const onUp = () => { textRef.current?.classList.remove("selecting"); };
    document.addEventListener("selectionchange", onChange); document.addEventListener("pointerup", onUp);
    return () => { document.removeEventListener("selectionchange", onChange); document.removeEventListener("pointerup", onUp); if (timer) clearTimeout(timer); };
  }, [editable, status, readSelection]);

  const create = (kind: "highlight" | "note") => {
    if (!editable || !pending) return;
    const a = newAnnotation({ page: pending.page, kind, color, rects: pending.rects, text: pending.text, note: "" });
    update({ annotations: [...(Array.isArray(attrs.annotations) ? attrs.annotations : []), a] });
    window.getSelection()?.removeAllRanges(); setPending(null); setSelectedId(kind === "note" ? a.id : null);
  };
  const patch = (id: string, p: Partial<PdfAnnotation>) => { if (editable) update({ annotations: patchAnnotation(attrs.annotations, id, p) as PdfAnnotation[] }); };
  const remove = (id: string) => { if (!editable) return; update({ annotations: removeAnnotation(attrs.annotations, id) as PdfAnnotation[] }); setSelectedId(null); };
  /** A click on the page that is not a selection: pick the highlight under the pointer (the text layer sits above the highlights). */
  const onPageClick = (e: React.MouseEvent) => {
    const sheet = pageRef.current; const sel = window.getSelection(); if (!sheet || (sel && !sel.isCollapsed)) return;
    const r = sheet.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return;
    const hit = annotationAt(onPage, page, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    setSelectedId(hit ? hit.id : null);
  };
  const onStageKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "PageDown" || e.key === "ArrowRight") { e.preventDefault(); go(page + 1); } else if (e.key === "PageUp" || e.key === "ArrowLeft") { e.preventDefault(); go(page - 1); }
  };

  const ready = status === "ready";
  const toolbarX = pending && pageSize ? Math.min(Math.max(pending.x * pageSize.width, Math.min(130, pageSize.width / 2)), Math.max(pageSize.width - 130, pageSize.width / 2)) : 0;
  const toolbarBelow = !pending || pending.y < 0.82;

  return (
    <div className="pdfv" ref={rootRef}>
      {status === "idle" && <NodeState icon={<FileText />} title={attrs.name || "PDF document"} hint="The viewer loads when the block is on screen."><NodeButton label="Load PDF" text onClick={() => setActive(true)}><FileText /></NodeButton></NodeState>}
      {status === "loading" && <NodeState icon={<FileText />} title="Opening the PDF…" hint={attrs.name || undefined} />}
      {status === "error" && (
        <NodeState tone="danger" icon={<FileText />} title="This PDF cannot be displayed" hint={error}>
          <NodeButton label="Try again" text onClick={() => setAttempt((n) => n + 1)}><RotateCw /></NodeButton>
          <OpenOriginal attachmentId={attachmentId} text />
        </NodeState>
      )}
      {ready && (
        <>
          <div className="nb-toolbar pdfv-toolbar" role="toolbar" aria-label="PDF navigation">
            <NodeButton label="Previous page" disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeft /></NodeButton>
            <label className="pdfv-pagebox nb-meta">
              <span className="sr-only">Page number</span>
              <input className="nb-field pdfv-pagefield" type="text" inputMode="numeric" pattern="[0-9]*" aria-label="Page number" value={pageField}
                onChange={(e) => setPageField(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} onFocus={(e) => e.currentTarget.select()}
                onBlur={() => (pageField === "" ? setPageField(String(page)) : go(Number(pageField)))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (pageField !== "") go(Number(pageField)); } }} />
              <span aria-label={`of ${numPages} pages`}>/ {numPages}</span>
            </label>
            <NodeButton label="Next page" disabled={page >= numPages} onClick={() => go(page + 1)}><ChevronRight /></NodeButton>
            <span className="pdfv-gap" />
            <NodeButton label="Zoom out" disabled={zoom <= ZOOM_MIN + 1e-6} onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP))}><ZoomOut /></NodeButton>
            <NodeButton label="Fit to width" active={zoom === 1} onClick={() => setZoom(1)}><Maximize2 /></NodeButton>
            <NodeButton label="Zoom in" disabled={zoom >= ZOOM_MAX - 1e-6} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP))}><ZoomIn /></NodeButton>
            <span className="nb-meta pdfv-zoom" aria-live="polite">{Math.round(zoom * 100)} %</span>
            <OpenOriginal attachmentId={attachmentId} />
          </div>
          <div className="pdfv-stage nb-scroll" ref={stageRef} tabIndex={0} role="group" aria-label={`Page ${page} of ${numPages}`} aria-busy={rendering} onKeyDown={onStageKey}>
            <div className="pdfv-page" ref={pageRef} style={pageSize ? { width: pageSize.width, height: pageSize.height } : undefined} data-rendering={rendering ? "true" : undefined}>
              <canvas ref={canvasRef} className="pdfv-canvas" data-testid="pdf-canvas" data-page={page} aria-hidden />
              <div className="pdfv-marks" aria-hidden>
                {onPage.flatMap((a) => (a.kind === "ink" ? [] : rectsOf(a).map((r, i) => (
                  <div key={`${a.id}-${i}`} className="pdfv-mark" data-testid="pdf-annotation" data-annotation-id={a.id} data-kind={a.kind} data-selected={a.id === selectedId ? "true" : undefined}
                    style={{ left: pct(r[0]), top: pct(r[1]), width: pct(r[2]), height: pct(r[3]), "--pdfv-c": safeColor(a.color) } as React.CSSProperties} />))))}
                {onPage.some((a) => a.kind === "ink") && (
                  <svg className="pdfv-ink" viewBox="0 0 1 1" preserveAspectRatio="none">
                    {onPage.filter((a) => a.kind === "ink").map((a) => { const pts = inkPointsOf(a); return pts.length > 1 ? <polyline key={a.id} data-testid="pdf-annotation-ink" data-annotation-id={a.id} points={pts.map((p) => `${p[0]},${p[1]}`).join(" ")} fill="none" stroke={safeColor(a.color, "#1f2937")} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null; })}
                  </svg>
                )}
              </div>
              <div ref={textRef} className="pdfv-text" data-testid="pdf-textlayer" onPointerDown={(e) => e.currentTarget.classList.add("selecting")} onPointerUp={readSelection} onKeyUp={readSelection} onClick={onPageClick} />
              {editable && pending && pending.page === page && pageSize && (
                <div className="pdfv-seltools" role="toolbar" aria-label="Annotate the selection" style={{ left: toolbarX, ...(toolbarBelow ? { top: pending.y * pageSize.height + 6 } : { bottom: (1 - pending.rects[0][1]) * pageSize.height + 6 }) }}>
                  <ColorSwatches value={color} onChange={setColor} label="Highlight colour" />
                  <NodeButton label="Highlight" text onClick={() => create("highlight")}><Highlighter /></NodeButton>
                  <NodeButton label="Add note" text onClick={() => create("note")}><MessageSquarePlus /></NodeButton>
                </div>
              )}
            </div>
          </div>
          {renderError && <NodeState tone="danger" title="This page could not be drawn" hint={renderError} />}
          {research.ref && (
            <div className="pdfv-ref" data-testid="pdf-reference-link">
              <BookMarked aria-hidden /><span className="min-w-0 flex-1">PDF of <Link href={`/research?ref=${research.ref.id}`} className="pdfv-ref-name" title={research.ref.title}>{research.ref.label ?? research.ref.citeKey}</Link>{editable ? " — highlights and notes are saved as extracts of this reference." : "."}</span>
              {research.busy && <span className="nb-meta" role="status">Saving extracts…</span>}
              {editable && !research.busy && research.unlinked > 0 && <NodeButton label={`Save ${research.unlinked} annotation${research.unlinked === 1 ? "" : "s"} as extract${research.unlinked === 1 ? "" : "s"}`} text onClick={() => void research.syncAll()}><TextQuote /></NodeButton>}
            </div>
          )}
          {current && <AnnotationPanel key={current.id} annotation={current} editable={editable && current.kind !== "ink"} onPatch={(p) => patch(current.id, p)} onDelete={() => remove(current.id)} onClose={() => setSelectedId(null)} />}
          {sorted.length > 0 && (
            <ul className="pdfv-list" data-testid="pdf-annotation-list" aria-label="Annotations">
              {sorted.map((a) => (
                <li key={a.id}>
                  <button type="button" className={cn("pdfv-row", a.id === selectedId && "is-active")} aria-current={a.id === selectedId ? "true" : undefined} title={annotationLine(a)} onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { if (a.page !== page) go(a.page); setSelectedId(a.id); }}>
                    <span className="pdfv-dot" style={{ "--pdfv-c": safeColor(a.color) } as React.CSSProperties} data-kind={a.kind} aria-hidden />
                    <span className="pdfv-rowtext">{annotationLine(a)}</span>
                    {research.linked.has(a.id) && <span className="pdfv-extract" data-testid="pdf-annotation-extract" title={`Saved as an extract of ${research.ref?.label ?? "the reference"}`}><TextQuote aria-hidden /><span className="sr-only">Saved as an extract</span></span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Link to the untouched file (new tab; the body of a node view is left to the browser, so this is a real link). */
function OpenOriginal({ attachmentId, text }: { attachmentId: string; text?: boolean }) {
  return <a className={cn("nb-btn", text && "nb-btn-text")} href={fileUrl(attachmentId)} target="_blank" rel="noopener noreferrer" title="Open original" aria-label="Open original"><ExternalLink />{text && <span>Open original</span>}</a>;
}

function ColorSwatches({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <span className="pdfv-swatches" role="radiogroup" aria-label={label}>
      {HIGHLIGHT_COLORS.map((c) => (
        <button key={c.color} type="button" role="radio" aria-checked={value === c.color} aria-label={c.label} title={c.label} className="pdfv-swatch" style={{ "--pdfv-c": c.color } as React.CSSProperties}
          onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(c.color)} />
      ))}
    </span>
  );
}

/** Editor of one highlight / note under the page: its quote, colour, note text and deletion. Ink (from another client) is shown only. */
function AnnotationPanel({ annotation, editable, onPatch, onDelete, onClose }: { annotation: PdfAnnotation; editable: boolean; onPatch: (p: Partial<PdfAnnotation>) => void; onDelete: () => void; onClose: () => void }) {
  const stored = typeof annotation.note === "string" ? annotation.note : "";
  const [note, setNote] = React.useState(stored);
  const written = React.useRef(stored);
  React.useEffect(() => { if (stored !== written.current) { written.current = stored; setNote(stored); } }, [stored]);
  const deleted = React.useRef(false);
  const save = useDebounced((v: string) => { if (!deleted.current && v !== written.current) { written.current = v; onPatch({ note: v }); } }, 400);
  const field = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => { if (editable && annotation.kind === "note" && stored === "") field.current?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = annotation.kind === "ink" ? "Ink drawing" : annotation.kind === "note" ? "Note" : "Highlight";
  return (
    <div className="pdfv-panel" role="group" aria-label={`${kind} on page ${annotation.page}`}>
      <div className="pdfv-panel-head">
        <span className="nb-meta">{kind} · p.{annotation.page}</span>
        {editable && <ColorSwatches value={safeColor(annotation.color)} onChange={(c) => onPatch({ color: c })} label="Colour" />}
        <span className="pdfv-gap" />
        {editable && <NodeButton label="Delete annotation" tone="danger" onClick={() => { deleted.current = true; onDelete(); }}><Trash2 /></NodeButton>}
        <NodeButton label="Close" onClick={() => { save.flush(); onClose(); }}><X /></NodeButton>
      </div>
      {annotation.text && <blockquote className="pdfv-quote">{annotation.text}</blockquote>}
      {editable
        ? <textarea ref={field} className="pdfv-note" aria-label="Note" placeholder="Add a note…" rows={2} value={note} onChange={(e) => { setNote(e.target.value); save(e.target.value); }} onBlur={() => save.flush()} />
        : stored && <p className="pdfv-note-ro">{stored}</p>}
    </div>
  );
}
