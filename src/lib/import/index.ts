/** Import dispatcher: `runImport` (used inline by /api/import for small files and by the worker for big ones). */
import { importMarkdown } from "./markdown";
import { importZip } from "./zip";
import { importDocx } from "./docx";
import { importPdf } from "./pdf";
import { importCsv, parseCsv } from "./csv";
import { importBibtexRefs, parseBibtexSafe } from "./bibtex";
import { restoreJson } from "./restore";
import { newCtx, getPageById, tick, ImportError, type ImportCtx, type DuplicateMode } from "./pages";
import { sha256Hex, validateUpload, type ImportKind } from "./validate";

export { detectKind, validateUpload, KINDS, ACCEPT, LIMITS, type ImportKind } from "./validate";
/** Files up to this size are imported synchronously in the request; larger ones go to the worker. */
export const INLINE_MAX = 2 * 1024 * 1024;
export const INLINE_KINDS = new Set<ImportKind>(["markdown", "csv", "bibtex", "docx", "pdf"]);

export interface ImportResult { kind: ImportKind; pageId: string | null; title?: string; stats: ImportCtx["stats"]; detail?: Record<string, unknown> }
export interface RunInput { workspaceId: string; kind: ImportKind; buffer: Buffer; filename: string; parentId?: string | null; progress?: ImportCtx["progress"]; /** default "skip" */ duplicates?: DuplicateMode; /** enables the resume ledger */ jobId?: string | null }
export async function runImport(input: RunInput): Promise<ImportResult> {
  const name = input.filename.replace(/^.*[\\/]/, "");
  validateUpload({ kind: input.kind, buffer: input.buffer, filename: name });
  const ctx = await newCtx(input.workspaceId, { progress: input.progress, duplicates: input.duplicates ?? "skip", jobId: input.jobId });
  const base = name.replace(/\.[^.]+$/, "");
  const text = () => input.buffer.toString("utf8");
  /** DOCX / PDF: the same file (sha256) already attached to a live page = already imported */
  const sameFile = async (ledgerKey: string) => {
    if (!ctx.existing || ctx.ledger?.has(`page:${ledgerKey}`) || ctx.ledger?.has(`att:${ledgerKey}`)) return null;
    const hit = ctx.existing.files.get(sha256Hex(input.buffer)); const p = hit ? await getPageById(ctx, hit.pageId) : undefined; if (!p) return null;
    ctx.stats.duplicates++; ctx.stats.skipped.push(`This exact file is already stored on “${p.title}” — not imported again`); ctx.total = 1; await tick(ctx, "Already imported");
    return p;
  };
  switch (input.kind) {
    case "markdown": { ctx.total = 1; const p = await importMarkdown(ctx, text(), { key: "md", filename: name, parentId: input.parentId }); await tick(ctx, `Page ${p.title}`); return { kind: "markdown", pageId: p.id, title: p.title, stats: ctx.stats }; }
    case "zip": { const r = await importZip(ctx, input.buffer, { parentId: input.parentId, filename: name }); return { kind: "zip", pageId: r.pageId, stats: ctx.stats, detail: { notion: r.notion, pages: r.pages, databases: r.databases } }; }
    case "docx": { const dup = await sameFile("docx"); if (dup) return { kind: "docx", pageId: dup.id, title: dup.title, stats: ctx.stats, detail: { duplicate: true } }; ctx.total = 2; const r = await importDocx(ctx, input.buffer, { filename: name, parentId: input.parentId }); return { kind: "docx", pageId: r.page.id, title: r.page.title, stats: ctx.stats, detail: { images: r.images } }; }
    case "pdf": { const dup = await sameFile("pdf"); if (dup) return { kind: "pdf", pageId: dup.id, title: dup.title, stats: ctx.stats, detail: { duplicate: true } }; ctx.total = 2; const r = await importPdf(ctx, input.buffer, { filename: name, parentId: input.parentId }); return { kind: "pdf", pageId: r.page.id, title: r.page.title, stats: ctx.stats, detail: { pages: r.pages } }; }
    case "csv": { const t = text(); ctx.total = 1 + parseCsv(t).rows.length; const r = await importCsv(ctx, t, { key: "csv", name: base, parentId: input.parentId }); return { kind: "csv", pageId: r.page.id, title: r.page.title, stats: ctx.stats, detail: { rows: r.rows, duplicate: r.duplicate, properties: r.properties.map((p) => ({ name: p.name, type: p.type })) } }; }
    case "bibtex": { const t = text(); ctx.total = parseBibtexSafe(t).length; const r = await importBibtexRefs(ctx, t, input.parentId ?? null); return { kind: "bibtex", pageId: input.parentId ?? null, stats: ctx.stats, detail: { created: r.created, parsed: r.parsed, skipped: r.skipped.slice(0, 200), renamed: r.renamed.slice(0, 200) } }; }
    case "json": { let data: unknown; try { data = JSON.parse(text()); } catch { throw new ImportError("The file is not valid JSON.", 400, "bad_json"); } const r = await restoreJson(ctx, data); return { kind: "json", pageId: null, stats: ctx.stats, detail: r }; }
  }
}
export { previewImport, type ImportPreview } from "./preview";
export { ImportError, ImportAborted, newCtx, setImportProgress, updateImportRun, getImportProgress, deleteImportRecord, listImportJobs, clearLedger, STALLED_MS, type ImportProgress, type ImportStatus, type DuplicateMode, type ImportStats } from "./pages";
