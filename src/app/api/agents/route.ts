import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { db, schema } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { enqueue, QUEUES } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { AGENTS, AGENT_BY_ID } from "@/lib/agents/definitions";
import { TOOLS } from "@/lib/agents/tools";
import { ALL_SCOPES, SCOPE_LABELS, DEFAULT_LIMITS, type Scope } from "@/lib/agents/types";
import { parseMeta } from "@/lib/agents/runner";

const summary = { id: schema.aiExecutions.id, agent: schema.aiExecutions.agent, task: schema.aiExecutions.task, model: schema.aiExecutions.model, status: schema.aiExecutions.status, scopes: schema.aiExecutions.scopes, outcome: schema.aiExecutions.outcome, error: schema.aiExecutions.error, costUsd: schema.aiExecutions.costUsd, tokensIn: schema.aiExecutions.tokensIn, tokensOut: schema.aiExecutions.tokensOut, createdAt: schema.aiExecutions.createdAt, startedAt: schema.aiExecutions.startedAt, finishedAt: schema.aiExecutions.finishedAt, proposedChanges: schema.aiExecutions.proposedChanges, toolsInvoked: schema.aiExecutions.toolsInvoked };

/** GET → agents (definitions) + last executions. */
export const GET = handler(async ({ req, ws }) => {
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get("limit") ?? 60));
  const rows = await db.select(summary).from(schema.aiExecutions).where(eq(schema.aiExecutions.workspaceId, ws.id)).orderBy(desc(schema.aiExecutions.createdAt)).limit(limit);
  const executions = rows.map((r) => ({ ...r, proposals: (r.proposedChanges ?? []).length, pendingProposals: ((r.proposedChanges ?? []) as any[]).filter((p) => p.status === "proposed").length, toolCalls: ((r.toolsInvoked ?? []) as any[]).filter((s) => s.tool !== "model").length, contextPageId: r.status === "pending" ? parseMeta(r.outcome).pageId ?? null : null, proposedChanges: undefined, toolsInvoked: undefined, outcome: r.status === "pending" ? null : r.outcome }));
  return Response.json({ agents: AGENTS.map((a) => ({ id: a.id, name: a.name, icon: a.icon, description: a.description, tools: a.tools.map((t) => ({ name: t, scope: TOOLS[t]?.scope, proposal: TOOLS[t]?.proposal ?? false })), defaultScopes: a.defaultScopes, allowedScopes: a.allowedScopes })), scopes: ALL_SCOPES.map((s) => ({ id: s, label: SCOPE_LABELS[s], write: s.startsWith("write:") })), limits: DEFAULT_LIMITS, executions });
});
/** POST { agent, task, scopes, pageId?, model? } → creates the execution (pending) and enqueues it. */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ agent: z.string(), task: z.string().min(3).max(20_000), scopes: z.array(z.enum(ALL_SCOPES as [Scope, ...Scope[]])).default([]), pageId: z.string().uuid().nullable().optional(), model: z.string().max(100).nullable().optional() }));
  const def = AGENT_BY_ID[b.agent]; if (!def) return Response.json({ error: "Unknown agent" }, { status: 400 });
  const scopes = [...new Set(b.scopes.filter((s) => def.allowedScopes.includes(s)))];
  if (b.pageId) { const [p] = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.id, b.pageId), eq(schema.pages.workspaceId, ws.id))); if (!p) return Response.json({ error: "Context page not found" }, { status: 404 }); }
  const [row] = await db.insert(schema.aiExecutions).values({ workspaceId: ws.id, agent: def.id, task: b.task, scopes, model: b.model ?? null, status: "pending", outcome: b.pageId ? JSON.stringify({ pageId: b.pageId }) : null }).returning();
  const job = await enqueue(QUEUES.agent, { executionId: row.id, workspaceId: ws.id }, { retryLimit: 1, expireInSeconds: 60 * 30 });
  await audit(user.id, "agent.run", { type: "execution", id: row.id }, { agent: def.id, scopes, pageId: b.pageId ?? null, job });
  return Response.json({ ...row, job }, { status: 201 });
});
