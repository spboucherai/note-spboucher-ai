/**
 * file: src/lib/editor/markdown-client.ts
 * description: Markdown ↔ ProseMirror JSON on the client. Import (`markdownToDoc`): headings, paragraphs, lists, tasks, quotes, code,
 *   tables, hr, inline marks, math — and, since 3.0, the Markdown forms of the Next Generation nodes (SPEC §2) wherever the form
 *   identifies the node. Export (`docToMarkdown`): the new nodes are first expanded to their SPEC form, then the shared `toMarkdown`
 *   of text.ts (owned by the backend workstream) does the rest. Used for AI output insertion, Markdown paste and "copy as Markdown".
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { marked, type Token, type Tokens } from "marked";
import { toMarkdown, type PMNode } from "./text";
import { NEXT_NODE_NAMES } from "./next-nodes";
function inline(tokens: Token[] | undefined, marks: { type: string; attrs?: any }[] = []): PMNode[] {
  const out: PMNode[] = [];
  for (const t of tokens ?? []) {
    const tt = t as any;
    switch (t.type) {
      case "text": if (tt.tokens) out.push(...inline(tt.tokens, marks)); else if (tt.text) out.push({ type: "text", text: unescape(tt.text), ...(marks.length ? { marks } : {}) }); break;
      case "strong": out.push(...inline(tt.tokens, [...marks, { type: "bold" }])); break;
      case "em": out.push(...inline(tt.tokens, [...marks, { type: "italic" }])); break;
      case "del": out.push(...inline(tt.tokens, [...marks, { type: "strike" }])); break;
      case "codespan": { const m = tt.text.match(/^\$(.+)\$$/); if (m) out.push({ type: "inlineMath", attrs: { latex: m[1] } }); else out.push({ type: "text", text: unescape(tt.text), marks: [...marks, { type: "code" }] }); break; }
      case "link": out.push(...inline(tt.tokens, [...marks, { type: "link", attrs: { href: tt.href } }])); break;
      case "br": out.push({ type: "hardBreak" }); break;
      case "escape": out.push({ type: "text", text: tt.text, ...(marks.length ? { marks } : {}) }); break;
      case "html": out.push({ type: "text", text: tt.text, ...(marks.length ? { marks } : {}) }); break;
      case "image": out.push({ type: "text", text: `[image: ${tt.text || tt.href}]`, ...(marks.length ? { marks } : {}) }); break;
      default: if (tt.tokens) out.push(...inline(tt.tokens, marks)); else if (tt.text) out.push({ type: "text", text: unescape(tt.text), ...(marks.length ? { marks } : {}) });
    }
  }
  // split inline $...$ math and [@citation] markers inside plain text nodes
  const res: PMNode[] = [];
  for (const n of out) { if (n.type !== "text" || !n.text || n.marks?.some((m) => m.type === "code")) { res.push(n); continue; } const parts = n.text.split(/(\$[^$\n]+?\$|\[@[^\]\n]{1,200}\])/g); for (const p of parts) { if (!p) continue; const m = p.match(/^\$([^$]+)\$$/); const c = p.match(/^\[@([^\]]+)\]$/); if (m) res.push({ type: "inlineMath", attrs: { latex: m[1] } }); else if (c) res.push(citationFrom(c[1])); else res.push({ ...n, text: p }); } }
  return res;
}
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** `[@Gorton & Metrick 2019, p. 12]` → citation (label + locator); `[@<uuid>]` → citation bound to that reference id. */
function citationFrom(body: string): PMNode {
  const t = body.trim(); if (new RegExp(`^${UUID}$`, "i").test(t)) return { type: "citation", attrs: { refId: t.toLowerCase(), locator: "", label: "" } };
  const i = t.search(/,\s*(p\.|pp\.|chap\.|ch\.|sec\.|§|fig\.|tab\.|n\.)/i); return { type: "citation", attrs: { refId: null, label: (i > 0 ? t.slice(0, i) : t).trim(), locator: i > 0 ? t.slice(i + 1).trim() : "" } };
}
const FILE_LINK = new RegExp(`^\\[(PDF|Audio): ([^\\]]*)\\]\\(/api/files/(${UUID})\\)$`, "i");
const stampSeconds = (s: string) => s.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
/**
 * Paragraph-level forms of SPEC §2 that identify their node: `[[<pageId>#<blockId>]]` → blockRef, `[Canvas](/p/<id>)` → canvasLink,
 * `[Vue: title]` → queryView (title only: the query itself is not in the Markdown), `![Dessin](/api/files/<id>)` → drawing (preview only),
 * `[PDF: name](/api/files/<id>)` → pdf, `[Audio: title](/api/files/<id>)` → audio. Returns null for anything else.
 */
function nextNodeFromParagraph(raw: string): PMNode | null {
  const t = raw.trim(); let m: RegExpMatchArray | null;
  if ((m = t.match(new RegExp(`^\\[\\[(${UUID})#([\\w-]{1,64})\\]\\]$`, "i")))) return { type: "blockRef", attrs: { pageId: m[1].toLowerCase(), blockId: m[2], mode: "embed" } };
  if ((m = t.match(new RegExp(`^\\[Canvas\\]\\(/p/(${UUID})\\)$`, "i")))) return { type: "canvasLink", attrs: { pageId: m[1].toLowerCase() } };
  if ((m = t.match(/^\[Vue: ([^\]]*)\]$/))) return { type: "queryView", attrs: { source: "tasks", databaseId: null, viewId: null, filter: {}, layout: "list", limit: 25, title: m[1].trim() } };
  if ((m = t.match(new RegExp(`^!\\[Dessin\\]\\(/api/files/(${UUID})\\)$`, "i")))) return { type: "drawing", attrs: { ink: null, preview: m[1].toLowerCase(), pk: null, width: 0, height: 0, background: "none" } };
  if ((m = t.match(FILE_LINK))) return m[1].toLowerCase() === "pdf" ? { type: "pdf", attrs: { attachmentId: m[3].toLowerCase(), name: m[2].trim(), page: 1, annotations: [] } } : { type: "audio", attrs: { attachmentId: m[3].toLowerCase(), duration: 0, title: m[2].trim(), recordedAt: null, transcript: [], transcriptStatus: "none", transcriptEngine: null, summary: null } };
  return null;
}
const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const para = (content: PMNode[]): PMNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
function blocks(tokens: Token[]): PMNode[] {
  const out: PMNode[] = [];
  for (const t of tokens) {
    const tt = t as any;
    switch (t.type) {
      case "heading": out.push({ type: "heading", attrs: { level: Math.min(3, tt.depth) }, content: inline(tt.tokens) }); break;
      case "paragraph": {
        const m = tt.text?.match(/^\$\$([\s\S]+?)\$\$$/); if (m) { out.push({ type: "blockMath", attrs: { latex: m[1].trim() } }); break; }
        const prev = out[out.length - 1]; const lines: string[] = String(tt.text ?? "").split("\n").map((l: string) => l.trim()).filter(Boolean);
        // transcript lines right after an audio link: `[mm:ss] text`
        if (prev?.type === "audio" && lines.length && lines.every((l) => /^\[\d{1,3}(:\d{2}){1,2}\]\s/.test(l))) { const add = lines.map((l) => { const mm = l.match(/^\[([\d:]+)\]\s+(.*)$/)!; return { t: stampSeconds(mm[1]), text: mm[2] }; }); out[out.length - 1] = { ...prev, attrs: { ...prev.attrs, transcript: [...(prev.attrs?.transcript ?? []), ...add], transcriptStatus: "done" } }; break; }
        const node = nextNodeFromParagraph(String(tt.text ?? "")); if (node) out.push(node); else out.push(para(inline(tt.tokens))); break;
      }
      case "text": out.push(para(inline(tt.tokens ?? [{ type: "text", text: tt.text } as any]))); break;
      case "blockquote": {
        // annotation lines right after a PDF link: `> p.<page> — <text> — <note>`
        const prev = out[out.length - 1]; const lines: string[] = String(tt.text ?? "").split("\n").map((l: string) => l.trim()).filter(Boolean);
        if (prev?.type === "pdf" && lines.length && lines.every((l) => /^p\.\s?\d+\s+—/.test(l))) { const base = (prev.attrs?.annotations ?? []).length; const add = lines.map((l, i) => { const [p, text = "", ...note] = l.split(/\s+—\s+/); return { id: `md${base + i + 1}`, page: Number(p.replace(/\D/g, "")) || 1, kind: note.join(" — ").trim() && !text.trim() ? "note" : "highlight", color: "#f5c542", rects: [], text: text.trim(), note: note.join(" — ").trim(), createdAt: new Date(0).toISOString() }; }); out[out.length - 1] = { ...prev, attrs: { ...prev.attrs, annotations: [...(prev.attrs?.annotations ?? []), ...add] } }; break; }
        out.push({ type: "blockquote", content: blocks(tt.tokens) }); break;
      }
      case "code": {
        if (tt.lang === "math") { out.push({ type: "blockMath", attrs: { latex: tt.text } }); break; }
        if (tt.lang === "mermaid") { out.push({ type: "mermaid", attrs: { code: tt.text ?? "", preview: null, previewHash: null } }); break; }
        // a fenced `output` block right after a code block is the last output of runnable code (SPEC §2): the pair becomes a runCode node
        const prev = out[out.length - 1];
        if (tt.lang === "output" && (prev?.type === "codeBlock" || (prev?.type === "runCode" && !prev.attrs?.output))) { out[out.length - 1] = { type: "runCode", attrs: { language: prev.type === "runCode" ? prev.attrs?.language : prev.attrs?.language || "javascript", code: prev.type === "runCode" ? prev.attrs?.code : (prev.content ?? []).map((c) => c.text ?? "").join(""), output: { text: tt.text ?? "", error: false, ms: 0, at: new Date(0).toISOString() } } }; break; }
        out.push({ type: "codeBlock", attrs: { language: tt.lang || null }, content: tt.text ? [{ type: "text", text: tt.text }] : [] }); break;
      }
      case "hr": out.push({ type: "horizontalRule" }); break;
      case "space": break;
      case "list": {
        const items: Tokens.ListItem[] = tt.items; const isTask = items.some((i) => i.task);
        const li = items.map((i) => { const c = blocks(i.tokens as Token[]); const content = c.length ? (c[0].type === "paragraph" || c[0].type === "heading" ? c : [para([]), ...c]) : [para([])]; return isTask ? { type: "taskItem", attrs: { checked: Boolean(i.checked) }, content } : { type: "listItem", content }; });
        out.push(isTask ? { type: "taskList", content: li } : tt.ordered ? { type: "orderedList", attrs: { start: tt.start || 1 }, content: li } : { type: "bulletList", content: li }); break;
      }
      case "table": {
        const row = (cells: any[], header: boolean) => ({ type: "tableRow", content: cells.map((c) => ({ type: header ? "tableHeader" : "tableCell", content: [para(inline(c.tokens))] })) });
        out.push({ type: "table", content: [row(tt.header, true), ...tt.rows.map((r: any[]) => row(r, false))] }); break;
      }
      case "html": out.push(para([{ type: "text", text: tt.text }])); break;
      default: if (tt.tokens) out.push(para(inline(tt.tokens))); else if (tt.raw?.trim()) out.push(para([{ type: "text", text: tt.raw }]));
    }
  }
  return out;
}
export function markdownToDoc(md: string): PMNode[] {
  const tokens = marked.lexer(md.replace(/\r\n/g, "\n"), { gfm: true });
  const nodes = blocks(tokens);
  return nodes.length ? nodes : [para([])];
}

/* ------------------------------------------------------------------ export ------------------------------------------------------------------ */
const T = (text: string, marks?: PMNode["marks"]): PMNode => ({ type: "text", text, ...(marks ? { marks } : {}) });
const P = (...content: PMNode[]): PMNode => ({ type: "paragraph", content });
const cell = (type: string, v: unknown): PMNode => ({ type, content: [v == null || v === "" ? { type: "paragraph" } : P(T(String(v)))] });
const stamp = (t: number) => { const s = Math.max(0, Math.floor(Number(t) || 0)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const NEXT = new Set(NEXT_NODE_NAMES);
/**
 * Replace every Next Generation node by ordinary nodes whose Markdown is the form of SPEC §2: mermaid → ```mermaid fence; runCode →
 * fence with its language then an `output` fence; chart → title line + table; drawing → `![Dessin](/api/files/<preview>)` or `[Dessin]`;
 * pdf → `[PDF: name](/api/files/<id>)` + one `> p.<page> — <text> — <note>` line per annotation; audio → `[Audio: title](…)` +
 * `[mm:ss] text` lines; queryView → `[Vue: title]`; blockRef → `[[<pageId>#<blockId>]]`; citation → `[@<label or refId>]`;
 * bibliography → `## <title>`; canvasLink → `[Canvas](/p/<pageId>)`. Returns the same object when the document has none of them.
 */
export function expandNextNodes<T extends PMNode | null | undefined>(doc: T): T {
  if (!doc) return doc;
  const one = (n: PMNode): PMNode[] => {
    const a = n.attrs ?? {};
    switch (n.type) {
      case "mermaid": return [{ type: "codeBlock", attrs: { language: "mermaid" }, content: a.code ? [T(a.code)] : [] }];
      case "runCode": return [{ type: "codeBlock", attrs: { language: a.language || "" }, content: a.code ? [T(a.code)] : [] }, ...(a.output ? [{ type: "codeBlock", attrs: { language: "output" }, content: a.output.text ? [T(String(a.output.text))] : [] }] : [])];
      case "chart": { const cols: string[] = Array.isArray(a.columns) ? a.columns : []; const rows: unknown[][] = Array.isArray(a.rows) ? a.rows : []; return [...(a.title ? [P(T(String(a.title)))] : []), ...(cols.length ? [{ type: "table", content: [{ type: "tableRow", content: cols.map((c) => cell("tableHeader", c)) }, ...rows.map((r) => ({ type: "tableRow", content: cols.map((_, i) => cell("tableCell", r?.[i])) }))] }] : [])]; }
      case "drawing": return [a.preview ? { type: "image", attrs: { src: `/api/files/${a.preview}`, alt: "Dessin" } } : P(T("[Dessin]"))];
      case "pdf": { const ann: any[] = Array.isArray(a.annotations) ? a.annotations : []; return [P(a.attachmentId ? T(`PDF: ${a.name ?? ""}`, [{ type: "link", attrs: { href: `/api/files/${a.attachmentId}` } }]) : T(`[PDF: ${a.name ?? ""}]`)), ...(ann.length ? [{ type: "blockquote", content: ann.map((x) => P(T(`p.${x.page} — ${String(x.text ?? "").replace(/\s+/g, " ")} — ${String(x.note ?? "").replace(/\s+/g, " ")}`))) }] : [])]; }
      case "audio": { const tr: any[] = Array.isArray(a.transcript) ? a.transcript : []; return [P(a.attachmentId ? T(`Audio: ${a.title ?? ""}`, [{ type: "link", attrs: { href: `/api/files/${a.attachmentId}` } }]) : T(`[Audio: ${a.title ?? ""}]`)), ...(tr.length ? [{ type: "paragraph", content: tr.flatMap((l, i) => [...(i ? [{ type: "hardBreak" } as PMNode] : []), T(`[${stamp(l.t)}] ${l.text}`)]) }] : [])]; }
      case "queryView": return [P(T(`[Vue: ${a.title ?? ""}]`))];
      case "blockRef": return [P(T(`[[${a.pageId ?? ""}#${a.blockId ?? ""}]]`))];
      case "bibliography": return [{ type: "heading", attrs: { level: 2 }, content: [T(String(a.title ?? "Références"))] }];
      case "canvasLink": return [P(a.pageId ? T("Canvas", [{ type: "link", attrs: { href: `/p/${a.pageId}` } }]) : T("[Canvas]"))];
      case "citation": return [T(`[@${a.label || a.refId || ""}${a.locator ? `, ${a.locator}` : ""}]`)];
      default: return [n];
    }
  };
  const walk = (n: PMNode): PMNode => {
    if (!n.content?.length) return n; let changed = false; const kids: PMNode[] = [];
    for (const c of n.content) { if (NEXT.has(c.type)) { kids.push(...one(c)); changed = true; } else { const w = walk(c); if (w !== c) changed = true; kids.push(w); } }
    return changed ? { ...n, content: kids } : n;
  };
  return walk(doc as PMNode) as T;
}
/** ProseMirror JSON → Markdown including the Next Generation nodes (client side; the server export lives in src/lib/editor/text.ts). */
export const docToMarkdown = (doc: PMNode | null | undefined): string => toMarkdown(expandNextNodes(doc));
