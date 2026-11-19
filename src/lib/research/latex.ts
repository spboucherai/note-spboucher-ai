/**
 * LaTeX export of a research project (SPEC §4.14): an article skeleton built from the project's pages.
 *
 *   main.tex        preamble, title, one \section per page of the project (the root page first, then its descendants in tree order,
 *                   nested one level deeper per depth), a "Hypotheses" section collecting the `hypothesis` callouts, a "Methods notes"
 *                   section listing the project's experiments, then \bibliography{references}
 *   references.bib  the project's references plus every library reference cited by key — produced by the existing BibTeX export
 *
 * Conversion rules (ProseMirror JSON → LaTeX, no AI anywhere):
 *  - equations are preserved verbatim: `inlineMath` → `$…$`, `blockMath` → `\begin{equation}…\end{equation}`; `$…$` typed in plain text
 *    is kept as math too;
 *  - citations: a `\cite{key}` (and \citep, \citet, \parencite, \textcite, \autocite…) typed in the text is preserved untouched; the
 *    `citation` inline node becomes `\cite[locator]{key}` when its reference exists, a visible `[?]` + a `% missing reference` comment
 *    otherwise (never an invented key);
 *  - figures: an `image` becomes a `figure` with `\includegraphics{figures/<attachment name>}` — a PLACEHOLDER naming the attachment
 *    (the ZIP form of the export puts the real file there); `drawing` and `chart`/`mermaid` previews likewise;
 *  - everything else is escaped text; a node this exporter does not know is exported as its text inside a `% [node type]` comment
 *    marker, never dropped silently.
 * Pure functions here; the database access is in `collectProject` / `exportProjectLatex` at the bottom.
 */
import { and, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { nodeText, type PMNode } from "@/lib/editor/text";
import { bibFile } from "./bibtex";

// ---------- escaping
const ESC: Record<string, string> = { "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "$": "\\$", "&": "\\&", "#": "\\#", "_": "\\_", "%": "\\%", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" };
export const escapeLatex = (s: string) => s.replace(/[\\{}$&#_%~^]/g, (c) => ESC[c]).replace(/\u00a0/g, "~");
/** Citation commands typed by hand, kept as they are (the same family the reference checker recognises). */
const CITE_CMD = /\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|nocite)\*?(?:\[[^\]]*\]){0,2}\{[^{}]+\}/g;
const MATH_INLINE = /\$\$[\s\S]+?\$\$|\$(?!\s)(?:\\.|[^$\\\n])+?\$/g;
const REF_CMD = /\\(?:ref|eqref|label|autoref|cref|Cref)\{[^{}]+\}/g;
/**
 * Escape running text while leaving LaTeX the author typed on purpose untouched: `$…$` math, citation commands and \ref/\label.
 * Returns the LaTeX and the cite keys found.
 */
export function textToLatex(s: string, keys?: Set<string>): string {
  const keep = new RegExp(`${CITE_CMD.source}|${MATH_INLINE.source}|${REF_CMD.source}`, "g");
  let out = ""; let last = 0;
  for (const m of s.matchAll(keep)) {
    out += escapeLatex(s.slice(last, m.index)); out += m[0]; last = m.index! + m[0].length;
    if (keys && /^\\(?:cite|parencite|textcite|autocite|footcite|nocite)/.test(m[0])) for (const k of (m[0].match(/\{([^{}]+)\}$/)?.[1] ?? "").split(",")) if (k.trim() && k.trim() !== "*") keys.add(k.trim());
  }
  return out + escapeLatex(s.slice(last));
}
/** File name safe inside \includegraphics{} (no spaces, no LaTeX specials), extension kept. */
export const figureName = (name: string, fallback: string) => {
  const base = (name || fallback).normalize("NFD").replace(/[\u0300-\u036f]/g, ""); const ext = (base.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "").toLowerCase();
  const stem = base.slice(0, base.length - ext.length).replace(/[^A-Za-z0-9-]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || fallback;
  return `${stem}${ext}`;
};

// ---------- conversion
export interface RefLite { id: string; citeKey: string }
export interface LatexCtx {
  /** research references by id (for `citation` nodes) */
  refsById: Map<string, RefLite>;
  /** attachment id → file name */
  attachments: Map<string, string>;
  /** collected while converting */
  citeKeys: Set<string>; figures: Map<string, { attachmentId: string | null; name: string; file: string; caption: string }>; hypotheses: string[]; missingRefs: string[]; unknownNodes: Set<string>;
  /** the shallowest heading of a page maps to this sectioning depth (0 = \section) */
  baseDepth: number; headingShift: number;
}
export const newCtx = (refs: RefLite[] = [], attachments: Map<string, string> = new Map(), baseDepth = 0): LatexCtx => ({ refsById: new Map(refs.map((r) => [r.id, r])), attachments, citeKeys: new Set(), figures: new Map(), hypotheses: [], missingRefs: [], unknownNodes: new Set(), baseDepth, headingShift: 0 });
const CONTAINERS = new Set(["doc", "listItem", "taskItem", "tableRow", "tableCell", "tableHeader", "detailsContent", "detailsSummary"]);
const SECTIONING = ["section", "subsection", "subsubsection", "paragraph", "subparagraph"];
export const sectionCmd = (depth: number) => SECTIONING[Math.min(Math.max(depth, 0), SECTIONING.length - 1)];
const attId = (src: unknown) => (typeof src === "string" ? src.match(/\/api\/files\/([0-9a-f-]{36})/i)?.[1] ?? null : null);

function inline(n: PMNode, c: LatexCtx): string {
  if (n.type === "text") {
    let t = textToLatex(n.text ?? "", c.citeKeys);
    for (const m of n.marks ?? []) {
      if (m.type === "code") { t = `\\texttt{${escapeLatex(n.text ?? "")}}`; continue; }
      if (m.type === "bold") t = `\\textbf{${t}}`; else if (m.type === "italic") t = `\\emph{${t}}`; else if (m.type === "underline") t = `\\underline{${t}}`; else if (m.type === "strike") t = `\\sout{${t}}`;
      else if (m.type === "superscript") t = `\\textsuperscript{${t}}`; else if (m.type === "subscript") t = `\\textsubscript{${t}}`;
      else if (m.type === "link" && typeof m.attrs?.href === "string") t = /^https?:\/\//.test(m.attrs.href) ? `\\href{${m.attrs.href.replace(/[%#\\{}]/g, (x: string) => `\\${x}`)}}{${t}}` : t;
    }
    return t;
  }
  if (n.type === "hardBreak") return "\\\\\n";
  if (n.type === "inlineMath" || n.type === "math") return `$${String(n.attrs?.latex ?? "").trim()}$`;
  if (n.type === "mention") return escapeLatex(String(n.attrs?.label ?? ""));
  if (n.type === "footnoteRef") return `\\footnotemark[${escapeLatex(String(n.attrs?.id ?? ""))}]`;
  if (n.type === "citation") {
    const ref = n.attrs?.refId ? c.refsById.get(n.attrs.refId) : null; const loc = String(n.attrs?.locator ?? "").trim();
    if (!ref) { c.missingRefs.push(String(n.attrs?.refId ?? n.attrs?.label ?? "?")); return `[?]% missing reference: ${escapeLatex(String(n.attrs?.label || n.attrs?.refId || "unknown")).replace(/\n/g, " ")}\n`; }
    c.citeKeys.add(ref.citeKey); return `\\cite${loc ? `[${escapeLatex(loc)}]` : ""}{${ref.citeKey}}`;
  }
  return (n.content ?? []).map((x) => inline(x, c)).join("");
}
const inlines = (n: PMNode, c: LatexCtx) => (n.content ?? []).map((x) => inline(x, c)).join("");
function figure(c: LatexCtx, attachmentId: string | null, rawName: string, caption: string): string {
  const key = attachmentId ?? rawName; let f = c.figures.get(key);
  if (!f) { const used = new Set([...c.figures.values()].map((x) => x.file)); let file = figureName(rawName, `figure-${c.figures.size + 1}`); for (let i = 2; used.has(file); i++) file = file.replace(/(\.[a-z0-9]+)?$/, (e) => `-${i}${e}`); f = { attachmentId, name: rawName || file, file, caption }; c.figures.set(key, f); }
  return `\\begin{figure}[htbp]\n  \\centering\n  % placeholder: attachment "${(f.name || f.file).replace(/[\n%]/g, " ")}"${attachmentId ? ` (id ${attachmentId})` : ""}\n  \\includegraphics[width=0.8\\linewidth]{figures/${f.file}}\n${caption ? `  \\caption{${escapeLatex(caption)}}\n` : ""}\\end{figure}\n`;
}
function list(env: string, n: PMNode, c: LatexCtx, task = false): string {
  const items = (n.content ?? []).map((li) => { const body = (li.content ?? []).map((x) => block(x, c)).join("\n").trim(); return `  \\item${task ? (li.attrs?.checked ? "[$\\boxtimes$]" : "[$\\square$]") : ""} ${body.replace(/\n/g, "\n  ")}`; });
  return items.length ? `\\begin{${env}}\n${items.join("\n")}\n\\end{${env}}\n` : "";
}
function table(n: PMNode, c: LatexCtx): string {
  const rows = (n.content ?? []).map((r) => (r.content ?? []).map((cell) => (cell.content ?? []).map((x) => block(x, c).trim()).join(" ").replace(/\n+/g, " ")));
  const cols = Math.max(0, ...rows.map((r) => r.length)); if (!cols) return "";
  const header = (n.content?.[0]?.content ?? []).some((cell) => cell.type === "tableHeader");
  const line = (r: string[]) => `  ${[...r, ...Array(cols - r.length).fill("")].join(" & ")} \\\\`;
  return `\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{${"l".repeat(cols)}}\n  \\hline\n${rows.map((r, i) => line(r) + (i === 0 && header ? "\n  \\hline" : "")).join("\n")}\n  \\hline\n  \\end{tabular}\n\\end{table}\n`;
}
export function block(n: PMNode, c: LatexCtx): string {
  switch (n.type) {
    case "paragraph": return inlines(n, c) + "\n";
    case "heading": return `\\${sectionCmd(c.baseDepth + Math.max(1, Number(n.attrs?.level ?? 1)) - 1 - c.headingShift)}{${inlines(n, c)}}\n`;
    case "blockquote": return `\\begin{quote}\n${(n.content ?? []).map((x) => block(x, c)).join("\n").trim()}\n\\end{quote}\n`;
    case "codeBlock": return `\\begin{verbatim}\n${nodeText(n).replace(/\\end\{verbatim\}/g, "\\end {verbatim}")}\n\\end{verbatim}\n`;
    case "bulletList": return list("itemize", n, c);
    case "orderedList": return list("enumerate", n, c);
    case "taskList": return list("itemize", n, c, true);
    case "table": return table(n, c);
    case "horizontalRule": return "\\medskip\\hrule\\medskip\n";
    case "blockMath": return `\\begin{equation}\n${String(n.attrs?.latex ?? "").trim()}\n\\end{equation}\n`;
    case "image": return figure(c, attId(n.attrs?.src), c.attachments.get(attId(n.attrs?.src) ?? "") ?? String(n.attrs?.title || n.attrs?.alt || ""), String(n.attrs?.alt || n.attrs?.title || ""));
    case "drawing": return n.attrs?.preview ? figure(c, n.attrs.preview, c.attachments.get(n.attrs.preview) ?? "dessin.png", "") : "% [drawing without preview]\n";
    case "mermaid": return n.attrs?.preview ? figure(c, n.attrs.preview, c.attachments.get(n.attrs.preview) ?? "diagramme.svg", "") : `% [mermaid diagram — source kept below]\n\\begin{verbatim}\n${String(n.attrs?.code ?? "")}\n\\end{verbatim}\n`;
    case "chart": { const cols: string[] = Array.isArray(n.attrs?.columns) ? n.attrs.columns : []; const rows: unknown[][] = Array.isArray(n.attrs?.rows) ? n.attrs.rows : []; if (!cols.length) return "% [empty chart]\n";
      return `\\begin{table}[htbp]\n  \\centering\n${n.attrs?.title ? `  \\caption{${escapeLatex(String(n.attrs.title))}}\n` : ""}  \\begin{tabular}{${"l".repeat(cols.length)}}\n  \\hline\n  ${cols.map((x) => escapeLatex(String(x))).join(" & ")} \\\\\n  \\hline\n${rows.map((r) => `  ${cols.map((_, i) => escapeLatex(r[i] == null ? "" : String(r[i]))).join(" & ")} \\\\`).join("\n")}\n  \\hline\n  \\end{tabular}\n\\end{table}\n`; }
    case "fileBlock": return `% attachment: ${String(n.attrs?.name ?? "").replace(/[\n%]/g, " ")}\n`;
    case "pdf": return `% PDF attachment: ${String(n.attrs?.name ?? "").replace(/[\n%]/g, " ")}\n` + (Array.isArray(n.attrs?.annotations) ? n.attrs.annotations.filter((a: any) => a?.text || a?.note).map((a: any) => `\\begin{quote}\n(p.~${Number(a.page) || "?"}) ${escapeLatex(String(a.text ?? ""))}${a.note ? ` --- \\emph{${escapeLatex(String(a.note))}}` : ""}\n\\end{quote}\n`).join("") : "");
    case "audio": return `% audio: ${String(n.attrs?.title ?? "").replace(/[\n%]/g, " ")}\n` + (Array.isArray(n.attrs?.transcript) && n.attrs.transcript.length ? `\\begin{quote}\n${n.attrs.transcript.map((s: any) => escapeLatex(String(s?.text ?? ""))).join(" ")}\n\\end{quote}\n` : "");
    case "bibliography": return "% [bibliography block: the references are printed at the end of the document]\n";
    case "runCode": return `\\begin{verbatim}\n${String(n.attrs?.code ?? "").replace(/\\end\{verbatim\}/g, "\\end {verbatim}")}\n\\end{verbatim}\n`;
    case "queryView": case "canvasLink": case "blockRef": case "youtube": return `% [${n.type}${n.attrs?.title ? `: ${String(n.attrs.title).replace(/[\n%]/g, " ")}` : ""} — live block, not exported]\n`;
    case "footnote": return `\\footnotetext[${escapeLatex(String(n.attrs?.id ?? ""))}]{${inlines(n, c)}}\n`;
    case "callout": {
      const body = (n.content ?? []).map((x) => block(x, c)).join("\n").trim(); const kind = String(n.attrs?.kind ?? "note");
      if (kind === "hypothesis") { c.hypotheses.push(body); return `\\paragraph{Hypothesis}\n${body}\n`; }
      const label = ({ decision: "Decision", question: "Open question", warning: "Warning", tip: "Remark", info: "Note", note: "Note" } as Record<string, string>)[kind] ?? "Note";
      return `\\begin{quote}\n\\textbf{${label}.} ${body}\n\\end{quote}\n`;
    }
    case "details": { const s = n.content?.find((x) => x.type === "detailsSummary"); const b = n.content?.find((x) => x.type === "detailsContent"); return `${s ? `\\paragraph{${inlines(s, c)}}\n` : ""}${b ? (b.content ?? []).map((x) => block(x, c)).join("\n") : ""}`; }
    case "aiBlock": return `% --- AI-generated passage (${String(n.attrs?.model ?? "model unknown").replace(/[\n%]/g, " ")}) — review before submission ---\n${(n.content ?? []).map((x) => block(x, c)).join("\n")}% --- end of AI-generated passage ---\n`;
    default: {
      if (CONTAINERS.has(n.type)) return (n.content ?? []).map((x) => block(x, c)).join("\n");
      c.unknownNodes.add(n.type);
      // an unknown node is never dropped: its inline content is exported as a paragraph, its block content block by block, under a marker
      if (n.content?.length) return `% [${n.type}]\n${n.content.some((k) => k.type === "text") ? inlines(n, c) : n.content.map((x) => block(x, c)).join("\n")}\n`;
      const t = nodeText(n).trim();
      return `% [${n.type}]${t ? `\n${textToLatex(t, c.citeKeys)}` : ""}\n`;
    }
  }
}
/**
 * Body of one page (no \section for the page itself). The shallowest heading level used in the page maps to the sectioning level just
 * under the page's own (a page written with H2/H3 only does not skip a LaTeX level).
 */
export function docToLatex(doc: PMNode | null | undefined, c: LatexCtx): string {
  const levels = (doc?.content ?? []).filter((n) => n.type === "heading").map((n) => Math.max(1, Number(n.attrs?.level ?? 1)));
  c.headingShift = levels.length ? Math.min(...levels) - 1 : 0;
  return (doc?.content ?? []).map((n) => block(n, c)).filter((s) => s.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------- article skeleton
export interface ProjectPage { id: string; title: string; depth: number; content: PMNode }
export interface ExperimentLite { name: string; status: string; params: unknown; metrics: unknown; datasetRef: string | null; repoUrl: string | null; notes: string | null }
export interface LatexExport { tex: string; bib: string; citeKeys: string[]; missingKeys: string[]; missingRefs: string[]; figures: { attachmentId: string | null; name: string; file: string }[]; sections: number; hypotheses: number; experiments: number; unknownNodes: string[] }
const kv = (o: unknown) => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).map(([k, v]) => `${escapeLatex(k)} = ${escapeLatex(typeof v === "object" ? JSON.stringify(v) : String(v))}`).join("; ") : "");

export function buildArticle(input: { title: string; author?: string | null; date?: string; pages: ProjectPage[]; experiments: ExperimentLite[]; refs: (RefLite & Parameters<typeof bibFile>[0][number])[]; attachments?: Map<string, string>; bibName?: string }): LatexExport {
  const c = newCtx(input.refs, input.attachments ?? new Map()); const bibName = input.bibName ?? "references"; const parts: string[] = []; let abstract = "";
  input.pages.forEach((p, i) => {
    c.baseDepth = p.depth; let nodes = p.content?.content ?? [];
    if (i === 0) {
      // an "Abstract" / "Résumé" heading of the root page becomes the abstract environment
      const at = nodes.findIndex((n) => n.type === "heading" && /^(abstract|r[ée]sum[ée])$/i.test(nodeText(n).trim()));
      if (at >= 0) { let end = at + 1; while (end < nodes.length && nodes[end].type !== "heading") end++; abstract = docToLatex({ type: "doc", content: nodes.slice(at + 1, end) }, c); nodes = [...nodes.slice(0, at), ...nodes.slice(end)]; }
    }
    const body = docToLatex({ type: "doc", content: nodes }, c);
    if (i === 0) { if (body) parts.push(body); return; }
    parts.push(`\\${sectionCmd(p.depth - 1)}{${escapeLatex(p.title)}}\n% page ${p.id}\n${body}`.trim());
  });
  if (c.hypotheses.length) parts.push(`\\section{Hypotheses}\n% collected from the hypothesis callouts of the project\n\\begin{enumerate}\n${c.hypotheses.map((h) => `  \\item ${h.replace(/\n+/g, " ")}`).join("\n")}\n\\end{enumerate}`);
  if (input.experiments.length) parts.push(`\\section{Methods notes}\n% from the experiments recorded for the project\n\\begin{description}\n${input.experiments.map((e) => `  \\item[${escapeLatex(e.name)}] (${escapeLatex(e.status)})${kv(e.params) ? ` Parameters: ${kv(e.params)}.` : ""}${kv(e.metrics) ? ` Metrics: ${kv(e.metrics)}.` : ""}${e.datasetRef ? ` Data: ${escapeLatex(e.datasetRef)}.` : ""}${e.repoUrl ? ` Code: \\url{${e.repoUrl.replace(/[%#\\{}]/g, (x) => `\\${x}`)}}.` : ""}${e.notes ? ` ${textToLatex(e.notes.replace(/\n+/g, " "), c.citeKeys)}` : ""}`).join("\n")}\n\\end{description}`);
  const known = new Map(input.refs.map((r) => [r.citeKey, r])); const citeKeys = [...c.citeKeys].sort();
  const missingKeys = citeKeys.filter((k) => !known.has(k));
  // .bib companion: every project reference + every cited library reference (existing BibTeX export, deterministic order)
  const bib = bibFile(input.refs);
  const pkg = ["\\usepackage[T1]{fontenc}", "\\usepackage[utf8]{inputenc}", "\\usepackage{amsmath,amssymb}", "\\usepackage{graphicx}", "\\usepackage[normalem]{ulem}", "\\usepackage{hyperref}"];
  const tex = [
    `% Generated by SP Note — LaTeX skeleton of the project "${input.title.replace(/[\n%]/g, " ")}"`, `% ${input.pages.length} page(s), ${citeKeys.length} cite key(s), ${c.figures.size} figure placeholder(s). Figures are expected in ./figures/ (see the ZIP export).`,
    ...(missingKeys.length ? [`% WARNING — cited but absent from the library (not in ${bibName}.bib): ${missingKeys.join(", ")}`] : []), ...(c.missingRefs.length ? [`% WARNING — ${c.missingRefs.length} citation block(s) point to a reference that no longer exists (marked [?]).`] : []),
    "\\documentclass[11pt]{article}", ...pkg, "", `\\title{${escapeLatex(input.title)}}`, `\\author{${escapeLatex(input.author ?? "")}}`, `\\date{${input.date ? escapeLatex(input.date) : "\\today"}}`, "", "\\begin{document}", "\\maketitle", "",
    ...(abstract ? ["\\begin{abstract}", abstract, "\\end{abstract}", ""] : []), parts.join("\n\n"), "", ...(bib || citeKeys.length ? ["\\bibliographystyle{plain}", `\\bibliography{${bibName}}`] : ["% no reference in this project"]), "\\end{document}", "",
  ].join("\n");
  return { tex, bib, citeKeys, missingKeys, missingRefs: c.missingRefs, figures: [...c.figures.values()].map(({ attachmentId, name, file }) => ({ attachmentId, name, file })), sections: Math.max(0, input.pages.length - 1), hypotheses: c.hypotheses.length, experiments: input.experiments.length, unknownNodes: [...c.unknownNodes] };
}

// ---------- database side
export const PROJECT_MAX_PAGES = 400;
/** Pages of a project: the root and every live descendant, in tree order (position), with their depth (root = 0). Database rows are left out. */
export async function projectPages(workspaceId: string, projectId: string): Promise<ProjectPage[]> {
  const rows = [...(await db.execute<{ id: string; title: string; depth: number; content: PMNode }>(dsql`
    with recursive t as (
      select id, title, content, 0 as depth, array[position]::float8[] as path from pages where id = ${projectId} and workspace_id = ${workspaceId} and deleted_at is null
      union all
      select p.id, p.title, p.content, t.depth + 1, t.path || p.position from pages p join t on p.parent_id = t.id where p.workspace_id = ${workspaceId} and p.deleted_at is null and p.archived = false and p.database_id is null and p.type <> 'database' and t.depth < 12
    ) select id, title, content, depth from t order by path limit ${PROJECT_MAX_PAGES}`))];
  if (!rows.length) throw new HttpError(404, "Project not found", "not_found");
  return rows.map((r) => ({ id: r.id, title: r.title, depth: Number(r.depth), content: r.content }));
}
/** References of a project: attached to one of its pages, cited by key in its text, or referenced by a `citation` node. */
export async function projectReferences(workspaceId: string, pages: ProjectPage[]) {
  const R = schema.researchReferences; const ids = pages.map((p) => p.id);
  const all = await db.select().from(R).where(and(eq(R.workspaceId, workspaceId), isNull(R.deletedAt)));
  const probe = newCtx(all.map((r) => ({ id: r.id, citeKey: r.citeKey }))); const nodeRefIds = new Set<string>();
  const walk = (n: PMNode) => { if (n.type === "citation" && n.attrs?.refId) nodeRefIds.add(n.attrs.refId); (n.content ?? []).forEach(walk); };
  for (const p of pages) { docToLatex(p.content, probe); walk(p.content); }
  const inProject = new Set(ids);
  return all.filter((r) => (r.pageId && inProject.has(r.pageId)) || probe.citeKeys.has(r.citeKey) || nodeRefIds.has(r.id)).sort((a, b) => a.citeKey.localeCompare(b.citeKey));
}
export async function exportProjectLatex(workspaceId: string, projectId: string, opts: { author?: string | null } = {}): Promise<LatexExport & { title: string; pageIds: string[] }> {
  const pages = await projectPages(workspaceId, projectId); const ids = pages.map((p) => p.id);
  const refs = await projectReferences(workspaceId, pages);
  const experiments = await db.select().from(schema.experiments).where(and(eq(schema.experiments.workspaceId, workspaceId), inArray(schema.experiments.pageId, ids))).orderBy(schema.experiments.createdAt);
  const atts = await db.select({ id: schema.attachments.id, filename: schema.attachments.filename }).from(schema.attachments).where(and(eq(schema.attachments.workspaceId, workspaceId), isNull(schema.attachments.deletedAt)));
  const out = buildArticle({ title: pages[0].title, author: opts.author ?? null, pages, experiments, refs, attachments: new Map(atts.map((a) => [a.id, a.filename])) });
  return { ...out, title: pages[0].title, pageIds: ids };
}
