import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { db, schema } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { decideProposals } from "@/lib/agents/apply";
import { AGENT_BY_ID } from "@/lib/agents/definitions";
import { parseMeta } from "@/lib/agents/runner";

/** GET → execution detail (live status, tool timeline, documents accessed with titles, proposals, approvals). */
export const GET = handler(async ({ ws, params }) => {
  const id = uuid.parse(params.id);
  const [ex] = await db.select().from(schema.aiExecutions).where(and(eq(schema.aiExecutions.id, id), eq(schema.aiExecutions.workspaceId, ws.id)));
  if (!ex) return Response.json({ error: "Not found" }, { status: 404 });
  const ids = ex.documentsAccessed ?? [];
  const docs = ids.length ? await db.select({ id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, section: schema.pages.section, deletedAt: schema.pages.deletedAt }).from(schema.pages).where(inArray(schema.pages.id, ids)) : [];
  const a = AGENT_BY_ID[ex.agent];
  return Response.json({ ...ex, outcome: ex.status === "pending" ? null : ex.outcome, contextPageId: parseMeta(ex.status === "pending" ? ex.outcome : null).pageId ?? null, agentName: a?.name ?? ex.agent, agentIcon: a?.icon ?? "🤖", documents: ids.map((d) => docs.find((x) => x.id === d) ?? { id: d, title: "(unknown page)", icon: null, section: null, deletedAt: null }) });
});
/** POST { action: "approve" | "reject", changes: number[] } | { action: "cancel" } */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id);
  const b = await parseBody(req, z.discriminatedUnion("action", [z.object({ action: z.literal("approve"), changes: z.array(z.number().int().min(0)).min(1) }), z.object({ action: z.literal("reject"), changes: z.array(z.number().int().min(0)).min(1) }), z.object({ action: z.literal("cancel") })]));
  if (b.action === "cancel") {
    const [ex] = await db.select({ status: schema.aiExecutions.status, proposedChanges: schema.aiExecutions.proposedChanges }).from(schema.aiExecutions).where(and(eq(schema.aiExecutions.id, id), eq(schema.aiExecutions.workspaceId, ws.id)));
    if (!ex) return Response.json({ error: "Not found" }, { status: 404 });
    if (["pending", "running"].includes(ex.status)) { await db.update(schema.aiExecutions).set({ status: "failed", error: "Cancelled by the owner", outcome: "cancelled", finishedAt: new Date() }).where(eq(schema.aiExecutions.id, id)); }
    else if (ex.status === "awaiting_approval") { const at = new Date().toISOString(); const props = ((ex.proposedChanges ?? []) as any[]).map((p) => (p.status === "proposed" ? { ...p, status: "rejected", decidedAt: at } : p)); await db.update(schema.aiExecutions).set({ status: "rejected", outcome: "all proposals rejected (cancelled)", proposedChanges: props, approvals: props.filter((p) => p.decidedAt === at).map((p) => ({ change: p.idx, approved: false, at })) }).where(eq(schema.aiExecutions.id, id)); }
    else return Response.json({ error: `Cannot cancel a ${ex.status} execution` }, { status: 409 });
    await audit(user.id, "agent.cancel", { type: "execution", id });
    return Response.json({ ok: true });
  }
  const r = await decideProposals(ws, user.id, id, { approve: b.action === "approve" ? b.changes : [], reject: b.action === "reject" ? b.changes : [] });
  return Response.json(r);
});
