/** Pure helpers over ProseMirror JSON (no DOM): plain text, block list, link/mention extraction, Markdown. Shared by server + client. */
export type PMNode = { type: string; attrs?: Record<string, any>; content?: PMNode[]; text?: string; marks?: { type: string; attrs?: Record<string, any> }[] };

export function nodeText(n: PMNode): string {
  if (n.text) return n.text;
  if (n.type === "hardBreak") return "\n";
  if (n.type === "mention") return `@${n.attrs?.label ?? ""}`;
  if (n.type === "math" || n.type === "inlineMath") return n.attrs?.latex ?? "";
  if (n.type === "blockMath") return n.attrs?.latex ?? "";
  return (n.content ?? []).map(nodeText).join((n.content ?? []).some(isBlock) ? "\n" : "");
}
const BLOCKS = new Set(["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "table", "tableRow", "callout", "details", "detailsSummary", "detailsContent", "aiBlock", "blockMath", "horizontalRule", "image", "fileBlock", "youtube", "footnote"]);
const isBlock = (n: PMNode) => BLOCKS.has(n.type);
export function docText(doc: PMNode | null | undefined): string { return doc ? nodeText(doc).replace(/\n{3,}/g, "\n\n").trim() : ""; }
export const wordCount = (s: string) => (s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;

/** Top-level-ish blocks with their text and a stable id (attrs.id if present). Used for chunking + citations. */
export function docBlocks(doc: PMNode | null | undefined): { id: string | null; type: string; heading: string | null; text: string }[] {
  const out: { id: string | null; type: string; heading: string | null; text: string }[] = []; let heading: string | null = null;
  const walk = (n: PMNode) => {
    if (n.type === "heading") { heading = nodeText(n).trim(); out.push({ id: n.attrs?.id ?? null, type: "heading", heading, text: heading }); return; }
    if (["paragraph", "blockquote", "codeBlock", "bulletList", "orderedList", "taskList", "table", "callout", "details", "aiBlock", "blockMath"].includes(n.type)) { const t = nodeText(n).trim(); if (t) out.push({ id: n.attrs?.id ?? null, type: n.type, heading, text: t }); return; }
    (n.content ?? []).forEach(walk);
  };
  (doc?.content ?? []).forEach(walk); return out;
}
export function extractPageRefs(doc: PMNode | null | undefined): string[] {
  const ids = new Set<string>();
  const walk = (n: PMNode) => { if (n.type === "mention" && n.attrs?.id && n.attrs?.kind !== "user") ids.add(n.attrs.id); for (const m of n.marks ?? []) if (m.type === "link" && typeof m.attrs?.href === "string") { const mm = m.attrs.href.match(/^\/p\/([0-9a-f-]{36})/); if (mm) ids.add(mm[1]); } (n.content ?? []).forEach(walk); };
  if (doc) walk(doc); return [...ids];
}

/** ProseMirror JSON → Markdown (lossless enough for export/AI context). */
export function toMarkdown(doc: PMNode | null | undefined): string {
  if (!doc) return "";
  const inline = (n: PMNode): string => {
    if (n.type === "text") { let t = n.text ?? ""; for (const m of n.marks ?? []) { if (m.type === "bold") t = `**${t}**`; else if (m.type === "italic") t = `*${t}*`; else if (m.type === "code") t = `\`${t}\``; else if (m.type === "strike") t = `~~${t}~~`; else if (m.type === "link") t = `[${t}](${m.attrs?.href})`; else if (m.type === "highlight") t = `==${t}==`; } return t; }
    if (n.type === "hardBreak") return "  \n"; if (n.type === "mention") return `[[${n.attrs?.label ?? n.attrs?.id}]]`; if (n.type === "inlineMath" || n.type === "math") return `$${n.attrs?.latex ?? ""}$`; if (n.type === "footnoteRef") return `[^${n.attrs?.id}]`;
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
      default: return (n.content ?? []).map((c) => block(c, depth)).join("");
    }
  };
  return (doc.content ?? []).map((n) => block(n)).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
export const emptyDoc = (): PMNode => ({ type: "doc", content: [{ type: "paragraph" }] });
