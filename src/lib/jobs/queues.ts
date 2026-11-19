export const QUEUES = { index: "index-source", importFile: "import-file", backup: "backup", agent: "agent-run", suggestLinks: "suggest-links", aiProperty: "ai-property", reindexAll: "reindex-all", maintenance: "maintenance", graphInsights: "graph-insights" } as const;
export const DEAD_LETTER = "dead-letter";
/**
 * Per-queue policy (pg-boss queue options). Rules:
 *  - retries with exponential backoff ONLY for work that is safe to repeat (indexing is content-hash idempotent);
 *  - anything that calls a paid AI model with side effects, or that is long and scheduled (backup), is never retried automatically —
 *    a human presses "Retry" after reading the error, so nothing is billed or run twice behind their back;
 *  - `expireInSeconds` is the hard cap for a job in the active state: a worker that died mid-job releases it after that delay;
 *  - `timeoutMs` is the in-process cap enforced by the worker wrapper (a little below the expiry);
 *  - jobs that exhaust their retries are copied to the dead-letter queue, where Settings → Jobs lists them.
 */
export const QUEUE_POLICY: Record<string, { retryLimit: number; retryDelay?: number; retryBackoff?: boolean; expireInSeconds: number; timeoutMs: number; deadLetter?: boolean }> = {
  "index-source": { retryLimit: 4, retryDelay: 15, retryBackoff: true, expireInSeconds: 300, timeoutMs: 240_000, deadLetter: true },
  "reindex-all": { retryLimit: 1, retryDelay: 60, expireInSeconds: 3600, timeoutMs: 3_500_000, deadLetter: true },
  "import-file": { retryLimit: 1, retryDelay: 30, expireInSeconds: 3600, timeoutMs: 3_500_000, deadLetter: true },
  "backup": { retryLimit: 0, expireInSeconds: 4 * 3600, timeoutMs: 4 * 3600_000 - 60_000, deadLetter: true },
  "agent-run": { retryLimit: 0, expireInSeconds: 900, timeoutMs: 840_000, deadLetter: true },
  "suggest-links": { retryLimit: 0, expireInSeconds: 600, timeoutMs: 540_000, deadLetter: true },
  "ai-property": { retryLimit: 1, retryDelay: 20, expireInSeconds: 300, timeoutMs: 240_000, deadLetter: true },
  "maintenance": { retryLimit: 0, expireInSeconds: 300, timeoutMs: 240_000 },
  "graph-insights": { retryLimit: 0, expireInSeconds: 600, timeoutMs: 540_000, deadLetter: true }, // 3.0: one paid analysis call — never retried behind the user's back
};
