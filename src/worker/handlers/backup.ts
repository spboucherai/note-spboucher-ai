/** backup queue: runs scripts/backup.sh (pg_dump + uploads → AES-256 encrypted tar, sha256, prune, rsync offsite) and records a backup_jobs row. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export interface BackupJob { kind?: string; backupJobId?: string; requestedBy?: string; dryRun?: boolean }
interface Summary { path: string; size: number; sha256: string; offsite: boolean; durationSec?: number; warnings?: string[] }

export function runBackupScript(env: NodeJS.ProcessEnv, args: string[] = [], timeoutMs = 3 * 3600 * 1000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", [path.join(ROOT, "scripts", "backup.sh"), ...args], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; if (stderr.length > 200_000) stderr = stderr.slice(-100_000); });
    const timer = setTimeout(() => { child.kill("SIGTERM"); stderr += "\n[worker] backup timed out"; }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, stdout, stderr: stderr + "\n" + e.message }); });
  });
}
export async function handleBackup(d: BackupJob = {}) {
  const kind = d.kind ?? "full";
  const env = { ...process.env, DATA_DIR: process.env.DATA_DIR ?? path.join(ROOT, "data"), BACKUP_DIR: process.env.BACKUP_DIR ?? path.join(process.env.HOME ?? ROOT, "backups", "note-spboucher-ai") };
  if (d.dryRun) { const r = await runBackupScript(env, ["--dry-run"], 120_000); return { dryRun: true, code: r.code, summary: r.stdout.trim().split("\n").pop() ?? "", stderr: r.stderr.trim().split("\n").slice(-5) }; }
  let id = d.backupJobId ?? null;
  if (id) { const [row] = await db.update(schema.backupJobs).set({ status: "running", startedAt: new Date(), kind }).where(eq(schema.backupJobs.id, id)).returning(); if (!row) id = null; }
  if (!id) { const [row] = await db.insert(schema.backupJobs).values({ kind, status: "running" }).returning(); id = row.id; }
  if (!process.env.BACKUP_PASSPHRASE) { await db.update(schema.backupJobs).set({ status: "failed", error: "BACKUP_PASSPHRASE not set in the node .env", finishedAt: new Date() }).where(eq(schema.backupJobs.id, id)); throw new Error("BACKUP_PASSPHRASE not set"); }
  const r = await runBackupScript(env);
  const lastLine = r.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  let summary: Summary | null = null; try { summary = JSON.parse(lastLine); } catch {}
  if (r.code !== 0 || !summary?.path) {
    const error = `backup.sh exit ${r.code}: ${(r.stderr.trim().split("\n").slice(-6).join(" | ") || lastLine).slice(0, 2000)}`;
    await db.update(schema.backupJobs).set({ status: "failed", error, finishedAt: new Date(), ...(summary ? { path: summary.path, sizeBytes: summary.size, sha256: summary.sha256, offsite: summary.offsite } : {}) }).where(eq(schema.backupJobs.id, id));
    throw new Error(error);
  }
  const warn = summary.warnings?.length ? summary.warnings.join("; ").slice(0, 2000) : null;
  await db.update(schema.backupJobs).set({ status: "ok", path: summary.path, sizeBytes: summary.size, sha256: summary.sha256, offsite: Boolean(summary.offsite), error: warn, finishedAt: new Date() }).where(eq(schema.backupJobs.id, id));
  return { id, path: summary.path, size: summary.size, offsite: summary.offsite, warnings: summary.warnings?.length ?? 0 };
}
