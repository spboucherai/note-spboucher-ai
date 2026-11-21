/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/editor/text.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

/** Pure helpers over ProseMirror JSON (no DOM): plain text, block list, link/mention extraction, Markdown. Shared by server + client. */
import { NEXT_BLOCK_TYPES, isNextBlock, nextNodeText, nextNodeMarkdown, nodePageRef, nodeRefId, nodeAttachmentIds } from "./next-nodes";
export type PMNode = { type: string; attrs?: Record<string, any>; content?: PMNode[]; text?: string; marks?: { type: string; attrs?: Record<string, any> }[] };

export function nodeText(n: PMNode): string {
  if (n.text) return n.text;
  const next = nextNodeText(n); if (next !== null) return next; // 3.0 nodes (leaf atoms: their text lives in attrs)
  if (n.type === "hardBreak") return "\n";
  if (n.type === "mention") return `@${n.attrs?.label ?? ""}`;
  if (n.type === "math" || n.type === "inlineMath") return n.attrs?.latex ?? "";
  if (n.type === "blockMath") return n.attrs?.latex ?? "";
  return (n.content ?? []).map(nodeText).join((n.content ?? []).some(isBlock) ? "\n" : "");
}
const BLOCKS = new Set(["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "table", "tableRow", "callout", "details", "detailsSummary", "detailsContent", "aiBlock", "blockMath", "horizontalRule", "image", "fileBlock", "youtube", "footnote", ...NEXT_BLOCK_TYPES]);
const isBlock = (n: PMNode) => BLOCKS.has(n.type);
export function docText(doc: PMNode | null | undefined): string { return doc ? nodeText(doc).replace(/\n{3,}/g, "\n\n").trim() : ""; }
export const wordCount = (s: string) => (s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;

/** Top-level-ish blocks with their text and a stable id (attrs.id if present). Used for chunking + citations. */
export function docBlocks(doc: PMNode | null | undefined): { id: string | null; type: string; heading: string | null; text: string }[] {
  const out: { id: string | null; type: string; heading: string | null; text: string }[] = []; let heading: string | null = null;
  const walk = (n: PMNode) => {
    if (n.type === "heading") { heading = nodeText(n).trim(); out.push({ id: n.attrs?.id ?? null, type: "heading", heading, text: heading }); return; }
    if (["paragraph", "blockquote", "codeBlock", "bulletList", "orderedList", "taskList", "table", "callout", "details", "aiBlock", "blockMath"].includes(n.type) || isNextBlock(n.type)) { const t = nodeText(n).trim(); if (t) out.push({ id: n.attrs?.id ?? null, type: n.type, heading, text: t }); return; }
    (n.content ?? []).forEach(walk);
  };
  (doc?.content ?? []).forEach(walk); return out;
}
export function extractPageRefs(doc: PMNode | null | undefined): string[] {
  const ids = new Set<string>();
  const walk = (n: PMNode) => { if (n.type === "mention" && n.attrs?.id && n.attrs?.kind !== "user") ids.add(n.attrs.id); const ref = nodePageRef(n); if (ref) ids.add(ref.pageId); for (const m of n.marks ?? []) if (m.type === "link" && typeof m.attrs?.href === "string") { const mm = m.attrs.href.match(/^\/p\/([0-9a-f-]{36})/); if (mm) ids.add(mm[1]); } (n.content ?? []).forEach(walk); };
  if (doc) walk(doc); return [...ids];
}

/** ProseMirror JSON → Markdown (lossless enough for export/AI context). */
export function toMarkdown(doc: PMNode | null | undefined): string {
  if (!doc) return "";
  const inline = (n: PMNode): string => {
    if (n.type === "text") { let t = n.text ?? ""; for (const m of n.marks ?? []) { if (m.type === "bold") t = `**${t}**`; else if (m.type === "italic") t = `*${t}*`; else if (m.type === "code") t = `\`${t}\``; else if (m.type === "strike") t = `~~${t}~~`; else if (m.type === "link") t = `[${t}](${m.attrs?.href})`; else if (m.type === "highlight") t = `==${t}==`; else if (m.type === "underline") t = `<u>${t}</u>`; else if (m.type === "subscript") t = `<sub>${t}</sub>`; else if (m.type === "superscript") t = `<sup>${t}</sup>`; } return t; }
    if (n.type === "hardBreak") return "  \n"; if (n.type === "mention") return `[[${n.attrs?.label ?? n.attrs?.id}]]`; if (n.type === "inlineMath" || n.type === "math") return `$${n.attrs?.latex ?? ""}$`; if (n.type === "footnoteRef") return `[^${n.attrs?.id}]`;
    if (n.type === "citation") return nextNodeMarkdown(n) ?? "";
    return (n.content ?? []).map(inline).join("");
  };
  const block = (n: PMNode, depth = 0): string => {
    const pad = "  ".repeat(depth);
    switch (n.type) {
      case "paragraph": return inline(n) + "\n";
      case "heading": return `${"#".repeat(n.attrs?.level ?? 1)} ${inline(n)}\n`;
      case "blockquote": return (n.content ?? []).map((c) => block(c)).join("").split("\n").filter(Boolean).map((l) => `> ${l}`).join("\n") + "\n";
      case "codeBlock": return `\`\`\`${n.attrs?.language ?? ""}\n${nodeText(n)}\n\`\`\`\n`;
      case "bulletList": return (n.content ?? []).map((li) => `${pad}- ${(li.content ?? []).map((c, i) => (i === 0 ? block(c, depth + 1).trimStart() : block(c, depth + 1))).join("")}`).join("");
      case "orderedList": return (n.content ?? []).map((li, i) => `${pad}${i + 1}. ${(li.content ?? []).map((c, j) => (j === 0 ? block(c, depth + 1).trimStart() : block(c, depth + 1))).join("")}`).join("");
      case "taskList": return (n.content ?? []).map((li) => `${pad}- [${li.attrs?.checked ? "x" : " "}] ${(li.content ?? []).map((c, i) => (i === 0 ? block(c, depth + 1).trimStart() : block(c, depth + 1))).join("")}`).join("");
      case "table": { const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => inline(c).replace(/\|/g, "\\|").replace(/\n/g, " "))); if (!rows.length) return ""; return `| ${rows[0].join(" | ")} |\n| ${rows[0].map(() => "---").join(" | ")} |\n${rows.slice(1).map((r) => `| ${r.join(" | ")} |`).join("\n")}\n`; }
      case "horizontalRule": return "---\n";
      case "image": return `![${n.attrs?.alt ?? ""}](${n.attrs?.src})\n`;
      case "fileBlock": return `[📎 ${n.attrs?.name}](${n.attrs?.src})\n`;
      case "youtube": return `${n.attrs?.src}\n`;
      case "blockMath": return `$$\n${n.attrs?.latex ?? ""}\n$$\n`;
      case "callout": return `> [!${(n.attrs?.kind ?? "note").toUpperCase()}] ${n.attrs?.icon ?? ""}\n` + (n.content ?? []).map((c) => block(c)).join("").split("\n").filter(Boolean).map((l) => `> ${l}`).join("\n") + "\n";
      case "details": { const s = n.content?.find((c) => c.type === "detailsSummary"); const b = n.content?.find((c) => c.type === "detailsContent"); return `<details><summary>${s ? inline(s) : ""}</summary>\n\n${b ? (b.content ?? []).map((c) => block(c)).join("\n") : ""}\n</details>\n`; }
      case "aiBlock": return `> [!AI] ${n.attrs?.model ?? ""}\n` + (n.content ?? []).map((c) => block(c)).join("").split("\n").filter(Boolean).map((l) => `> ${l}`).join("\n") + "\n";
      case "footnote": return `[^${n.attrs?.id}]: ${(n.content ?? []).map(inline).join(" ")}\n`;
      default: { const next = nextNodeMarkdown(n); if (next !== null) return next; return (n.content ?? []).map((c) => block(c, depth)).join(""); }
    }
  };
  return (doc.content ?? []).map((n) => block(n)).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
export const emptyDoc = (): PMNode => ({ type: "doc", content: [{ type: "paragraph" }] });

/** Same block types as the editor's BlockId extension (src/components/editor/extensions/nodes.ts). */
const ID_TYPES = new Set(["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "taskList", "table", "callout", "details", "aiBlock", "blockMath", "image", "fileBlock", "listItem", "taskItem", ...NEXT_BLOCK_TYPES]); // 3.0: list items and the new block atoms
const rid = () => { const a = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-"; let o = ""; const b = new Uint8Array(10); globalThis.crypto.getRandomValues(b); for (const x of b) o += a[x & 63]; return o; };
/**
 * Give every block a stable id when it lacks one (content created by a capture, an import, an agent or the API never went through the
 * editor, which is what normally assigns them). Search results and citations link to these ids, so they must exist before indexing.
 * Returns the same object when nothing was missing.
 */
export function ensureBlockIds<T extends PMNode | null | undefined>(doc: T, prev?: PMNode | null): { doc: T; changed: boolean } {
  if (!doc || typeof doc !== "object") return { doc, changed: false };
  // 3.0 — ids are stable across saves: a block that arrives without an id (a client that does not know the ids the server assigned,
  // or an editor that drops the id of a list item) gets back the id the same block had in the stored document (`prev`), matched by
  // type + text, in document order. Only a block that is really new gets a fresh id. Citations and task anchors therefore survive.
  const pool = new Map<string, string[]>(); const present = new Set<string>();
  const sig = (n: PMNode) => `${n.type}\u0000${nodeText(n).slice(0, 2000)}`;
  if (prev && typeof prev === "object") {
    const collect = (n: PMNode) => { if (ID_TYPES.has(n.type) && typeof n.attrs?.id === "string" && n.attrs.id) { const k = sig(n); const q = pool.get(k); if (q) q.push(n.attrs.id); else pool.set(k, [n.attrs.id]); } (n.content ?? []).forEach(collect); };
    collect(prev);
    const mark = (n: PMNode) => { if (typeof n.attrs?.id === "string") present.add(n.attrs.id); (n.content ?? []).forEach(mark); }; mark(doc as PMNode);
  }
  const seen = new Set<string>(); let changed = false;
  const fresh = (n: PMNode) => { const q = pool.get(sig(n)); while (q?.length) { const id = q.shift()!; if (!present.has(id) && !seen.has(id)) return id; } return rid(); };
  const walk = (n: PMNode): PMNode => {
    let out = n;
    if (ID_TYPES.has(n.type)) { const id = n.attrs?.id; if (typeof id !== "string" || !id || seen.has(id)) { const nid = fresh(n); seen.add(nid); out = { ...n, attrs: { ...(n.attrs ?? {}), id: nid } }; changed = true; } else seen.add(id); }
    if (n.content?.length) { const kids = n.content.map(walk); if (kids.some((k, i) => k !== n.content![i])) out = { ...out, content: kids }; }
    return out;
  };
  const next = walk(doc as PMNode);
  return { doc: (changed ? next : doc) as T, changed };
}

// ---------- 3.0: structured extraction used by the page service (links, citations, tasks, journal)
/** Nearest enclosing block id while walking (so an inline citation or a mention is anchored to its paragraph / list item). */
function walkWithBlock(doc: PMNode | null | undefined, f: (n: PMNode, blockId: string | null) => void) {
  const walk = (n: PMNode, blockId: string | null) => { const own = ID_TYPES.has(n.type) && typeof n.attrs?.id === "string" && n.attrs.id ? (n.attrs.id as string) : blockId; f(n, own); (n.content ?? []).forEach((c) => walk(c, own)); };
  if (doc) walk(doc, null);
}
export interface DocRefs {
  /** page → page references: mentions, /p/<id> links, blockRef, canvasLink (first occurrence wins) */
  pages: { pageId: string; sourceBlockId: string | null; targetBlockId: string | null }[];
  /** citation nodes: reference id + the block that cites it */
  references: { refId: string; sourceBlockId: string | null }[];
  /** attachments referenced through the attrs of 3.0 nodes or /api/files/<id> sources */
  attachments: string[];
  /** every reference to a precise block of another page (blockRef with a blockId, /p/<id>#block-<blockId> links), not de-duplicated per page */
  blocks: { pageId: string; blockId: string; sourceBlockId: string | null }[];
}
export function extractRefs(doc: PMNode | null | undefined): DocRefs {
  const pages = new Map<string, DocRefs["pages"][number]>(); const references = new Map<string, DocRefs["references"][number]>(); const attachments = new Set<string>(); const blocks: DocRefs["blocks"] = [];
  const addPage = (pageId: string, sourceBlockId: string | null, targetBlockId: string | null) => { const k = pageId.toLowerCase(); if (!pages.has(k)) pages.set(k, { pageId: k, sourceBlockId, targetBlockId }); if (targetBlockId) blocks.push({ pageId: k, blockId: targetBlockId, sourceBlockId }); };
  const file = (v: unknown) => { const m = typeof v === "string" ? v.match(/^\/api\/files\/([0-9a-f-]{36})/i) : null; if (m) attachments.add(m[1].toLowerCase()); };
  walkWithBlock(doc, (n, blockId) => {
    if (n.type === "mention" && typeof n.attrs?.id === "string" && n.attrs.kind !== "user") addPage(n.attrs.id, blockId, null);
    for (const m of n.marks ?? []) if (m.type === "link" && typeof m.attrs?.href === "string") { const mm = m.attrs.href.match(/^\/p\/([0-9a-f-]{36})(?:#block-([A-Za-z0-9_-]{1,64}))?/); if (mm) addPage(mm[1], blockId, mm[2] ?? null); file(m.attrs.href); }
    const ref = nodePageRef(n); if (ref) addPage(ref.pageId, blockId, ref.blockId);
    const rid = nodeRefId(n); if (rid && !references.has(rid)) references.set(rid, { refId: rid, sourceBlockId: blockId });
    for (const a of nodeAttachmentIds(n)) attachments.add(a);
    file(n.attrs?.src);
  });
  return { pages: [...pages.values()], references: [...references.values()], attachments: [...attachments], blocks };
}
export interface DocTaskItem { blockId: string | null; taskId: string | null; checked: boolean; text: string; due: string | null; priority: "low" | "medium" | "high" | null }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Every `taskItem` of the document, in order, with its 3.0 attrs (`taskId`, `due`, `priority`). The text is the item's own first block. */
export function docTaskItems(doc: PMNode | null | undefined): DocTaskItem[] {
  const out: DocTaskItem[] = [];
  const walk = (n: PMNode) => {
    if (n.type === "taskItem") { const a = n.attrs ?? {}; const first = (n.content ?? []).find((c) => c.type !== "taskList" && c.type !== "bulletList" && c.type !== "orderedList"); out.push({ blockId: typeof a.id === "string" && a.id ? a.id : null, taskId: typeof a.taskId === "string" && UUID_RE.test(a.taskId) ? a.taskId.toLowerCase() : null, checked: Boolean(a.checked), text: (first ? nodeText(first) : "").replace(/\s+/g, " ").trim().slice(0, 500), due: typeof a.due === "string" && !isNaN(new Date(a.due).getTime()) ? a.due : null, priority: a.priority === "low" || a.priority === "medium" || a.priority === "high" ? a.priority : null }); }
    (n.content ?? []).forEach(walk);
  };
  if (doc) walk(doc); return out;
}
/** Blocks whose appearance in a document is a journal event: AI results inserted by the user (`aiBlock`) and decisions (`callout` kind `decision`). */
export function docMarkers(doc: PMNode | null | undefined): { ai: { blockId: string; model: string | null; action: string | null }[]; decisions: { blockId: string; text: string }[] } {
  const ai: { blockId: string; model: string | null; action: string | null }[] = []; const decisions: { blockId: string; text: string }[] = [];
  const walk = (n: PMNode) => {
    const id = typeof n.attrs?.id === "string" ? n.attrs.id : null;
    if (id && n.type === "aiBlock") ai.push({ blockId: id, model: typeof n.attrs?.model === "string" ? n.attrs.model : null, action: typeof n.attrs?.action === "string" ? n.attrs.action : null });
    if (id && n.type === "callout" && n.attrs?.kind === "decision") decisions.push({ blockId: id, text: nodeText(n).replace(/\s+/g, " ").trim().slice(0, 300) });
    (n.content ?? []).forEach(walk);
  };
  if (doc) walk(doc); return { ai, decisions };
}
