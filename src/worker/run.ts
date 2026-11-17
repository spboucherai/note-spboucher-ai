/** Job wrapper shared by the worker and its tests: in-process timeout, one structured log line per attempt, payload-free result summary. */
import { log } from "../lib/log";
import { QUEUE_POLICY } from "../lib/jobs/queues";

export class JobTimeout extends Error {}
export const withTimeout = <T>(p: Promise<T>, ms: number, what: string) => new Promise<T>((resolve, reject) => { const t = setTimeout(() => reject(new JobTimeout(`${what} exceeded ${Math.round(ms / 1000)} s`)), ms); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });
/** Result summaries are logged only as numbers/booleans/short ids — never free text that could be note content. */
export const safeSummary = (r: unknown) => { if (!r || typeof r !== "object") return undefined; const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(r as Record<string, unknown>)) if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && /^[0-9a-f-]{8,40}$/i.test(v))) out[k] = v; return out; };
export const wrap = (q: string, fn: (data: any) => Promise<unknown>, timeoutMs = QUEUE_POLICY[q]?.timeoutMs ?? 600_000) => async (jobs: { id: string; data: any; retryCount?: number }[]) => {
  for (const j of jobs) {
    const t0 = Date.now(); const attempt = (j.retryCount ?? 0) + 1;
    try { const r = await withTimeout(fn(j.data), timeoutMs, q); log.info({ queue: q, job: j.id, attempt, ms: Date.now() - t0, result: safeSummary(r) }, "job ok"); }
    catch (e) { log.error({ queue: q, job: j.id, attempt, ms: Date.now() - t0, timeout: e instanceof JobTimeout, detail: String((e as Error)?.message ?? e).slice(0, 300), willRetry: attempt <= (QUEUE_POLICY[q]?.retryLimit ?? 0) }, "job failed"); throw e; }
  }
};
