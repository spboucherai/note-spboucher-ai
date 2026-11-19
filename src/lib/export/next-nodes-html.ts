/**
 * File: src/lib/export/next-nodes-html.ts
 * Description: print-ready HTML of the 3.0 document nodes (SPEC §2) for `?format=pdf|html`. Static output only: a chart is its data
 *   table, a drawing / Mermaid diagram is its stored render, code is never executed. Same content as the Markdown form
 *   (src/lib/editor/next-nodes.ts), one element per node, class `nx nx-<type>`.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import type { PMNode } from "@/lib/editor/text";
import { cellText, timecode } from "@/lib/editor/next-nodes";
import type { Resolvers } from "./markdown";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: unknown) => (typeof v === "string" ? v.replace(/\s*\n\s*/g, " ").trim() : "");
const file = (n: PMNode, r: Resolvers, id: unknown): string | null => { if (typeof id !== "string" || !UUID.test(id)) return null; const src = `/api/files/${id.toLowerCase()}`; return n.attrs?.__href?.[id.toLowerCase()] ?? r.file?.(src) ?? src; };

export function nextNodeHtml(n: PMNode, r: Resolvers = {}): string | null {
  const a = n.attrs ?? {};
  switch (n.type) {
    case "mermaid": { const img = file(n, r, a.preview); return `<figure class="nx nx-mermaid">${img ? `<img src="${esc(img)}" alt="Diagramme">` : ""}<pre><code class="language-mermaid">${esc(a.code)}</code></pre></figure>`; }
    case "runCode": { const out = a.output && typeof a.output === "object" && typeof a.output.text === "string" ? a.output.text : null; return `<div class="nx nx-runcode"><pre><code class="language-${esc(a.language ?? "")}">${esc(a.code)}</code></pre>${out === null ? "" : `<pre class="nx-output${a.output.error ? " nx-error" : ""}"><code>${esc(out)}</code></pre>`}</div>`; }
    case "chart": {
      const cols: unknown[] = Array.isArray(a.columns) ? a.columns : []; const rows: unknown[][] = Array.isArray(a.rows) ? a.rows.filter((x: unknown) => Array.isArray(x)) : []; const title = one(a.title);
      const table = cols.length ? `<table><tr>${cols.map((c) => `<th>${esc(cellText(c))}</th>`).join("")}</tr>${rows.map((row) => `<tr>${cols.map((_c, i) => `<td>${esc(cellText(row[i]))}</td>`).join("")}</tr>`).join("")}</table>` : "";
      return `<figure class="nx nx-chart">${title ? `<figcaption>${esc(title)}</figcaption>` : ""}${table}</figure>`;
    }
    case "drawing": { const img = file(n, r, a.preview); return img ? `<figure class="nx nx-drawing"><img src="${esc(img)}" alt="Dessin"></figure>` : `<p class="nx nx-drawing">[Dessin]</p>`; }
    case "pdf": {
      const href = file(n, r, a.attachmentId); const name = one(a.name) ? `PDF: ${one(a.name)}` : "PDF"; const notes: any[] = Array.isArray(a.annotations) ? a.annotations.filter((x: unknown) => x && typeof x === "object") : [];
      return `<div class="nx nx-pdf"><p class="file">📎 ${href ? `<a href="${esc(href)}">${esc(name)}</a>` : esc(name)}</p>${notes.length ? `<ul>${notes.map((x) => `<li>${esc([`p.${Math.max(1, Math.floor(Number(x.page)) || 1)}`, one(x.text), one(x.note)].filter(Boolean).join(" — "))}</li>`).join("")}</ul>` : ""}</div>`;
    }
    case "audio": {
      const href = file(n, r, a.attachmentId); const name = one(a.title) ? `Audio: ${one(a.title)}` : "Audio"; const segs: any[] = Array.isArray(a.transcript) ? a.transcript.filter((x: any) => x && typeof x === "object" && one(x.text)) : [];
      return `<div class="nx nx-audio"><p class="file">🎙 ${href ? `<a href="${esc(href)}">${esc(name)}</a>` : esc(name)}</p>${segs.map((s) => `<p class="nx-seg"><small>[${timecode(s.t)}]</small> ${esc(one(s.text))}</p>`).join("")}</div>`;
    }
    case "queryView": return `<p class="nx nx-query">[${esc(one(a.title) ? `Vue: ${one(a.title)}` : "Vue")}]</p>`;
    case "blockRef": { const p = typeof a.pageId === "string" && UUID.test(a.pageId) ? a.pageId.toLowerCase() : null; const href = p ? r.mention?.(p, "") ?? `/p/${p}${typeof a.blockId === "string" && a.blockId ? `#block-${a.blockId}` : ""}` : null; return href ? `<p class="nx nx-blockref"><a href="${esc(href)}">↗ ${esc(p)}${a.blockId ? `#${esc(a.blockId)}` : ""}</a></p>` : `<p class="nx nx-blockref">Référence introuvable</p>`; }
    case "citation": return `<span class="nx nx-citation">[${esc(one(a.label) || (typeof a.refId === "string" ? a.refId : "?"))}${one(a.locator) ? `, ${esc(one(a.locator))}` : ""}]</span>`;
    case "bibliography": return `<h2 class="nx nx-bibliography">${esc(one(a.title) || "Références")}</h2>`;
    case "canvasLink": { const p = typeof a.pageId === "string" && UUID.test(a.pageId) ? a.pageId.toLowerCase() : null; return p ? `<p class="nx nx-canvas"><a href="${esc(r.mention?.(p, "Canvas") ?? `/p/${p}`)}">Canvas</a></p>` : `<p class="nx nx-canvas">[Canvas]</p>`; }
    default: return null;
  }
}
