/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/import/job.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
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

/**
 * Import jobs: staged upload + one run with real progress, cancellation, takeover detection and resume.
 * Shared by POST /api/import (small files run in the request) and the pg-boss worker (src/worker/handlers/import.ts).
 *
 * Lifecycle of `import.<jobId>` (settings): preview → queued → running → done | error | cancelled.
 *  - the staged file `$DATA_DIR/imports/<jobId>-<name>` is removed only when the job is done or the record is dismissed/purged;
 *    a failed or cancelled job keeps it so that "Retry" needs no new upload;
 *  - what a run creates is recorded in the job ledger (pages.ts): a retry skips it instead of creating it twice;
 *  - records and staged files older than `KEEP_DAYS` are purged opportunistically.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "@/lib/files/storage";
import { QUEUE_POLICY } from "@/lib/jobs/queues";
import { runImport, type ImportResult } from "./index";
import { clearLedger, deleteImportRecord, getImportProgress, listImportJobs, setImportProgress, updateImportRun, ImportAborted, STALLED_MS, type DuplicateMode, type ImportProgress } from "./pages";
import type { ImportKind } from "./validate";

export const IMPORT_DIR = path.join(DATA_DIR, "imports");
/** Attempts of a queued import = the queue's retry policy (src/lib/jobs/queues.ts) + the first run. The worker handler stops at this number. */
export const MAX_ATTEMPTS = (QUEUE_POLICY["import-file"]?.retryLimit ?? 1) + 1;
const KEEP_DAYS = 7; const PREVIEW_KEEP_HOURS = 24;
const iso = () => new Date().toISOString();

export const stagedPath = (staged: string) => path.join(IMPORT_DIR, path.basename(staged));
export async function stageFile(jobId: string, filename: string, buffer: Buffer): Promise<string> {
  await fs.mkdir(IMPORT_DIR, { recursive: true });
  const staged = `${jobId}-${filename.replace(/^.*[\\/]/, "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "upload"}`;
  await fs.writeFile(stagedPath(staged), buffer);
  return staged;
}
export async function readStaged(staged: string | null | undefined): Promise<Buffer | null> { if (!staged) return null; try { return await fs.readFile(stagedPath(staged)); } catch { return null; } }
export async function removeStaged(staged: string | null | undefined) { if (staged) await fs.unlink(stagedPath(staged)).catch(() => {}); }

export const isStalled = (p: ImportProgress, now = Date.now()) => (p.status === "running" || p.status === "queued") && now - new Date(p.status === "running" ? (p.progressAt ?? p.updatedAt) : p.updatedAt).getTime() > STALLED_MS;
/** What the browser may see of a job record. */
export function publicJob(jobId: string, p: ImportProgress) {
  const { workspaceId: _w, userId: _u, staged, runId: _r, preview: _p, ...rest } = p;
  return { jobId, ...rest, stalled: isStalled(p), canRetry: Boolean(staged) && (p.status === "error" || p.status === "cancelled" || isStalled(p)) };
}

/** Removes old job records, their ledgers and staged files. Never throws. */
export async function purgeStaleImports(workspaceId: string) {
  try {
    const now = Date.now();
    for (const j of await listImportJobs(workspaceId, 200)) {
      const age = now - new Date(j.updatedAt).getTime();
      const old = j.status === "preview" ? age > PREVIEW_KEEP_HOURS * 3600_000 : j.status === "running" || j.status === "queued" ? age > 2 * KEEP_DAYS * 86400_000 : age > KEEP_DAYS * 86400_000;
      if (old) { await removeStaged(j.staged); await deleteImportRecord(j.jobId); }
    }
    for (const f of await fs.readdir(IMPORT_DIR).catch(() => [] as string[])) { const st = await fs.stat(path.join(IMPORT_DIR, f)).catch(() => null); if (st && now - st.mtimeMs > 2 * KEEP_DAYS * 86400_000) await fs.unlink(path.join(IMPORT_DIR, f)).catch(() => {}); }
  } catch { /* housekeeping only */ }
}

export interface JobRun { jobId: string; workspaceId: string; kind: ImportKind; buffer: Buffer; filename: string; parentId?: string | null; duplicates?: DuplicateMode; attempts?: number }
/**
 * One run of a job. Returns the result, or null when the run was stopped (cancelled by the user, or superseded by a newer run of the same
 * job — in both cases the record is left to whoever owns it now). Errors are thrown to the caller, which decides between retry and failure.
 */
export async function executeJob(j: JobRun): Promise<ImportResult | null> {
  const runId = randomUUID(); const t0 = iso();
  await setImportProgress(j.jobId, { status: "running", runId, cancelRequested: false, error: null, errorCode: null, message: `Importing ${j.filename}`, progressAt: t0, heartbeatAt: t0, attempts: j.attempts ?? 1, maxAttempts: MAX_ATTEMPTS });
  let last = 0;
  const progress = async (p: { progress?: number; message?: string; done?: number; total?: number }) => {
    const now = Date.now(); if (now - last < 500) return; last = now;
    const frac = p.done != null && p.total ? Math.min(0.99, p.done / p.total) : p.progress;
    const rec = await updateImportRun(j.jobId, runId, { ...(frac !== undefined ? { progress: frac } : {}), ...(p.done != null ? { done: p.done, total: p.total } : {}), ...(p.message ? { message: p.message.slice(0, 200) } : {}), progressAt: iso(), heartbeatAt: iso() });
    if (!rec) throw new ImportAborted();
  };
  const heartbeat = setInterval(() => { void updateImportRun(j.jobId, runId, { heartbeatAt: iso() }).catch(() => {}); }, 30_000);
  try {
    const result = await runImport({ workspaceId: j.workspaceId, kind: j.kind, buffer: j.buffer, filename: j.filename, parentId: j.parentId ?? null, duplicates: j.duplicates ?? "skip", jobId: j.jobId, progress });
    const done: Partial<ImportProgress> = { status: "done", progress: 1, pageId: result.pageId, stats: { ...result.stats, skipped: result.stats.skipped.slice(0, 60) }, message: `Imported ${j.filename}`, progressAt: iso() };
    let rec = await updateImportRun(j.jobId, runId, done);
    if (!rec) { // cancelled while the last item was being written: everything exists, say so — unless another run owns the job now
      const cur = await getImportProgress(j.jobId); if (!cur || cur.runId !== runId) return null;
      rec = await setImportProgress(j.jobId, { ...done, cancelRequested: false });
    }
    await clearLedger(j.jobId); await removeStaged(rec.staged); await setImportProgress(j.jobId, { staged: null });
    return result;
  } catch (e) {
    if (e instanceof ImportAborted) return null;
    throw e;
  } finally { clearInterval(heartbeat); }
}
/** Counts only — safe for the audit log. */
export const auditCounts = (r: ImportResult) => ({ pages: r.stats.pages, databases: r.stats.databases, rows: r.stats.rows, attachments: r.stats.attachments, references: r.stats.references, duplicatesSkipped: r.stats.duplicates, resumed: r.stats.resumed, notes: r.stats.skipped.length });
