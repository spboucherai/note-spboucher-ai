/**
 * POST multipart { file, kind?, parentId? } → small files are imported inline ({ page, result }); large ones are queued ({ jobId }).
 * GET ?jobId= → progress record (settings key import.<jobId>).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { handler, HttpError, uuid } from "@/lib/api";
import { enqueue, QUEUES } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { DATA_DIR } from "@/lib/files/storage";
import { detectKind, runImport, ImportError, INLINE_MAX, KINDS, setImportProgress, getImportProgress, type ImportKind } from "@/lib/import";
import { getPage } from "@/lib/pages/service";
const MAX = 500 * 1024 * 1024;
const INLINE_KINDS = new Set<ImportKind>(["markdown", "csv", "bibtex", "docx", "pdf"]);

export const POST = handler(async ({ req, ws, user }) => {
  const form = await req.formData(); const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file missing");
  if (file.size > MAX) throw new HttpError(413, "File too large (max 500 MB)");
  const parentId = (form.get("parentId") as string) || null; if (parentId) { uuid.parse(parentId); await getPage(ws.id, parentId); }
  let kind: ImportKind;
  try { const k = (form.get("kind") as string) || ""; kind = KINDS.includes(k as ImportKind) ? (k as ImportKind) : detectKind(file.name, file.type); } catch (e) { throw new HttpError(e instanceof ImportError ? e.status : 400, (e as Error).message); }
  const buffer = Buffer.from(await file.arrayBuffer());
  const sync = form.get("sync") === "1";
  if ((INLINE_KINDS.has(kind) && buffer.length <= INLINE_MAX) || sync) {
    try {
      const result = await runImport({ workspaceId: ws.id, kind, buffer, filename: file.name, parentId });
      await audit(user.id, "import", result.pageId ? { type: "page", id: result.pageId } : undefined, { kind, filename: file.name, size: file.size, stats: result.stats });
      return Response.json({ done: true, ...result }, { status: 201 });
    } catch (e) { if (e instanceof ImportError) throw new HttpError(e.status, e.message); throw e; }
  }
  // async: persist to DATA_DIR/imports and hand over to the worker
  const jobId = randomUUID();
  const dir = path.join(DATA_DIR, "imports"); await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${jobId}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120)}`);
  await fs.writeFile(tmp, buffer);
  await setImportProgress(jobId, { status: "queued", progress: 0, kind, filename: file.name, workspaceId: ws.id, message: "Queued" });
  const sent = await enqueue(QUEUES.importFile, { jobId, workspaceId: ws.id, path: tmp, kind, parentId, filename: file.name }, { retryLimit: 0, expireInSeconds: 3 * 3600 });
  if (!sent) { await fs.unlink(tmp).catch(() => {}); await setImportProgress(jobId, { status: "error", error: "Job queue unavailable" }); throw new HttpError(503, "Job queue unavailable — retry later or import a smaller file"); }
  await audit(user.id, "import.queued", undefined, { jobId, kind, filename: file.name, size: file.size });
  return Response.json({ jobId, kind }, { status: 202 });
});

export const GET = handler(async ({ req, ws }) => {
  const jobId = new URL(req.url).searchParams.get("jobId"); if (!jobId) throw new HttpError(400, "jobId required");
  const p = await getImportProgress(uuid.parse(jobId)); if (!p || (p.workspaceId && p.workspaceId !== ws.id)) throw new HttpError(404, "Unknown job");
  return Response.json({ jobId, ...p });
});
