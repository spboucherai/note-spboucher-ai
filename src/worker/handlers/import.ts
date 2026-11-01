/** import-file queue: { jobId, workspaceId, path | attachmentId, kind, parentId?, filename? } → runImport with progress in settings `import.<jobId>`. */
import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index";
import { absPath } from "../../lib/files/storage";
import { runImport, detectKind, setImportProgress, type ImportKind } from "../../lib/import/index";

export interface ImportJob { jobId?: string; workspaceId: string; path?: string; attachmentId?: string; kind?: ImportKind; parentId?: string | null; filename?: string }
export async function handleImport(d: ImportJob) {
  const jobId = d.jobId ?? `adhoc-${Date.now()}`;
  let buffer: Buffer; let filename = d.filename ?? "import";
  try {
    if (d.attachmentId) { const [a] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, d.attachmentId)); if (!a) throw new Error("attachment not found"); buffer = await fs.readFile(absPath(a.storagePath)); filename = d.filename ?? a.filename; }
    else if (d.path) buffer = await fs.readFile(d.path);
    else throw new Error("path or attachmentId required");
    const kind = d.kind ?? detectKind(filename);
    await setImportProgress(jobId, { status: "running", progress: 0.02, kind, filename, workspaceId: d.workspaceId, message: `Importing ${filename}` });
    let lastWrite = 0;
    const result = await runImport({ workspaceId: d.workspaceId, kind, buffer, filename, parentId: d.parentId ?? null, progress: async (p) => { const now = Date.now(); if (now - lastWrite < 400 && (p.progress ?? 0) < 0.95) return; lastWrite = now; await setImportProgress(jobId, { status: "running", ...(p.progress !== undefined ? { progress: p.progress } : {}), ...(p.message ? { message: p.message } : {}) }); } });
    await setImportProgress(jobId, { status: "done", progress: 1, pageId: result.pageId, stats: result.stats, message: `Imported ${filename}` });
    if (d.path) await fs.unlink(d.path).catch(() => {});
    return { jobId, pageId: result.pageId, ...result.stats };
  } catch (e) {
    await setImportProgress(jobId, { status: "error", error: (e as Error).message ?? String(e) }).catch(() => {});
    if (d.path) await fs.unlink(d.path).catch(() => {});
    throw e;
  }
}
