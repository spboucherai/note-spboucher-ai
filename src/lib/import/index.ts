/** Import dispatcher: kind detection + `runImport` (used inline by /api/import for small files and by the worker for big ones). */
import { importMarkdown } from "./markdown";
import { importZip } from "./zip";
import { importDocx } from "./docx";
import { importPdf } from "./pdf";
import { importCsv } from "./csv";
import { importBibtexRefs } from "./bibtex";
import { restoreJson } from "./restore";
import { newCtx, ImportError, type ImportCtx } from "./pages";

export type ImportKind = "markdown" | "zip" | "docx" | "pdf" | "csv" | "bibtex" | "json";
export const KINDS: ImportKind[] = ["markdown", "zip", "docx", "pdf", "csv", "bibtex", "json"];
export const ACCEPT = ".md,.markdown,.txt,.zip,.docx,.pdf,.csv,.bib,.json";
/** Files up to this size are imported synchronously in the request; larger ones go to the worker. */
export const INLINE_MAX = 2 * 1024 * 1024;

export function detectKind(filename: string, mime = ""): ImportKind {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (ext === "md" || ext === "markdown" || ext === "txt" || mime === "text/markdown") return "markdown";
  if (ext === "zip" || mime === "application/zip" || mime === "application/x-zip-compressed") return "zip";
  if (ext === "docx" || mime.includes("wordprocessingml")) return "docx";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "csv" || mime === "text/csv") return "csv";
  if (ext === "bib" || ext === "bibtex" || mime === "application/x-bibtex") return "bibtex";
  if (ext === "json" || mime === "application/json") return "json";
  throw new ImportError(`Unsupported file type: .${ext || "?"} (${ACCEPT})`, 415);
}

export interface ImportResult { kind: ImportKind; pageId: string | null; title?: string; stats: ImportCtx["stats"]; detail?: Record<string, unknown> }
export async function runImport(input: { workspaceId: string; kind: ImportKind; buffer: Buffer; filename: string; parentId?: string | null; progress?: ImportCtx["progress"] }): Promise<ImportResult> {
  const ctx = await newCtx(input.workspaceId, input.progress);
  const name = input.filename.replace(/^.*[\\/]/, "");
  const base = name.replace(/\.[^.]+$/, "");
  const text = () => input.buffer.toString("utf8");
  switch (input.kind) {
    case "markdown": { const p = await importMarkdown(ctx, text(), { filename: name, parentId: input.parentId }); return { kind: "markdown", pageId: p.id, title: p.title, stats: ctx.stats }; }
    case "zip": { const r = await importZip(ctx, input.buffer, { parentId: input.parentId, filename: name }); return { kind: "zip", pageId: r.pageId, stats: ctx.stats, detail: { notion: r.notion, pages: r.pages, databases: r.databases } }; }
    case "docx": { const r = await importDocx(ctx, input.buffer, { filename: name, parentId: input.parentId }); return { kind: "docx", pageId: r.page.id, title: r.page.title, stats: ctx.stats, detail: { images: r.images } }; }
    case "pdf": { const r = await importPdf(ctx, input.buffer, { filename: name, parentId: input.parentId }); return { kind: "pdf", pageId: r.page.id, title: r.page.title, stats: ctx.stats, detail: { pages: r.pages } }; }
    case "csv": { const r = await importCsv(ctx, text(), { name: base, parentId: input.parentId }); return { kind: "csv", pageId: r.page.id, title: r.page.title, stats: ctx.stats, detail: { rows: r.rows, properties: r.properties.map((p) => ({ name: p.name, type: p.type })) } }; }
    case "bibtex": { const r = await importBibtexRefs(ctx, text(), input.parentId ?? null); return { kind: "bibtex", pageId: input.parentId ?? null, stats: ctx.stats, detail: r }; }
    case "json": { let data: unknown; try { data = JSON.parse(text()); } catch { throw new ImportError("Invalid JSON"); } const r = await restoreJson(ctx, data); return { kind: "json", pageId: null, stats: ctx.stats, detail: r }; }
  }
}
export { ImportError, newCtx, setImportProgress, getImportProgress, type ImportProgress } from "./pages";
