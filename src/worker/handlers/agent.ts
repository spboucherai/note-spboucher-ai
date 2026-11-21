/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/worker/handlers/agent.ts
 * Module           : worker
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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
