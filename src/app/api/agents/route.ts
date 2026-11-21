/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/agents/route.ts
 * Module           : app
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

import { z } from "zod";
import { handler, parseBody, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { enqueue, QUEUES } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { route } from "@/lib/ai/router";
import { providerConfigured } from "@/lib/ai/catalog";
import { budgetStatus, budgetMessage } from "@/lib/ai/usage";
import { AGENTS, AGENT_BY_ID, agentInfo } from "@/lib/agents/definitions";
import { reapStale } from "@/lib/agents/runner";

const E = schema.aiExecutions;
const summary = { id: E.id, agent: E.agent, model: E.model, status: E.status, outcome: E.outcome, error: E.error, costUsd: E.costUsd, tokensIn: E.tokensIn, tokensOut: E.tokensOut, createdAt: E.createdAt, startedAt: E.startedAt, finishedAt: E.finishedAt, proposedChanges: E.proposedChanges, toolsInvoked: E.toolsInvoked };
async function agentRoute() { try { const d = await route({ task: "agent", tools: true }); return { provider: d.provider, model: d.model.id }; } catch { return null; } }

/** GET → the fixed catalogue (scope, caps), where a run would be sent, and the last executions. Calls no provider. */
export const GET = handler(async ({ req, ws }) => {
  await reapStale(ws.id);
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 40) || 40));
  const rows = await db.select(summary).from(E).where(eq(E.workspaceId, ws.id)).orderBy(desc(E.createdAt)).limit(limit);
  const executions = rows.map(({ proposedChanges, toolsInvoked, ...r }) => { const props = (proposedChanges ?? []) as { status?: string }[]; return { ...r, outcome: r.status === "pending" ? null : r.outcome, proposals: props.length, pendingProposals: props.filter((p) => p.status === "proposed").length, toolCalls: ((toolsInvoked ?? []) as { tool: string }[]).filter((s) => s.tool !== "model" && s.tool !== "context_page").length }; });
  const configured = providerConfigured("openai") || providerConfigured("anthropic"); const budget = await budgetStatus();
  return Response.json({ agents: AGENTS.map(agentInfo), configured, target: configured ? await agentRoute() : null, budgetNote: budgetMessage(budget), executions });
});
/**
 * POST { agent, pageId?, confirmCost: true } → creates the execution (pending) and queues it. The task text is fixed by the catalogue.
 * `confirmCost` proves the owner saw the scope and the cost warning. One run at a time per workspace.
 */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ agent: z.string().max(40), pageId: z.string().uuid().nullable().optional(), confirmCost: z.boolean().optional() }));
  const def = AGENT_BY_ID[b.agent]; if (!def) throw new HttpError(400, "Unknown agent task", "unknown_agent");
  if (!(providerConfigured("openai") || providerConfigured("anthropic"))) throw new HttpError(503, "AI is not configured on this server: no provider API key is set.", "not_configured");
  const target = await agentRoute(); if (!target) throw new HttpError(503, "No enabled model supports tool use: agents are not configured.", "not_configured");
  if (!b.confirmCost) throw new HttpError(409, "Confirm the scope and the cost limit before starting", "confirm_required");
  const pageId = def.page === "none" ? null : b.pageId ?? null;
  if (def.page === "required" && !pageId) throw new HttpError(400, "Choose a page for this task", "page_required");
  if (pageId) { const [p] = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.id, pageId), eq(schema.pages.workspaceId, ws.id), isNull(schema.pages.deletedAt))); if (!p) throw new HttpError(404, "Page not found"); }
  await reapStale(ws.id);
  const [live] = await db.select({ id: E.id }).from(E).where(and(eq(E.workspaceId, ws.id), inArray(E.status, ["pending", "running"]))).limit(1);
  if (live) throw new HttpError(409, "Another agent run is in progress. Wait for it to finish or cancel it.", "already_running", { id: live.id });
  const [row] = await db.insert(E).values({ workspaceId: ws.id, agent: def.id, task: def.name, scopes: def.scopes, model: null, status: "pending", outcome: pageId ? JSON.stringify({ pageId }) : null }).returning({ id: E.id, status: E.status });
  const job = await enqueue(QUEUES.agent, { executionId: row.id, workspaceId: ws.id }, { singletonKey: `agent:${row.id}` });
  if (!job) { await db.update(E).set({ status: "failed", error: "The job queue is unreachable: the run was not started and nothing was sent.", outcome: "failed", finishedAt: new Date() }).where(eq(E.id, row.id)); throw new HttpError(503, "The job queue is unreachable: the run was not started.", "queue_unavailable"); }
  await audit(user.id, "agent.run", { type: "execution", id: row.id }, { agent: def.id, pageId });
  return Response.json({ id: row.id, status: row.status }, { status: 201 });
});
