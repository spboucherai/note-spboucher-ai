/**
 * import-file queue: { jobId, workspaceId, userId?, path | attachmentId, kind?, parentId?, filename?, duplicates? } → one run of the job
 * (src/lib/import/job.ts) with real progress in settings `import.<jobId>`.
 *
 * Retry policy = the queue policy (src/lib/jobs/queues.ts): a retried attempt (or a job re-delivered after a worker restart or an in-process
 * timeout) resumes from the job ledger and skips what already exists. Invalid input (ImportError) is marked failed at once and is not run
 * again by the automatic re-delivery. The staged upload is never deleted here on failure: it is removed when the job is done, dismissed
 * by the user, or purged after a week.
 */
import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index";
import { absPath } from "../../lib/files/storage";
import { audit } from "../../lib/audit";
import { detectKind, getImportProgress, setImportProgress, ImportError, type ImportKind, type DuplicateMode } from "../../lib/import/index";
import { executeJob, auditCounts, MAX_ATTEMPTS } from "../../lib/import/job";

export interface ImportJob { jobId?: string; workspaceId: string; userId?: string | null; path?: string; attachmentId?: string; kind?: ImportKind; parentId?: string | null; filename?: string; duplicates?: DuplicateMode }
export async function handleImport(d: ImportJob) {
  const jobId = d.jobId ?? `adhoc-${Date.now()}`;
  const rec = await getImportProgress(jobId);
  if (rec?.status === "done") return { jobId, already: "done" };
  // a job that failed for good is "queued" again by a manual Retry before it is re-sent; still "error" here = an automatic re-delivery:
  // do not run it again, fail fast so that pg-boss files it in the dead-letter queue
  if (rec?.status === "error") throw new Error(`import ${jobId} already failed (${rec.errorCode ?? "import_failed"})`);
  if (rec?.status === "cancelled" || rec?.cancelRequested) { await setImportProgress(jobId, { status: "cancelled" }); return { jobId, cancelled: true }; }
  const attempts = (rec?.attempts ?? 0) + 1; const userId = d.userId ?? rec?.userId ?? null;
  let filename = d.filename ?? rec?.filename ?? "import"; let size = 0; let kind: ImportKind | undefined = d.kind;
  const fail = async (e: unknown, definitive: boolean) => {
    const message = String((e as Error)?.message ?? e).slice(0, 500); const code = e instanceof ImportError ? e.code : "import_failed";
    if (definitive) { await setImportProgress(jobId, { status: "error", error: message, errorCode: code, retryable: !(e instanceof ImportError), attempts, message: "Import failed" }).catch(() => {}); await audit(userId, "import.failed", undefined, { jobId, kind, size, attempts, code }); }
    else await setImportProgress(jobId, { status: "queued", error: message, errorCode: code, attempts, message: `Attempt ${attempts} of ${MAX_ATTEMPTS} failed — retrying automatically; nothing is imported twice` }).catch(() => {});
  };
  let buffer: Buffer;
  try {
    if (d.attachmentId) { const [a] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, d.attachmentId)); if (!a) throw new ImportError("The attachment to import no longer exists.", 404, "missing_upload"); buffer = await fs.readFile(absPath(a.storagePath)); filename = d.filename ?? a.filename; }
    else if (d.path) { try { buffer = await fs.readFile(d.path); } catch { throw new ImportError("The uploaded file is no longer on the server — upload it again.", 410, "missing_upload"); } }
    else throw new ImportError("Nothing to import (no staged file).", 400, "missing_upload");
    size = buffer.length; kind = kind ?? detectKind(filename);
    await setImportProgress(jobId, { kind, filename, size, workspaceId: d.workspaceId, ...(userId ? { userId } : {}) });
    const result = await executeJob({ jobId, workspaceId: d.workspaceId, kind, buffer, filename, parentId: d.parentId ?? rec?.parentId ?? null, duplicates: d.duplicates ?? rec?.duplicates ?? "skip", attempts });
    if (!result) return { jobId, stopped: true };
    await audit(userId, "import", result.pageId ? { type: "page", id: result.pageId } : undefined, { jobId, kind, size, attempts, ...auditCounts(result) });
    return { jobId, pageId: result.pageId, ...auditCounts(result) };
  } catch (e) {
    // invalid input never gets better; anything else is retried by pg-boss (queue policy) until MAX_ATTEMPTS, resuming from the ledger.
    // The user-facing message stays in the job record; what is thrown (and logged by the worker wrapper) carries ids and codes only.
    const definitive = e instanceof ImportError || attempts >= MAX_ATTEMPTS;
    await fail(e, definitive);
    throw new Error(`import ${jobId} failed (${e instanceof ImportError ? e.code : (e as Error)?.name ?? "error"}), attempt ${attempts} of ${MAX_ATTEMPTS}${definitive ? ", final" : ""}`);
  }
}
