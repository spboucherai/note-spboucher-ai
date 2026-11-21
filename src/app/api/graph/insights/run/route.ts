/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/graph/insights/run/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
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

import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { audit } from "@/lib/audit";
import { enqueue, QUEUES } from "@/lib/jobs";
import { refreshDeterministicInsights } from "@/lib/graph/insights";
/**
 * POST /api/graph/insights/run { mode?: "all" | "deterministic" | "ai", pageIds?: uuid[≤40], limit?: 2..40 }
 * - deterministic part (clusters, recurring topics, duplicates): done in the request, no model → `deterministic: {created, considered}`;
 * - AI part (contradictions, open questions, concept suggestions): one job on the queue `graph-insights` (singleton per workspace for
 *   5 minutes, never retried automatically) → `queued`, `jobId`. `queued: false` with `reason` when the queue refused it (a run is
 *   already pending, or the queue is unreachable). Results appear in GET /api/graph/insights as `suggested`.
 */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ mode: z.enum(["all", "deterministic", "ai"]).optional(), pageIds: z.array(uuid).max(40).optional(), limit: z.number().int().min(2).max(40).optional() }).default({}));
  const mode = b.mode ?? "all";
  const deterministic = mode === "ai" ? null : await refreshDeterministicInsights(ws.id);
  let jobId: string | null = null;
  if (mode !== "deterministic") jobId = await enqueue(QUEUES.graphInsights, { workspaceId: ws.id, pageIds: b.pageIds, limit: b.limit }, { singletonKey: `graph-insights:${ws.id}`, singletonSeconds: 300 });
  await audit(user.id, "graph.insights.run", undefined, { mode, queued: Boolean(jobId) });
  return Response.json({ mode, deterministic, queued: Boolean(jobId), jobId, ...(mode !== "deterministic" && !jobId ? { reason: "already_queued_or_queue_unavailable" } : {}) }, { status: jobId ? 202 : 200 });
});
