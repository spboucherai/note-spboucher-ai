import { PgBoss } from "pg-boss";
let boss: PgBoss | null = null; let starting: Promise<PgBoss> | null = null;
export { QUEUES, DEAD_LETTER, QUEUE_POLICY } from "./queues";
import { QUEUES, DEAD_LETTER, QUEUE_POLICY } from "./queues";

/** Create the queues if needed and (re)apply the policy — idempotent, called by the web process and by the worker at start. */
export async function ensureQueues(b: PgBoss) {
  await b.createQueue(DEAD_LETTER, { retryLimit: 0, deleteAfterSeconds: 30 * 86_400 } as any).catch(() => {});
  for (const q of Object.values(QUEUES)) {
    const p = QUEUE_POLICY[q]; const opts: Record<string, unknown> = p ? { retryLimit: p.retryLimit, retryDelay: p.retryDelay ?? 0, retryBackoff: Boolean(p.retryBackoff), expireInSeconds: p.expireInSeconds, ...(p.deadLetter ? { deadLetter: DEAD_LETTER } : {}) } : {};
    await b.createQueue(q, opts as any).catch(() => {});
    if (p) await b.updateQueue(q, opts as any).catch((e: Error) => console.error("queue policy not applied", q, e.message));
  }
}
export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  if (!starting) starting = (async () => { const b = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss", max: Number(process.env.DB_POOL_MAX ?? 3) }); b.on("error", (e: Error) => console.error("pg-boss", e.message)); await b.start(); await ensureQueues(b); boss = b; return b; })().catch((e) => { starting = null; throw e; });
  return starting;
}
/**
 * Queue a job. Retry/expiry come from the queue policy; pass `singletonKey` (+ `singletonSeconds`) to de-duplicate — the same key
 * cannot be queued twice inside the window, which is what stops double indexing / double imports when a request is repeated.
 * Returns the job id, or null when the job was de-duplicated or the queue is unreachable (logged; the caller decides if that matters).
 */
export async function enqueue<T extends object>(queue: string, data: T, opts: Record<string, unknown> = {}) {
  try { const b = await getBoss(); return await b.send(queue, data, opts as any); } catch (e) { console.error("enqueue failed", queue, (e as Error).message); return null; }
}
