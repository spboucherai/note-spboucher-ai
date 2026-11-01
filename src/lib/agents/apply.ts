/** Approval step (API context): applies approved proposals through the pages service, records every decision in `approvals`. */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getPage, updatePage } from "@/lib/pages/service";
import { markdownToDoc } from "@/lib/editor/markdown-client";
import { HttpError } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import type { PMNode } from "@/lib/editor/text";
import type { Proposal } from "./types";

export async function decideProposals(ws: { id: string }, userId: string, executionId: string, decision: { approve: number[]; reject: number[] }) {
  const [ex] = await db.select().from(schema.aiExecutions).where(and(eq(schema.aiExecutions.id, executionId), eq(schema.aiExecutions.workspaceId, ws.id)));
  if (!ex) throw new HttpError(404, "Execution not found");
  if (ex.status !== "awaiting_approval") throw new HttpError(409, `Execution is ${ex.status}, nothing to approve`);
  const proposals = (ex.proposedChanges ?? []) as Proposal[]; const approvals = [...(ex.approvals ?? [])];
  const at = new Date().toISOString(); const applied: number[] = []; const failed: { idx: number; error: string }[] = [];
  const touch = (idx: number) => proposals[idx] && proposals[idx].status === "proposed";
  for (const idx of decision.reject) { if (!touch(idx)) continue; proposals[idx].status = "rejected"; proposals[idx].decidedAt = at; approvals.push({ change: idx, approved: false, at }); await audit(userId, "agent.proposal_reject", { type: "execution", id: executionId }, { change: idx, kind: proposals[idx].kind }); }
  for (const idx of decision.approve) {
    if (!touch(idx)) continue; const p = proposals[idx]; p.status = "approved"; p.decidedAt = at; approvals.push({ change: idx, approved: true, at });
    try { p.result = await applyOne(ws.id, ex.model, p); p.status = "applied"; p.appliedAt = new Date().toISOString(); applied.push(idx); await audit(userId, "agent.proposal_apply", { type: "execution", id: executionId }, { change: idx, kind: p.kind, result: p.result as any }); }
    catch (e: any) { p.status = "failed"; p.error = String(e?.message ?? e).slice(0, 300); failed.push({ idx, error: p.error }); await audit(userId, "agent.proposal_fail", { type: "execution", id: executionId }, { change: idx, error: p.error }); }
  }
  const pending = proposals.filter((p) => p.status === "proposed").length;
  const anyApplied = proposals.some((p) => p.status === "applied");
  const status = pending ? "awaiting_approval" : anyApplied ? "approved" : "rejected";
  const outcome = pending ? `${proposals.length - pending}/${proposals.length} decided · ${pending} pending` : `${proposals.filter((p) => p.status === "applied").length} applied · ${proposals.filter((p) => p.status === "rejected").length} rejected${failed.length ? ` · ${failed.length} failed` : ""}`;
  await db.update(schema.aiExecutions).set({ proposedChanges: proposals as any, approvals, status, outcome }).where(eq(schema.aiExecutions.id, executionId));
  return { status, applied, failed, pending };
}

async function applyOne(wsId: string, model: string | null, p: Proposal): Promise<unknown> {
  switch (p.kind) {
    case "page_edit": {
      const page = await getPage(wsId, p.payload.pageId);
      const blocks = markdownToDoc(p.payload.markdown);
      const content: PMNode = p.payload.mode === "append" ? { type: "doc", content: [...(((page.content as PMNode).content ?? []).filter((n, i, a) => !(a.length === 1 && n.type === "paragraph" && !n.content))), ...blocks] } : { type: "doc", content: blocks };
      const r = await updatePage(wsId, page.id, { content }, { versionReason: `agent ${p.payload.mode}` });
      return { pageId: r.id, version: r.version };
    }
    case "task": {
      const [t] = await db.insert(schema.tasks).values({ workspaceId: wsId, pageId: p.payload.pageId, title: p.payload.title, priority: p.payload.priority, dueAt: p.payload.dueAt ? new Date(p.payload.dueAt) : null, project: p.payload.project, status: "todo" }).returning({ id: schema.tasks.id });
      return { taskId: t.id };
    }
    case "link": {
      await getPage(wsId, p.payload.fromPageId); await getPage(wsId, p.payload.toPageId);
      await db.insert(schema.links).values({ fromPageId: p.payload.fromPageId, toPageId: p.payload.toPageId, kind: "ai_suggested" }).onConflictDoNothing();
      const [e] = await db.insert(schema.knowledgeEdges).values({ workspaceId: wsId, fromId: p.payload.fromPageId, toId: p.payload.toPageId, kind: "ai_suggested", status: "accepted", confidence: p.payload.confidence, rationale: `${p.payload.relation}: ${p.rationale}`.slice(0, 1000), model, decidedAt: new Date() }).onConflictDoUpdate({ target: [schema.knowledgeEdges.fromId, schema.knowledgeEdges.toId, schema.knowledgeEdges.kind], set: { status: "accepted", decidedAt: new Date(), confidence: p.payload.confidence, model } }).returning({ id: schema.knowledgeEdges.id });
      return { edgeId: e?.id ?? null };
    }
    case "property": {
      const page = await getPage(wsId, p.payload.pageId);
      await updatePage(wsId, page.id, { properties: { ...(page.properties as Record<string, unknown>), [p.payload.key]: p.payload.value } });
      return { pageId: page.id, key: p.payload.key };
    }
  }
}
