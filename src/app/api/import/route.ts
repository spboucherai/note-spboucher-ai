/**
 * Import API.
 *  POST multipart { file, kind?, parentId? } ?preview=1 → validates and stages the upload, returns { jobId, preview } — nothing is created.
 *  POST JSON { jobId, duplicates: "skip" | "import" }      → confirms a previewed upload: small files are imported in the request
 *                                                            (201 { done, pageId, stats }), the others are queued (202 { jobId }).
 *                                                            A JSON backup with duplicates = "import" overwrites existing pages:
 *                                                            it requires a fresh passkey (403 reauth_required otherwise).
 *  POST multipart { file, …, duplicates?, sync? }          → one-step import without preview (duplicates default "skip").
 *  POST ?retry=<jobId>                                      → runs a failed / cancelled / stalled job again; it resumes, nothing is duplicated.
 *  GET ?jobId=                                              → job record (status, done/total, stalled, canRetry, stats, error).
 *  GET                                                      → recent jobs of the workspace (so a reload finds a running or failed import).
 *  DELETE ?jobId=                                           → cancels a queued/running job, or dismisses a finished one (staged file removed).
 * Every upload is validated server-side (src/lib/import/validate.ts) and every step is audited with counts only.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { handler, HttpError, parseBody, uuid, requireFresh } from "@/lib/api";
import { enqueue, QUEUES } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { detectKind, validateUpload, previewImport, ImportError, INLINE_MAX, INLINE_KINDS, KINDS, LIMITS, setImportProgress, getImportProgress, deleteImportRecord, listImportJobs, type ImportKind, type DuplicateMode, type ImportProgress } from "@/lib/import";
import { executeJob, auditCounts, isStalled, publicJob, purgeStaleImports, readStaged, removeStaged, stageFile, stagedPath, MAX_ATTEMPTS } from "@/lib/import/job";
import { getPage } from "@/lib/pages/service";
export const maxDuration = 300;

const asHttp = (e: unknown) => (e instanceof ImportError ? new HttpError(e.status, e.message, e.code) : e);
const modeOf = (v: unknown): DuplicateMode => (v === "import" ? "import" : "skip");
type Who = { wsId: string; userId: string };
/** Overwriting existing pages with a backup replaces their current text for good: that one needs a fresh passkey (client: withFreshAuth). */
const overwrites = (kind: unknown, duplicates: DuplicateMode) => kind === "json" && duplicates === "import";

/** Runs the job in the request when it is small, otherwise hands it to the worker. */
async function start(who: Who, jobId: string, job: { kind: ImportKind; filename: string; size: number; staged: string; parentId: string | null; duplicates: DuplicateMode; sync?: boolean; buffer?: Buffer }) {
  const base = { kind: job.kind, filename: job.filename, size: job.size, workspaceId: who.wsId, userId: who.userId, staged: job.staged, parentId: job.parentId, duplicates: job.duplicates, cancelRequested: false, error: null, errorCode: null, attempts: 0, maxAttempts: MAX_ATTEMPTS, progress: 0, done: 0 } satisfies Partial<ImportProgress>;
  if ((INLINE_KINDS.has(job.kind) && job.size <= INLINE_MAX) || job.sync) {
    const buffer = job.buffer ?? (await readStaged(job.staged));
    if (!buffer) throw new HttpError(410, "The uploaded file is no longer on the server — choose it again.", "missing_upload");
    await setImportProgress(jobId, { ...base, status: "running", message: `Importing ${job.filename}` });
    try {
      const result = await executeJob({ jobId, workspaceId: who.wsId, kind: job.kind, buffer, filename: job.filename, parentId: job.parentId, duplicates: job.duplicates });
      if (!result) throw new HttpError(409, "The import was cancelled. What was already imported is kept.", "cancelled", { jobId });
      await audit(who.userId, "import", result.pageId ? { type: "page", id: result.pageId } : undefined, { jobId, kind: job.kind, size: job.size, duplicates: job.duplicates, ...auditCounts(result) });
      return Response.json({ done: true, jobId, ...result, stats: { ...result.stats, skipped: result.stats.skipped.slice(0, 60) } }, { status: 201 });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const invalid = e instanceof ImportError;
      await setImportProgress(jobId, { status: "error", error: invalid ? e.message : "The import stopped before finishing. Retry resumes where it stopped — nothing is imported twice.", errorCode: invalid ? e.code : "import_failed", retryable: !invalid, message: "Import failed" }).catch(() => {});
      await audit(who.userId, "import.failed", undefined, { jobId, kind: job.kind, size: job.size, code: invalid ? e.code : "import_failed" });
      if (invalid) throw asHttp(e);
      log.error({ jobId, kind: job.kind, size: job.size, err: (e as Error)?.name, detail: String((e as Error)?.message ?? e).slice(0, 200) }, "import failed");
      throw new HttpError(500, "The import stopped before finishing. Retry resumes where it stopped — nothing is imported twice.", "import_failed", { jobId });
    }
  }
  // retries and expiry come from the queue policy (src/lib/jobs/queues.ts). No singletonKey on purpose: retrying a stalled job must be able
  // to queue a second delivery; two deliveries of one job cannot both write (the newer run takes the record over, the older one stops).
  await setImportProgress(jobId, { ...base, status: "queued", message: "Waiting for the background worker" });
  const sent = await enqueue(QUEUES.importFile, { jobId, workspaceId: who.wsId, userId: who.userId, path: stagedPath(job.staged), kind: job.kind, parentId: job.parentId, filename: job.filename, duplicates: job.duplicates });
  if (!sent) { await setImportProgress(jobId, { status: "error", error: "The job queue is unavailable. The upload is kept: retry in a moment.", errorCode: "queue_unavailable", retryable: true }); throw new HttpError(503, "The job queue is unavailable. The upload is kept: retry in a moment.", "queue_unavailable", { jobId }); }
  await audit(who.userId, "import.queued", undefined, { jobId, kind: job.kind, size: job.size, duplicates: job.duplicates });
  return Response.json({ jobId, kind: job.kind }, { status: 202 });
}
async function owned(wsId: string, raw: string | null) {
  const id = uuid.safeParse(raw); if (!id.success) throw new HttpError(400, "jobId required");
  const rec = await getImportProgress(id.data); if (!rec || rec.workspaceId !== wsId) throw new HttpError(404, "Unknown import job");
  return { jobId: id.data, rec };
}

export const POST = handler(async ({ req, ws, user }) => {
  const u = new URL(req.url); const who: Who = { wsId: ws.id, userId: user.id };
  // ---- retry a failed / cancelled / stalled job
  if (u.searchParams.get("retry")) {
    const { jobId, rec } = await owned(ws.id, u.searchParams.get("retry"));
    if (rec.status === "done") return Response.json({ done: true, jobId, pageId: rec.pageId ?? null, stats: rec.stats });
    if (!(rec.status === "error" || rec.status === "cancelled" || isStalled(rec))) throw new HttpError(409, "This import is still running.", "in_progress");
    if (!rec.staged || !rec.kind || !(await readStaged(rec.staged))) throw new HttpError(410, "The uploaded file is no longer on the server — choose it again.", "missing_upload");
    if (overwrites(rec.kind, modeOf(rec.duplicates))) requireFresh(user);
    await audit(user.id, "import.retry", undefined, { jobId, kind: rec.kind, size: rec.size ?? 0, from: rec.status });
    return start(who, jobId, { kind: rec.kind as ImportKind, filename: rec.filename ?? "import", size: rec.size ?? 0, staged: rec.staged, parentId: rec.parentId ?? null, duplicates: modeOf(rec.duplicates) });
  }
  // ---- confirm a previewed upload
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const b = await parseBody(req, z.object({ jobId: uuid, duplicates: z.enum(["skip", "import"]).optional() }));
    const { jobId, rec } = await owned(ws.id, b.jobId);
    if (rec.status === "done") return Response.json({ done: true, jobId, pageId: rec.pageId ?? null, stats: rec.stats });
    if (rec.status === "queued" || rec.status === "running") return Response.json({ jobId, kind: rec.kind }, { status: 202 });
    if (rec.status !== "preview") throw new HttpError(409, "This import already ran — use Retry.", "conflict");
    if (!rec.staged || !rec.kind) throw new HttpError(410, "The uploaded file is no longer on the server — choose it again.", "missing_upload");
    if (overwrites(rec.kind, modeOf(b.duplicates))) requireFresh(user);
    return start(who, jobId, { kind: rec.kind as ImportKind, filename: rec.filename ?? "import", size: rec.size ?? 0, staged: rec.staged, parentId: rec.parentId ?? null, duplicates: modeOf(b.duplicates) });
  }
  // ---- upload (preview, or one-step import)
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > LIMITS.upload + 1024 * 1024) throw new HttpError(413, "File too large (max 500 MB).", "file_too_large");
  const form = await req.formData().catch(() => { throw new HttpError(400, "The upload was interrupted or is not a valid form.", "bad_upload"); });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file missing");
  if (file.size > LIMITS.upload) throw new HttpError(413, "File too large (max 500 MB).", "file_too_large");
  const parentId = (form.get("parentId") as string) || null; if (parentId) { uuid.parse(parentId); await getPage(ws.id, parentId); }
  const filename = file.name.replace(/^.*[\\/]/, "").slice(0, 255) || "upload";
  let kind: ImportKind; const buffer = Buffer.from(await file.arrayBuffer());
  try { const k = (form.get("kind") as string) || ""; kind = KINDS.includes(k as ImportKind) ? (k as ImportKind) : detectKind(filename, file.type); validateUpload({ kind, buffer, filename }); } catch (e) { throw asHttp(e); }
  const jobId = randomUUID();
  void purgeStaleImports(ws.id);
  if (u.searchParams.get("preview") === "1" || form.get("preview") === "1") {
    let preview; try { preview = await previewImport({ workspaceId: ws.id, kind, buffer, filename }); } catch (e) { throw asHttp(e); }
    const staged = await stageFile(jobId, filename, buffer);
    await setImportProgress(jobId, { status: "preview", kind, filename, size: buffer.length, workspaceId: ws.id, userId: user.id, staged, parentId, message: "Waiting for confirmation" });
    await audit(user.id, "import.preview", undefined, { jobId, kind, size: buffer.length, wouldCreate: preview.counts, duplicates: preview.duplicates.total, warnings: preview.warnings.length });
    return Response.json({ jobId, kind, inline: INLINE_KINDS.has(kind) && buffer.length <= INLINE_MAX, preview });
  }
  if (overwrites(kind, modeOf(form.get("duplicates")))) requireFresh(user);
  const staged = await stageFile(jobId, filename, buffer);
  return start(who, jobId, { kind, filename, size: buffer.length, staged, parentId, duplicates: modeOf(form.get("duplicates")), sync: form.get("sync") === "1", buffer });
});

export const GET = handler(async ({ req, ws }) => {
  const raw = new URL(req.url).searchParams.get("jobId");
  if (!raw) return Response.json({ jobs: (await listImportJobs(ws.id, 30)).filter((j) => j.status !== "preview").slice(0, 10).map((j) => publicJob(j.jobId, j)) });
  const { jobId, rec } = await owned(ws.id, raw);
  return Response.json(publicJob(jobId, rec));
});

export const DELETE = handler(async ({ req, ws, user }) => {
  const { jobId, rec } = await owned(ws.id, new URL(req.url).searchParams.get("jobId"));
  if (rec.status === "queued" || rec.status === "running") {
    // the running attempt notices at its next progress write and stops; what it created stays and a retry resumes from there
    await setImportProgress(jobId, { status: "cancelled", cancelRequested: true, message: "Cancelled — what was already imported is kept" });
    await audit(user.id, "import.cancel", undefined, { jobId, kind: rec.kind, done: rec.done ?? 0, total: rec.total ?? 0 });
    return Response.json({ ok: true, cancelled: true });
  }
  await removeStaged(rec.staged); await deleteImportRecord(jobId);
  if (rec.status !== "done") await audit(user.id, "import.dismiss", undefined, { jobId, kind: rec.kind, from: rec.status });
  return Response.json({ ok: true, removed: true });
});
