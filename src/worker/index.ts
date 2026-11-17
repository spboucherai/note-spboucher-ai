/**
 * Background worker (PM2 "note-worker"): pg-boss consumers for indexing, imports, backups, agents, link suggestions, AI properties
 * and hourly maintenance. Every job: one structured log line (queue, job id, attempt, duration, outcome — never payload content),
 * an in-process timeout, the queue's retry policy (src/lib/jobs/queues.ts), and a dead-letter copy when it fails for good.
 * A heartbeat row (`settings.worker.heartbeat`) lets the web app and /api/health tell whether the worker is alive.
 */
import "dotenv/config";
import { PgBoss } from "pg-boss";
import { sql as dsql } from "drizzle-orm";
import { QUEUES, QUEUE_POLICY } from "../lib/jobs/queues";
import { ensureQueues } from "../lib/jobs/index";
import { db, schema } from "../db/index";
import { log } from "../lib/log";
import { wrap } from "./run";
import { handleIndex, handleReindexAll } from "./handlers/index-source";
import { handleImport } from "./handlers/import";
import { handleBackup } from "./handlers/backup";
import { handleAgentRun } from "./handlers/agent";
import { handleSuggestLinks } from "./handlers/suggest-links";
import { handleAiProperty } from "./handlers/ai-property";
import { handleMaintenance } from "./handlers/maintenance";

const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss", max: 4 });
boss.on("error", (e: Error) => log.error({ detail: e.message }, "pg-boss error"));
await boss.start();
await ensureQueues(boss);

const work = (q: string, fn: (d: any) => Promise<unknown>, opts: Record<string, unknown> = {}) => boss.work(q, { batchSize: 1, includeMetadata: true, ...opts } as any, wrap(q, fn) as any);
await work(QUEUES.index, handleIndex, { pollingIntervalSeconds: 2 });
await work(QUEUES.reindexAll, handleReindexAll);
await work(QUEUES.importFile, handleImport);
await work(QUEUES.backup, handleBackup);
await work(QUEUES.agent, handleAgentRun);
await work(QUEUES.suggestLinks, handleSuggestLinks);
await work(QUEUES.aiProperty, handleAiProperty);
await work(QUEUES.maintenance, handleMaintenance);
// nightly encrypted backup at 03:30 America/Toronto; hourly housekeeping
await boss.schedule(QUEUES.backup, "30 3 * * *", { kind: "full" }, { tz: "America/Toronto" });
await boss.schedule(QUEUES.maintenance, "17 * * * *", {}, { tz: "America/Toronto" });

const beat = async () => { try { await db.insert(schema.settings).values({ key: "worker.heartbeat", value: { at: new Date().toISOString(), pid: process.pid, version: process.env.APP_VERSION ?? "dev" } }).onConflictDoUpdate({ target: schema.settings.key, set: { value: dsql`excluded.value`, updatedAt: new Date() } }); } catch (e) { log.warn({ detail: (e as Error).message }, "heartbeat failed"); } };
await beat(); const beatTimer = setInterval(beat, 30_000);
log.info({ queues: Object.values(QUEUES), pid: process.pid }, "worker started");
let stopping = false;
const stop = async (sig: string) => { if (stopping) return; stopping = true; clearInterval(beatTimer); log.info({ sig }, "worker stopping (waiting up to 20 s for the running job)"); try { await boss.stop({ graceful: true, timeout: 20_000 }); } catch { /* forced */ } process.exit(0); };
process.on("SIGINT", () => stop("SIGINT")); process.on("SIGTERM", () => stop("SIGTERM"));
process.on("unhandledRejection", (e) => log.error({ detail: String((e as Error)?.message ?? e).slice(0, 300) }, "unhandled rejection"));
