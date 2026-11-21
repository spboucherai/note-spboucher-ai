/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/editor/nodes/MermaidView.tsx
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
 * file: src/components/editor/nodes/MermaidView.tsx
 * description: `mermaid` block — diagram source + live render. The `mermaid` library is loaded on demand (first diagram on screen),
 *   configured with `securityLevel: "strict"` and SVG text labels. The on-screen render follows the code after a short pause; the stored
 *   render (`preview` attachment, PNG at 2× so the native apps can show it without a web view, + `previewHash` = sha256 of the code) is
 *   uploaded only once the code has been stable for a while and the code field is not focused — never while typing.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { Workflow, Code2, Eye, RefreshCw, TriangleAlert } from "lucide-react";
import type { MermaidAttrs } from "@/lib/editor/next-node-defs";
import { sha256Hex } from "@/lib/editor/hash";
import { uploadBlob } from "@/lib/client/upload";
import { NodeFrame, NodeButton, NodeState, useDebounced, type LeafViewProps } from "./frame";

const SAMPLE = "flowchart LR\n  Idea --> Draft\n  Draft --> Review\n  Review -->|accepted| Published\n  Review -->|changes| Draft";
const RENDER_DELAY = 450; const UPLOAD_DELAY = 2500;

type Mermaid = typeof import("mermaid").default;
let lib: Promise<Mermaid> | null = null; let seq = 0;
const isDark = () => document.documentElement.classList.contains("dark");
/** One shared instance; re-initialised when the theme changed since the last render (diagram colours follow the app theme). */
async function mermaidFor(dark: boolean): Promise<Mermaid> {
  lib ??= import("mermaid").then((m) => m.default);
  const m = await lib;
  m.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral", htmlLabels: false, flowchart: { htmlLabels: false }, fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif" } as Parameters<Mermaid["initialize"]>[0]);
  return m;
}
/** Mermaid keeps global state while it renders: renders are run one at a time (on-screen render, stored render, several diagrams). */
let chain: Promise<unknown> = Promise.resolve();
export function renderMermaid(code: string, dark: boolean): Promise<{ svg: string } | { error: string }> {
  const run = chain.then(() => renderOne(code, dark), () => renderOne(code, dark)); chain = run.catch(() => undefined); return run;
}
async function renderOne(code: string, dark: boolean): Promise<{ svg: string } | { error: string }> {
  if (!code.trim()) return { error: "empty" };
  try { const m = await mermaidFor(dark); await m.parse(code); const { svg } = await m.render(`mmd-${Date.now().toString(36)}-${++seq}`, code); return { svg }; }
  catch (e) { document.querySelectorAll("body > [id^='dmmd-'], body > svg[id^='mmd-']").forEach((n) => n.remove()); return { error: e instanceof Error ? e.message.split("\n").slice(0, 4).join("\n") : "Invalid diagram" }; }
}
/** SVG markup → PNG blob (2×). Falls back to null when the browser refuses to rasterise (the caller then uploads the SVG itself). */
export async function svgToPng(svg: string, scale = 2): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml"); const el = doc.documentElement; const vb = (el.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
    const w = Math.ceil(vb[2] || parseFloat(el.getAttribute("width") ?? "") || 800), h = Math.ceil(vb[3] || parseFloat(el.getAttribute("height") ?? "") || 600);
    el.setAttribute("width", String(w)); el.setAttribute("height", String(h)); el.removeAttribute("style");
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(el))}`;
    const img = new Image(); img.decoding = "async"; await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("svg image")); img.src = url; });
    const k = Math.min(scale, 4096 / Math.max(w, h)); const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext("2d"); if (!ctx) return null; ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png")); return blob ? { blob, width: w, height: h } : null;
  } catch { return null; }
}

export function MermaidView({ attrs, update, editable, selected, pageId, editor }: LeafViewProps<MermaidAttrs>) {
  const [code, setCode] = React.useState(attrs.code); const [svg, setSvg] = React.useState<string | null>(null); const [error, setError] = React.useState<string | null>(null);
  const [showCode, setShowCode] = React.useState(editable && !attrs.code); const [busy, setBusy] = React.useState(false);
  const focused = React.useRef(false); const latest = React.useRef(attrs); latest.current = attrs; const host = React.useRef<HTMLDivElement>(null); const [seen, setSeen] = React.useState(false);
  // remote change of the code (another session, undo): follow it unless the user is typing here
  React.useEffect(() => { if (!focused.current) setCode(attrs.code); }, [attrs.code]);
  // lazy: nothing is loaded until the block is near the viewport
  React.useEffect(() => { const el = host.current; if (!el || seen) return; if (typeof IntersectionObserver === "undefined") { setSeen(true); return; } const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "400px" }); io.observe(el); return () => io.disconnect(); }, [seen]);
  /** True once the user changed the source in this view: only then is the stored render refreshed on its own (see below). */
  const touched = React.useRef(false);
  const commit = useDebounced((c: string) => { if (c !== latest.current.code) { touched.current = true; update({ code: c }); } }, RENDER_DELAY);
  // on-screen render: after a pause, and again when the theme flips
  const [theme, setTheme] = React.useState(0);
  React.useEffect(() => { const mo = new MutationObserver(() => setTheme((t) => t + 1)); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); return () => mo.disconnect(); }, []);
  React.useEffect(() => {
    if (!seen) return; if (!code.trim()) { setSvg(null); setError(null); return; }
    let live = true; const t = setTimeout(async () => { setBusy(true); const r = await renderMermaid(code, isDark()); if (!live) return; setBusy(false); if ("svg" in r) { setSvg(r.svg); setError(null); } else setError(r.error); }, RENDER_DELAY);
    return () => { live = false; clearTimeout(t); };
  }, [code, seen, theme]);
  // stored render: only when the code is valid, stable, not being typed, and its hash differs from the stored one
  const [uploading, setUploading] = React.useState(false); const uploadSeq = React.useRef(0);
  const storeRender = React.useCallback(async () => {
    const src = latest.current.code; if (!editable || !src.trim() || focused.current) return;
    const hash = await sha256Hex(src); if (latest.current.previewHash === hash && latest.current.preview) return;
    const mine = ++uploadSeq.current; setUploading(true);
    try {
      const r = await renderMermaid(src, false); if (!("svg" in r) || mine !== uploadSeq.current || latest.current.code !== src) return; // always the light render: it is what other clients display on any background
      const png = await svgToPng(r.svg);
      const up = png ? await uploadBlob(png.blob, `diagram-${hash.slice(0, 12)}.png`, "image/png", pageId) : await uploadBlob(r.svg, `diagram-${hash.slice(0, 12)}.svg`, "image/svg+xml", pageId);
      if (mine === uploadSeq.current && latest.current.code === src) update({ preview: up.id, previewHash: hash });
    } catch { /* offline or refused: the hash stays stale, natives show the source with their notice; retried at the next change or with the refresh button */ }
    finally { if (mine === uploadSeq.current) setUploading(false); }
  }, [editable, pageId, update]);
  /*
   * VIEWING a page never writes the stored render (3.0 integration: opening a note whose diagram had no render, or a stale one — written
   * by a native client, imported — used to upload a PNG and save the page: a version, a new `rev`, a `page.edited` event, without any
   * user edit). It is written (1) after the user changed the source here, (2) on "Save the render now", or (3) together with a real
   * user edit elsewhere in the document (the page is being saved anyway). Until then the header says "Render not saved yet".
   */
  React.useEffect(() => { if (!editable || !seen || !attrs.code.trim() || error || !touched.current) return; const t = setTimeout(storeRender, UPLOAD_DELAY); return () => clearTimeout(t); }, [attrs.code, editable, seen, error, storeRender]);
  const piggyback = React.useRef<ReturnType<typeof setTimeout> | null>(null); const ready = React.useRef(false); ready.current = editable && seen && !error;
  React.useEffect(() => {
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean; getMeta: (k: string) => unknown } }) => {
      if (!transaction.docChanged || transaction.getMeta("addToHistory") === false || !ready.current) return;
      if (piggyback.current) clearTimeout(piggyback.current); piggyback.current = setTimeout(() => { void storeRender(); }, UPLOAD_DELAY); // storeRender does nothing when the stored hash is current
    };
    editor.on("update", onUpdate); return () => { editor.off("update", onUpdate); if (piggyback.current) clearTimeout(piggyback.current); };
  }, [editor, storeRender]);
  const [stale, setStale] = React.useState(false);
  React.useEffect(() => { let live = true; if (!attrs.code.trim()) { setStale(false); return; } sha256Hex(attrs.code).then((h) => { if (live) setStale(!attrs.preview || attrs.previewHash !== h); }); return () => { live = false; }; }, [attrs.code, attrs.preview, attrs.previewHash]);

  return (
    <NodeFrame kind="mermaid" icon={<Workflow />} label="Diagram" selected={selected} title={<span className="nb-meta">{uploading ? "Saving render…" : busy ? "Rendering…" : attrs.code.trim() && !error ? (stale ? "Render not saved yet" : "Render saved") : ""}</span>}
      actions={<>{editable && attrs.code.trim() && !error && stale && !uploading && <NodeButton label="Save the render now" onClick={() => { focused.current = false; void storeRender(); }}><RefreshCw /></NodeButton>}{editable && <NodeButton label={showCode ? "Hide source" : "Edit source"} active={showCode} onClick={() => setShowCode((s) => !s)}>{showCode ? <Eye /> : <Code2 />}</NodeButton>}</>}>
      <div ref={host}>
        {showCode && editable && <textarea className="nb-code" aria-label="Mermaid source" spellCheck={false} autoCapitalize="off" autoCorrect="off" rows={Math.min(16, Math.max(4, code.split("\n").length + 1))} value={code} placeholder={SAMPLE}
          onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; commit.flush(); }} onChange={(e) => { setCode(e.target.value); commit(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Tab") { e.preventDefault(); const el = e.currentTarget; const { selectionStart: s, selectionEnd: en } = el; const v = el.value.slice(0, s) + "  " + el.value.slice(en); setCode(v); commit(v); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; }); } }} />}
        {!code.trim() ? <NodeState icon={<Workflow />} title="Empty diagram" hint="Describe a flowchart, sequence, Gantt or class diagram in Mermaid syntax.">{editable && <NodeButton label="Insert an example" text tone="accent" onClick={() => { touched.current = true; setCode(SAMPLE); update({ code: SAMPLE }); setShowCode(true); }} />}</NodeState>
          : error ? <div className="mmd-error" role="status"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /><div className="min-w-0"><div className="font-medium">This diagram has a syntax error</div><pre className="mmd-error-detail">{error}</pre>{svg && <div className="nb-meta mt-1">Showing the last valid render below.</div>}</div></div> : null}
        {svg && code.trim() ? <div className="mmd-render nb-scroll" data-testid="mermaid-render" role="img" aria-label="Diagram" dangerouslySetInnerHTML={{ __html: svg }} /> : code.trim() && !error ? <div className="mmd-render"><div className="skeleton h-32 w-full" /></div> : null}
      </div>
    </NodeFrame>
  );
}
