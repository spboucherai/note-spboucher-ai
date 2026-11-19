/**
 * File: src/lib/editor/next-nodes.ts
 * Description: text / Markdown rendering, attachment references and attr limits of the 3.0 document nodes (SPEC §2): mermaid, drawing,
 *   chart, queryView, citation (inline), bibliography, pdf, blockRef, runCode, audio, canvasLink. Pure functions over ProseMirror JSON
 *   (no DOM, no server import): shared by the server, the web client, and mirrored byte-for-byte by SPNotesCore `MarkdownExport`
 *   (fixtures: tests/fixtures/next-nodes/). The exact output rules are specified in docs/next/API-NEXT.md §2.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
type N = { type: string; attrs?: Record<string, any>; content?: N[]; text?: string };

/** Block-level leaf atoms added in 3.0. Each carries a block `id`, is a chunk of its own for search, and joins its siblings with a newline. */
export const NEXT_BLOCK_TYPES = ["mermaid", "drawing", "chart", "queryView", "bibliography", "pdf", "blockRef", "runCode", "audio", "canvasLink"] as const;
export const NEXT_INLINE_TYPES = ["citation"] as const;
const BLOCK = new Set<string>(NEXT_BLOCK_TYPES);
export const isNextBlock = (type: string) => BLOCK.has(type);
export const isNextNode = (type: string) => BLOCK.has(type) || type === "citation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);
const oneLine = (v: unknown) => str(v).replace(/\s*\n\s*/g, " ").trim();
/** `/api/files/<id>`, or the link an export resolver substituted for it (rewriteDoc stores them in attrs.__href). */
const fileUrl = (n: N, attachmentId: string) => str(n.attrs?.__href?.[attachmentId]) || `/api/files/${attachmentId}`;

/**
 * A chart / table cell as text. null and undefined → "". Booleans → "true" / "false". Numbers: integer-valued finite numbers print
 * without a decimal point ("3", never "3.0"); other finite numbers print the shortest decimal that round-trips (ECMAScript
 * Number::toString, e.g. "0.1", "1e+21"); NaN and ±Infinity → "". Strings are kept, newlines collapsed to one space.
 */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return oneLine(typeof v === "string" ? v : JSON.stringify(v));
}
/** [mm:ss] — minutes are not capped at 59 (a 2-hour recording reads [125:03]); negative or invalid times read [00:00]. */
export function timecode(t: unknown): string {
  const s = typeof t === "number" && Number.isFinite(t) && t > 0 ? Math.floor(t) : 0;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
const rowsOf = (n: N): unknown[][] => (Array.isArray(n.attrs?.rows) ? n.attrs!.rows.filter((r: unknown) => Array.isArray(r)) : []);
const colsOf = (n: N): string[] => (Array.isArray(n.attrs?.columns) ? n.attrs!.columns.map((c: unknown) => cellText(c)) : []);
const annotationsOf = (n: N): Record<string, any>[] => (Array.isArray(n.attrs?.annotations) ? n.attrs!.annotations.filter((a: unknown) => a && typeof a === "object") : []);
const transcriptOf = (n: N): { t: unknown; text: string }[] => (Array.isArray(n.attrs?.transcript) ? n.attrs!.transcript.filter((s: any) => s && typeof s === "object" && oneLine(s.text)).map((s: any) => ({ t: s.t, text: oneLine(s.text) })) : []);
const annotationLine = (a: Record<string, any>) => [`p.${Number.isFinite(Number(a.page)) ? Math.max(1, Math.floor(Number(a.page))) : 1}`, oneLine(a.text), oneLine(a.note)].filter(Boolean).join(" — ");
const outputText = (n: N): string | null => (n.attrs?.output && typeof n.attrs.output === "object" && typeof n.attrs.output.text === "string" ? n.attrs.output.text : null);
const label = (prefix: string, title: unknown) => (oneLine(title) ? `${prefix}: ${oneLine(title)}` : prefix);

/**
 * Plain text of a 3.0 node (search index, word count, excerpts): the Markdown form without its syntax. Transcript and annotation text
 * are included; identifiers (attachment, page, block ids) and time codes are not. Returns null for any other node type.
 */
export function nextNodeText(n: N): string | null {
  switch (n.type) {
    case "mermaid": return str(n.attrs?.code);
    case "runCode": { const out = outputText(n); return [str(n.attrs?.code), out ?? ""].filter(Boolean).join("\n"); }
    case "chart": return [oneLine(n.attrs?.title), colsOf(n).join(" "), ...rowsOf(n).map((r) => r.map(cellText).join(" "))].map((l) => l.trim()).filter(Boolean).join("\n");
    case "drawing": return "Dessin";
    case "pdf": return [label("PDF", n.attrs?.name), ...annotationsOf(n).map(annotationLine)].join("\n");
    case "audio": return [label("Audio", n.attrs?.title), ...transcriptOf(n).map((s) => s.text)].join("\n");
    case "queryView": return label("Vue", n.attrs?.title);
    case "blockRef": return "";
    case "citation": return oneLine(n.attrs?.label);
    case "bibliography": return oneLine(n.attrs?.title) || "Références";
    case "canvasLink": return "Canvas";
    default: return null;
  }
}

const mdCell = (v: unknown) => cellText(v).replace(/\|/g, "\\|");
/**
 * Markdown of a 3.0 node. Block nodes end with exactly one "\n" (like every block of `toMarkdown`); `citation` is inline and has none.
 * Returns null for any other node type.
 */
export function nextNodeMarkdown(n: N): string | null {
  switch (n.type) {
    case "mermaid": return `\`\`\`mermaid\n${str(n.attrs?.code)}\n\`\`\`\n`;
    case "runCode": { const out = outputText(n); return `\`\`\`${str(n.attrs?.language)}\n${str(n.attrs?.code)}\n\`\`\`\n${out === null ? "" : `\n\`\`\`output\n${out}\n\`\`\`\n`}`; }
    case "chart": {
      const title = oneLine(n.attrs?.title); const cols = colsOf(n); const rows = rowsOf(n);
      if (!cols.length) return `${title || "[Graphique]"}\n`;
      const table = `| ${cols.map(mdCell).join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n${rows.map((r) => `| ${cols.map((_c, i) => mdCell(r[i])).join(" | ")} |\n`).join("")}`;
      return title ? `${title}\n\n${table}` : table;
    }
    case "drawing": { const p = id(n.attrs?.preview); return p ? `![Dessin](${fileUrl(n, p)})\n` : "[Dessin]\n"; }
    case "pdf": { const a = id(n.attrs?.attachmentId); const head = a ? `[${label("PDF", n.attrs?.name)}](${fileUrl(n, a)})` : `[${label("PDF", n.attrs?.name)}]`; const notes = annotationsOf(n).map((x) => `> ${annotationLine(x)}\n`).join(""); return `${head}\n${notes ? `\n${notes}` : ""}`; }
    case "audio": { const a = id(n.attrs?.attachmentId); const head = a ? `[${label("Audio", n.attrs?.title)}](${fileUrl(n, a)})` : `[${label("Audio", n.attrs?.title)}]`; const lines = transcriptOf(n).map((s) => `[${timecode(s.t)}] ${s.text}\n`).join(""); return `${head}\n${lines ? `\n${lines}` : ""}`; }
    case "queryView": return `[${label("Vue", n.attrs?.title)}]\n`;
    case "blockRef": return `[[${id(n.attrs?.pageId) ?? ""}${str(n.attrs?.blockId) ? `#${str(n.attrs?.blockId)}` : ""}]]\n`;
    case "citation": return `[@${oneLine(n.attrs?.label) || id(n.attrs?.refId) || "?"}]`;
    case "bibliography": return `## ${oneLine(n.attrs?.title) || "Références"}\n`;
    case "canvasLink": { const p = id(n.attrs?.pageId); return p ? `[Canvas](/p/${p})\n` : "[Canvas]\n"; }
    default: return null;
  }
}

/** Attachment ids a 3.0 node points to (attrs only — binary data is never inline). */
export function nodeAttachmentIds(n: N): string[] {
  const a = n.attrs ?? {}; const out: (string | null)[] = [];
  if (n.type === "mermaid") out.push(id(a.preview));
  else if (n.type === "drawing") out.push(id(a.ink), id(a.preview), id(a.pk));
  else if (n.type === "pdf" || n.type === "audio") out.push(id(a.attachmentId));
  return out.filter((x): x is string => Boolean(x));
}
/** Pages a 3.0 node links to (blockRef, canvasLink) with the anchor block when there is one. */
export function nodePageRef(n: N): { pageId: string; blockId: string | null } | null {
  if (n.type !== "blockRef" && n.type !== "canvasLink") return null;
  const p = id(n.attrs?.pageId); return p ? { pageId: p, blockId: n.type === "blockRef" && str(n.attrs?.blockId) ? str(n.attrs?.blockId) : null } : null;
}
/** Reference cited by a `citation` node. */
export const nodeRefId = (n: N): string | null => (n.type === "citation" ? id(n.attrs?.refId) : null);

/** Size limits of the new attrs, enforced by `assertDoc` (HTTP 400 / 413 `bad_document`). Kept here so clients can read the same numbers. */
export const NEXT_LIMITS = {
  codeChars: 200_000, // mermaid.code, runCode.code
  outputChars: 200_000, // runCode.output.text
  chartColumns: 100, chartRows: 5_000, chartCellChars: 2_000,
  annotations: 2_000, annotationTextChars: 10_000, annotationRects: 500, annotationInkPoints: 20_000,
  transcriptSegments: 20_000, transcriptTextChars: 5_000, summaryChars: 20_000,
  titleChars: 500, queryLimit: 500,
} as const;

/**
 * Checks the attrs of a 3.0 node. Returns a human message when something is out of bounds, else null. Unknown attrs and unknown node
 * types are NOT rejected (forward compatibility: a newer client may add attrs; an unknown node must round-trip untouched).
 */
export function nextNodeProblem(n: N): string | null {
  if (!isNextNode(n.type)) return null;
  const a = n.attrs ?? {}; const L = NEXT_LIMITS;
  const optId = (k: string) => (a[k] === null || a[k] === undefined || id(a[k]) ? null : `${n.type}.${k} must be an attachment/page/reference uuid or null`);
  const maxStr = (k: string, max: number) => (a[k] === null || a[k] === undefined || (typeof a[k] === "string" && a[k].length <= max) ? null : `${n.type}.${k} must be a string of at most ${max} characters`);
  const first = (...p: (string | null)[]) => p.find(Boolean) ?? null;
  switch (n.type) {
    case "mermaid": return first(maxStr("code", L.codeChars), optId("preview"), a.previewHash == null || /^[0-9a-f]{64}$/i.test(str(a.previewHash)) ? null : "mermaid.previewHash must be a sha256 hex digest or null");
    case "drawing": return first(optId("ink"), optId("preview"), optId("pk"));
    case "runCode": return first(maxStr("code", L.codeChars), maxStr("language", 64), a.output == null || (typeof a.output === "object" && (a.output.text == null || (typeof a.output.text === "string" && a.output.text.length <= L.outputChars))) ? null : `runCode.output.text must be a string of at most ${L.outputChars} characters`);
    case "chart": {
      if (a.columns != null && (!Array.isArray(a.columns) || a.columns.length > L.chartColumns || a.columns.some((c: unknown) => typeof c !== "string" || c.length > L.chartCellChars))) return `chart.columns must be at most ${L.chartColumns} strings`;
      if (a.rows != null) {
        if (!Array.isArray(a.rows) || a.rows.length > L.chartRows) return `chart.rows must be at most ${L.chartRows} rows`;
        for (const r of a.rows) { if (!Array.isArray(r) || r.length > L.chartColumns) return `chart.rows: each row is an array of at most ${L.chartColumns} cells`; for (const c of r) if (!(c === null || typeof c === "number" || (typeof c === "string" && c.length <= L.chartCellChars))) return "chart.rows: a cell is a string, a number or null"; }
      }
      return maxStr("title", L.titleChars);
    }
    case "pdf": {
      if (a.annotations != null) {
        if (!Array.isArray(a.annotations) || a.annotations.length > L.annotations) return `pdf.annotations must be at most ${L.annotations} items`;
        for (const x of a.annotations) {
          if (!x || typeof x !== "object") return "pdf.annotations: each item is an object";
          if (str(x.text).length > L.annotationTextChars || str(x.note).length > L.annotationTextChars) return `pdf.annotations: text and note are at most ${L.annotationTextChars} characters`;
          if (x.rects != null && (!Array.isArray(x.rects) || x.rects.length > L.annotationRects)) return `pdf.annotations: at most ${L.annotationRects} rects`;
          if (x.ink != null && (!Array.isArray(x.ink) || x.ink.length > L.annotationInkPoints)) return `pdf.annotations: at most ${L.annotationInkPoints} ink points`;
        }
      }
      return first(optId("attachmentId"), maxStr("name", L.titleChars));
    }
    case "audio": {
      if (a.transcript != null) {
        if (!Array.isArray(a.transcript) || a.transcript.length > L.transcriptSegments) return `audio.transcript must be at most ${L.transcriptSegments} segments`;
        for (const s of a.transcript) if (!s || typeof s !== "object" || typeof s.text !== "string" || s.text.length > L.transcriptTextChars) return `audio.transcript: each segment is {t, text} with text of at most ${L.transcriptTextChars} characters`;
      }
      if (a.summary != null && (typeof a.summary !== "object" || str(a.summary.text).length > L.summaryChars)) return `audio.summary.text must be at most ${L.summaryChars} characters`;
      return first(optId("attachmentId"), maxStr("title", L.titleChars));
    }
    case "queryView": return first(optId("databaseId"), optId("viewId"), maxStr("title", L.titleChars), a.limit == null || (Number.isInteger(a.limit) && a.limit >= 1 && a.limit <= L.queryLimit) ? null : `queryView.limit must be an integer between 1 and ${L.queryLimit}`);
    case "blockRef": return first(optId("pageId"), maxStr("blockId", 64));
    case "canvasLink": return optId("pageId");
    case "citation": return first(optId("refId"), maxStr("locator", 200), maxStr("label", L.titleChars));
    case "bibliography": return first(maxStr("style", 32), maxStr("title", L.titleChars));
    default: return null;
  }
}
