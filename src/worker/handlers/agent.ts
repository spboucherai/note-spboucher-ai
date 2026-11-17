/**
 * Runs one bounded-agent execution (ai_executions row) — queue `agent-run`, payload { executionId }.
 * Idempotent per execution id: `runExecution` only starts a row it can atomically move `pending → running`; a second delivery of the
 * same job (or a retry after a crash) returns `{ skipped: true }` without calling any model. The run has its own wall-clock timeout
 * (definition `limits.timeoutMs`, well below the queue's); a run that fails or times out ends `failed` with an error and no proposals.
 * The returned summary holds a status and counts only (it is logged).
 */
import { runExecution, reapStale } from "../../lib/agents/runner";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function handleAgentRun(d: { executionId?: string }) {
  if (!d?.executionId || !UUID_RE.test(d.executionId)) return { skipped: true };
  await reapStale().catch(() => 0); // executions abandoned by a previous worker are failed, never re-run
  const r = await runExecution(d.executionId);
  return { failed: r.status === "failed", skipped: Boolean(r.skipped), proposals: r.proposals, toolCalls: r.toolCalls };
}
