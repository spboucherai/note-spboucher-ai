/** Background worker (PM2 "note-worker"): pg-boss consumers for indexing, imports, backups, agents, link suggestions. */
import "dotenv/config";
import { PgBoss } from "pg-boss";
import { QUEUES } from "../lib/jobs/queues";
import { handleIndex, handleReindexAll } from "./handlers/index-source";
import { handleImport } from "./handlers/import";
import { handleBackup } from "./handlers/backup";
import { handleAgentRun } from "./handlers/agent";
import { handleSuggestLinks } from "./handlers/suggest-links";
import { handleAiProperty } from "./handlers/ai-property";

const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss", max: 4 });
boss.on("error", (e: Error) => console.error("[worker] pg-boss error", e));
await boss.start();
for (const q of Object.values(QUEUES)) await boss.createQueue(q).catch(() => {});
const log = (q: string, id: string, msg: string) => console.log(`[worker] ${new Date().toISOString()} ${q} ${id.slice(0, 8)} ${msg}`);
const wrap = (q: string, fn: (data: any) => Promise<unknown>) => async (jobs: { id: string; data: any }[]) => { for (const j of jobs) { const t0 = Date.now(); try { const r = await fn(j.data); log(q, j.id, `ok ${Date.now() - t0}ms ${r ? JSON.stringify(r).slice(0, 120) : ""}`); } catch (e: any) { log(q, j.id, `FAIL ${e?.message}`); throw e; } } };
await boss.work(QUEUES.index, { batchSize: 1, pollingIntervalSeconds: 2 }, wrap(QUEUES.index, handleIndex));
await boss.work(QUEUES.reindexAll, { batchSize: 1 }, wrap(QUEUES.reindexAll, handleReindexAll));
await boss.work(QUEUES.importFile, { batchSize: 1 }, wrap(QUEUES.importFile, handleImport));
await boss.work(QUEUES.backup, { batchSize: 1 }, wrap(QUEUES.backup, handleBackup));
await boss.work(QUEUES.agent, { batchSize: 1 }, wrap(QUEUES.agent, handleAgentRun));
await boss.work(QUEUES.suggestLinks, { batchSize: 1 }, wrap(QUEUES.suggestLinks, handleSuggestLinks));
await boss.work(QUEUES.aiProperty, { batchSize: 1 }, wrap(QUEUES.aiProperty, handleAiProperty));
// nightly encrypted backup at 03:30 (node local time)
await boss.schedule(QUEUES.backup, "30 3 * * *", { kind: "full" }, { tz: "America/Toronto" });
console.log(`[worker] started, queues: ${Object.values(QUEUES).join(", ")}`);
process.on("SIGINT", async () => { await boss.stop({ graceful: true, timeout: 10_000 }); process.exit(0); });
process.on("SIGTERM", async () => { await boss.stop({ graceful: true, timeout: 10_000 }); process.exit(0); });
