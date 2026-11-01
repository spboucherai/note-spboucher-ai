import { PgBoss } from "pg-boss";
let boss: PgBoss | null = null; let starting: Promise<PgBoss> | null = null;
export { QUEUES } from "./queues";
import { QUEUES } from "./queues";
export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  if (!starting) starting = (async () => { const b = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss", max: 3 }); b.on("error", (e: Error) => console.error("pg-boss", e)); await b.start(); for (const q of Object.values(QUEUES)) await b.createQueue(q).catch(() => {}); boss = b; return b; })();
  return starting;
}
export async function enqueue<T extends object>(queue: string, data: T, opts: Record<string, unknown> = {}) {
  try { const b = await getBoss(); return await b.send(queue, data, { retryLimit: 3, retryDelay: 10, retryBackoff: true, ...opts } as any); } catch (e) { console.error("enqueue failed", queue, e); return null; }
}
