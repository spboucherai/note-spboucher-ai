/** Markdown → ProseMirror JSON (client-safe, small subset: headings, paragraphs, lists, tasks, quotes, code, tables, hr, inline marks, math). Used for AI output insertion and Markdown import. */
import { marked, type Token, type Tokens } from "marked";
import type { PMNode } from "./text";
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
  // split inline $...$ math inside plain text nodes
  const res: PMNode[] = [];
  for (const n of out) { if (n.type !== "text" || !n.text || n.marks?.some((m) => m.type === "code")) { res.push(n); continue; } const parts = n.text.split(/(\$[^$\n]+?\$)/g); for (const p of parts) { if (!p) continue; const m = p.match(/^\$([^$]+)\$$/); if (m) res.push({ type: "inlineMath", attrs: { latex: m[1] } }); else res.push({ ...n, text: p }); } }
  return res;
}
const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const para = (content: PMNode[]): PMNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
function blocks(tokens: Token[]): PMNode[] {
  const out: PMNode[] = [];
  for (const t of tokens) {
    const tt = t as any;
    switch (t.type) {
      case "heading": out.push({ type: "heading", attrs: { level: Math.min(3, tt.depth) }, content: inline(tt.tokens) }); break;
      case "paragraph": { const m = tt.text?.match(/^\$\$([\s\S]+?)\$\$$/); if (m) out.push({ type: "blockMath", attrs: { latex: m[1].trim() } }); else out.push(para(inline(tt.tokens))); break; }
      case "text": out.push(para(inline(tt.tokens ?? [{ type: "text", text: tt.text } as any]))); break;
      case "blockquote": out.push({ type: "blockquote", content: blocks(tt.tokens) }); break;
      case "code": { const m = tt.lang === "math" || /^\$\$/.test(tt.text); if (tt.lang === "math") out.push({ type: "blockMath", attrs: { latex: tt.text } }); else out.push({ type: "codeBlock", attrs: { language: tt.lang || null }, content: tt.text ? [{ type: "text", text: tt.text }] : [] }); break; }
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
