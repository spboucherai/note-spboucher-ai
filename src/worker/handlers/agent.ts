/** Runs one controlled-agent execution (ai_executions row) — queue `agent-run`, payload { executionId }. */
import { runExecution } from "../../lib/agents/runner";
export async function handleAgentRun(d: { executionId: string }) {
  if (!d?.executionId) return { skipped: "no executionId" };
  return runExecution(d.executionId);
}
