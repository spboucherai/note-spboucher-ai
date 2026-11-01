/** ProseMirror JSON → print-ready HTML (used by ?format=pdf). KaTeX rendered server-side; CSS + fonts inlined (CSP: font-src data:). */
import fs from "node:fs";
import path from "node:path";
import katex from "katex";
import type { PMNode } from "@/lib/editor/text";
import type { Resolvers } from "./markdown";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeHref = (h: unknown) => { const s = String(h ?? ""); return /^(https?:\/\/|mailto:|\/p\/|\/api\/files\/|\.{1,2}\/|#)/i.test(s) ? s : "#"; };
const tex = (latex: string, display: boolean) => { try { return katex.renderToString(latex, { displayMode: display, throwOnError: false, output: "htmlAndMathml" }); } catch { return `<code>${esc(latex)}</code>`; } };

export function docToHtml(doc: PMNode | null | undefined, r: Resolvers = {}): { html: string; hasMath: boolean } {
  let hasMath = false;
  const inline = (n: PMNode): string => {
    if (n.type === "text") { let t = esc(n.text); for (const m of n.marks ?? []) { if (m.type === "bold") t = `<strong>${t}</strong>`; else if (m.type === "italic") t = `<em>${t}</em>`; else if (m.type === "code") t = `<code>${t}</code>`; else if (m.type === "strike") t = `<s>${t}</s>`; else if (m.type === "underline") t = `<u>${t}</u>`; else if (m.type === "highlight") t = `<mark>${t}</mark>`; else if (m.type === "subscript") t = `<sub>${t}</sub>`; else if (m.type === "superscript") t = `<sup>${t}</sup>`; else if (m.type === "link") { const pm = String(m.attrs?.href ?? "").match(/^\/p\/([0-9a-f-]{36})/); const href = pm && r.mention ? r.mention(pm[1], n.text ?? "") ?? m.attrs?.href : (r.file?.(String(m.attrs?.href ?? "")) ?? m.attrs?.href); t = `<a href="${esc(safeHref(href))}">${t}</a>`; } } return t; }
    if (n.type === "hardBreak") return "<br>";
    if (n.type === "mention") { const label = esc(n.attrs?.label ?? n.attrs?.id); const href = r.mention?.(String(n.attrs?.id ?? ""), String(n.attrs?.label ?? "")); return href ? `<a class="mention" href="${esc(safeHref(href))}">@${label}</a>` : `<span class="mention">@${label}</span>`; }
    if (n.type === "inlineMath" || n.type === "math") { hasMath = true; return tex(String(n.attrs?.latex ?? ""), false); }
    if (n.type === "footnoteRef") return `<sup class="fn"><a href="#fn-${esc(n.attrs?.id)}">${esc(n.attrs?.id)}</a></sup>`;
    return (n.content ?? []).map(inline).join("");
  };
  const blocks = (ns: PMNode[] | undefined) => (ns ?? []).map(block).join("\n");
  const block = (n: PMNode): string => {
    switch (n.type) {
      case "paragraph": return `<p>${inline(n)}</p>`;
      case "heading": { const l = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1))); return `<h${l}>${inline(n)}</h${l}>`; }
      case "blockquote": return `<blockquote>${blocks(n.content)}</blockquote>`;
      case "codeBlock": return `<pre><code class="language-${esc(n.attrs?.language ?? "")}">${esc((n.content ?? []).map((c) => c.text ?? "").join(""))}</code></pre>`;
      case "bulletList": return `<ul>${(n.content ?? []).map((li) => `<li>${blocks(li.content)}</li>`).join("")}</ul>`;
      case "orderedList": return `<ol start="${Number(n.attrs?.start ?? 1)}">${(n.content ?? []).map((li) => `<li>${blocks(li.content)}</li>`).join("")}</ol>`;
      case "taskList": return `<ul class="tasks">${(n.content ?? []).map((li) => `<li class="${li.attrs?.checked ? "done" : ""}"><input type="checkbox" disabled ${li.attrs?.checked ? "checked" : ""}> <div>${blocks(li.content)}</div></li>`).join("")}</ul>`;
      case "table": { const rows = n.content ?? []; return `<table>${rows.map((row, i) => `<tr>${(row.content ?? []).map((c) => { const tag = c.type === "tableHeader" || i === 0 ? "th" : "td"; const a = c.attrs ?? {}; return `<${tag}${a.colspan > 1 ? ` colspan="${a.colspan}"` : ""}${a.rowspan > 1 ? ` rowspan="${a.rowspan}"` : ""}>${blocks(c.content)}</${tag}>`; }).join("")}</tr>`).join("")}</table>`; }
      case "horizontalRule": return "<hr>";
      case "image": { const src = r.file?.(String(n.attrs?.src ?? "")) ?? n.attrs?.src; return `<figure><img src="${esc(safeHref(src))}" alt="${esc(n.attrs?.alt ?? "")}">${n.attrs?.title ? `<figcaption>${esc(n.attrs.title)}</figcaption>` : ""}</figure>`; }
      case "fileBlock": { const src = r.file?.(String(n.attrs?.src ?? "")) ?? n.attrs?.src; return `<p class="file">📎 <a href="${esc(safeHref(src))}">${esc(n.attrs?.name ?? "file")}</a>${n.attrs?.size ? ` <small>(${Math.round(Number(n.attrs.size) / 1024)} KB)</small>` : ""}</p>`; }
      case "youtube": return `<p class="file">▶ <a href="${esc(safeHref(n.attrs?.src))}">${esc(n.attrs?.src)}</a></p>`;
      case "blockMath": hasMath = true; return `<div class="math-block">${tex(String(n.attrs?.latex ?? ""), true)}</div>`;
      case "callout": return `<div class="callout callout-${esc(n.attrs?.kind ?? "note")}"><span class="callout-icon">${esc(n.attrs?.icon ?? "💡")}</span><div>${blocks(n.content)}</div></div>`;
      case "aiBlock": return `<div class="ai-block" title="Generated by ${esc(n.attrs?.model ?? "AI")}">${blocks(n.content)}</div>`;
      case "details": { const s = n.content?.find((c) => c.type === "detailsSummary"); const b = n.content?.find((c) => c.type === "detailsContent"); return `<details open><summary>${s ? inline(s) : ""}</summary>${blocks(b?.content)}</details>`; }
      case "footnote": return `<p class="footnote" id="fn-${esc(n.attrs?.id)}"><sup>${esc(n.attrs?.id)}</sup> ${(n.content ?? []).map(inline).join(" ")}</p>`;
      default: return n.content ? blocks(n.content) : n.text ? `<p>${esc(n.text)}</p>` : "";
    }
  };
  const html = blocks(doc?.content);
  return { html, hasMath };
}

let katexCssCache: string | null = null;
/** katex.min.css with the woff2 fonts inlined as data: URIs (works under the app CSP, no external requests). */
function katexCss(): string {
  if (katexCssCache) return katexCssCache;
  try {
    const dir = path.join(process.cwd(), "node_modules", "katex", "dist");
    let css = fs.readFileSync(path.join(dir, "katex.min.css"), "utf8");
    css = css.replace(/url\(fonts\/([^)]+?\.woff2)\)\s*format\("woff2"\),?/g, (_m, f) => { try { const b = fs.readFileSync(path.join(dir, "fonts", f)); return `url(data:font/woff2;base64,${b.toString("base64")}) format("woff2"),`; } catch { return ""; } });
    css = css.replace(/,?\s*url\(fonts\/[^)]+?\.(woff|ttf)\)\s*format\("(woff|truetype)"\)/g, "");
    katexCssCache = css;
  } catch { katexCssCache = ""; }
  return katexCssCache;
}

const PRINT_CSS = `
:root{--fg:#111;--muted:#666;--line:#ddd;--sunk:#f5f5f4;--accent:#2563eb}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#fff;color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 28px 60px}
header.doc h1{font-size:30px;line-height:1.2;margin:0 0 6px;letter-spacing:-.01em}
header.doc .meta{color:var(--muted);font-size:12.5px;display:flex;flex-wrap:wrap;gap:6px 14px;margin-bottom:8px}
header.doc .props{display:grid;grid-template-columns:max-content 1fr;gap:3px 14px;font-size:13px;margin:10px 0 0;padding:10px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
header.doc .props dt{color:var(--muted)}header.doc .props dd{margin:0}
h1,h2,h3,h4{line-height:1.25;margin:1.5em 0 .5em;page-break-after:avoid}h1{font-size:24px}h2{font-size:20px}h3{font-size:17px}h4{font-size:15px}
p{margin:.6em 0}a{color:var(--accent);text-decoration:none}a.mention{background:var(--sunk);padding:0 4px;border-radius:4px;color:inherit}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--sunk);padding:1px 4px;border-radius:4px}
pre{background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow-x:auto;page-break-inside:avoid}pre code{background:none;padding:0}
blockquote{margin:1em 0;padding:2px 16px;border-left:3px solid var(--line);color:#333}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:13.5px;page-break-inside:avoid}th,td{border:1px solid var(--line);padding:6px 9px;vertical-align:top;text-align:left}th{background:var(--sunk)}td p,th p{margin:0}
ul,ol{padding-left:1.5em}li>p{margin:.2em 0}ul.tasks{list-style:none;padding-left:.2em}ul.tasks li{display:flex;gap:8px;align-items:flex-start}ul.tasks li.done{color:var(--muted);text-decoration:line-through}ul.tasks input{margin-top:6px}
figure{margin:1.2em 0;text-align:center;page-break-inside:avoid}figure img{max-width:100%;height:auto;border-radius:6px}figcaption{color:var(--muted);font-size:12.5px;margin-top:4px}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}mark{background:#fef08a}
.callout{display:flex;gap:10px;padding:12px 14px;border-radius:8px;background:var(--sunk);border:1px solid var(--line);margin:1em 0;page-break-inside:avoid}.callout-warning{background:#fef3c7}.callout-danger{background:#fee2e2}.callout-info{background:#dbeafe}.callout>div>p:first-child{margin-top:0}.callout>div>p:last-child{margin-bottom:0}
.ai-block{border-left:3px solid #8b5cf6;padding-left:12px;margin:1em 0}.math-block{margin:1em 0;overflow-x:auto}
.file{background:var(--sunk);border:1px solid var(--line);border-radius:6px;padding:6px 10px}
details{border:1px solid var(--line);border-radius:6px;padding:6px 12px;margin:1em 0}summary{font-weight:600;cursor:pointer}
.footnote{font-size:13px;color:#333}footer{margin-top:40px;padding-top:10px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
.toolbar{position:fixed;top:12px;right:12px;display:flex;gap:8px}.toolbar button{font:13px/1 inherit;padding:9px 14px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.08)}
@page{margin:18mm 16mm}
@media print{.toolbar{display:none}main{max-width:none;padding:0}a{color:inherit}a[href^="http"]:after{content:" (" attr(href) ")";font-size:85%;color:var(--muted)}}
`;
export function printHtml(opts: { title: string; icon?: string | null; meta: string[]; props: Record<string, unknown>; bodyHtml: string; hasMath: boolean; footer: string; autoPrint?: boolean }) {
  const props = Object.entries(opts.props).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length));
  const fmt = (v: unknown) => (Array.isArray(v) ? v.map((x) => esc(typeof x === "object" ? JSON.stringify(x) : x)).join(", ") : typeof v === "object" ? esc(JSON.stringify(v)) : esc(v));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title>
<style>${PRINT_CSS}</style>${opts.hasMath ? `<style>${katexCss()}</style>` : ""}</head>
<body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
<main><header class="doc"><h1>${opts.icon ? `<span>${esc(opts.icon)}</span> ` : ""}${esc(opts.title)}</h1><div class="meta">${opts.meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>${props.length ? `<dl class="props">${props.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${fmt(v)}</dd>`).join("")}</dl>` : ""}</header>
<article>${opts.bodyHtml}</article>
<footer>${esc(opts.footer)}</footer></main>${opts.autoPrint ? "<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300))</script>" : ""}</body></html>`;
}
