/**
 * Approval step (API context). The ONLY place where an agent proposal becomes a write.
 *  - Each proposal is applied individually, only when the owner approved that index; destructive ones (trash) additionally require
 *    `confirmDestructive` (the UI's second confirmation).
 *  - Before a page is touched, its current state is saved in the page history (`snapshot` / `versionReason`), and what is needed to
 *    reverse the change is stored on the proposal (`undo`), so every applied proposal has an Undo.
 *  - Every decision is appended to `approvals` and to the audit log (ids and kinds only).
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createPage, getPage, updatePage, snapshot, softDeletePage } from "@/lib/pages/service";
import { pageTags, setPageTags, triage, undoTriage } from "@/lib/inbox/service";
import { markdownToDoc } from "@/lib/editor/markdown-client";
import { assertDoc } from "@/lib/editor/validate";
import { HttpError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import type { PMNode } from "@/lib/editor/text";
import type { Proposal } from "./types";
import { withActor } from "@/lib/events/context";
import { recordEvent } from "@/lib/events/service";

const E = schema.aiExecutions;
const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);
async function load(wsId: string, executionId: string) {
  const [ex] = await db.select().from(E).where(and(eq(E.id, executionId), eq(E.workspaceId, wsId)));
  if (!ex) throw new HttpError(404, "Execution not found");
  return ex;
}
function summarise(proposals: Proposal[]) {
  const n = (s: Proposal["status"]) => proposals.filter((p) => p.status === s).length; const pending = n("proposed");
  const status = pending ? "awaiting_approval" : n("applied") || n("undone") ? "approved" : "rejected";
  const parts = [`${n("applied")} applied`, `${n("rejected")} rejected`]; if (n("undone")) parts.push(`${n("undone")} undone`); if (n("failed")) parts.push(`${n("failed")} failed`); if (pending) parts.push(`${pending} to review`);
  return { status, outcome: parts.join(" · "), pending };
}

export async function decideProposals(ws: { id: string }, userId: string, executionId: string, decision: { approve: number[]; reject: number[]; confirmDestructive?: boolean }) {
  const ex = await load(ws.id, executionId);
  if (ex.status !== "awaiting_approval") throw new HttpError(409, `This run is ${ex.status.replace("_", " ")}: there is nothing to decide`, "not_awaiting");
  const proposals = (ex.proposedChanges ?? []) as Proposal[]; const approvals = [...(ex.approvals ?? [])];
  const open = (idx: number) => proposals[idx]?.status === "proposed";
  const destructive = decision.approve.filter((i) => open(i) && proposals[i].destructive);
  if (destructive.length && !decision.confirmDestructive) throw new HttpError(409, `${destructive.length} of these changes move${destructive.length === 1 ? "s a page" : " pages"} to the trash and need a second confirmation`, "confirm_destructive", { changes: destructive });
  const at = new Date().toISOString(); const applied: number[] = []; const failed: { idx: number; error: string }[] = [];
  for (const idx of new Set(decision.reject)) {
    if (!open(idx)) continue; const p = proposals[idx]; p.status = "rejected"; p.decidedAt = at; approvals.push({ change: idx, approved: false, at });
    await audit(userId, "agent.proposal_reject", { type: "execution", id: executionId }, { change: idx, kind: p.kind });
  }
  for (const idx of new Set(decision.approve)) {
    if (!open(idx)) continue; const p = proposals[idx]; p.decidedAt = at; approvals.push({ change: idx, approved: true, at });
    try {
      // journal: what the proposal writes is stamped `agent`, and the approval itself is one `agent.applied` event
      const r = await withActor({ actor: "agent" }, () => applyOne(ws.id, executionId, p)); p.result = r.result; p.undo = r.undo; p.status = "applied"; p.appliedAt = new Date().toISOString(); applied.push(idx);
      await recordEvent(db, { workspaceId: ws.id, kind: "agent.applied", actor: "agent", pageId: typeof r.result.pageId === "string" ? r.result.pageId : null, entityKind: "execution", entityId: executionId, summary: `${ex.agent} · ${p.kind}`, data: { executionId, agent: ex.agent, change: idx, kind: p.kind, model: ex.model, ...r.result } });
      await audit(userId, "agent.proposal_apply", { type: "execution", id: executionId }, { change: idx, kind: p.kind, destructive: p.destructive, ...r.result });
    } catch (e) { p.status = "failed"; p.error = errText(e); failed.push({ idx, error: p.error }); await audit(userId, "agent.proposal_fail", { type: "execution", id: executionId }, { change: idx, kind: p.kind }); }
    // Persist after every change: a crash mid-batch never leaves an applied change recorded as "proposed" (it could be applied twice).
    await db.update(E).set({ proposedChanges: proposals as never, approvals }).where(eq(E.id, executionId));
  }
  const s = summarise(proposals);
  await db.update(E).set({ proposedChanges: proposals as never, approvals, status: s.status, outcome: s.outcome }).where(eq(E.id, executionId));
  return { status: s.status, applied, failed, pending: s.pending };
}

export async function undoProposals(ws: { id: string }, userId: string, executionId: string, changes: number[]) {
  const ex = await load(ws.id, executionId);
  const proposals = (ex.proposedChanges ?? []) as Proposal[]; const undone: number[] = []; const failed: { idx: number; error: string }[] = [];
  for (const idx of new Set(changes)) {
    const p = proposals[idx]; if (!p || p.status !== "applied") continue;
    try { await undoOne(ws.id, p); p.status = "undone"; p.undoneAt = new Date().toISOString(); undone.push(idx); await audit(userId, "agent.proposal_undo", { type: "execution", id: executionId }, { change: idx, kind: p.kind }); }
    catch (e) { failed.push({ idx, error: errText(e) }); }
    await db.update(E).set({ proposedChanges: proposals as never }).where(eq(E.id, executionId));
  }
  const s = summarise(proposals);
  await db.update(E).set({ proposedChanges: proposals as never, status: s.status, outcome: s.outcome }).where(eq(E.id, executionId));
  return { status: s.status, undone, failed };
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
async function applyOne(wsId: string, executionId: string, p: Proposal): Promise<{ result: Record<string, unknown>; undo: Record<string, unknown> }> {
  switch (p.kind) {
    case "tags": {
      const page = await getPage(wsId, p.payload.pageId); await snapshot(page, "before agent tags");
      const prevTags = await pageTags(page.id); await setPageTags(wsId, page.id, union(prevTags, p.payload.add));
      return { result: { pageId: page.id, tagsAdded: p.payload.add.length }, undo: { pageId: page.id, prevTags } };
    }
    case "inbox_triage": {
      const page = await getPage(wsId, p.payload.pageId);
      if (!page.inboxAt) throw new HttpError(409, "This item is no longer in the inbox");
      await snapshot(page, "before agent triage");
      const prevTags = await pageTags(page.id); if (p.payload.tags.length) await setPageTags(wsId, page.id, union(prevTags, p.payload.tags));
      try {
        const r = await triage(wsId, page.id, p.payload.action === "keep" ? { action: "keep", section: p.payload.section ?? "notes" } : { action: p.payload.action });
        return { result: { pageId: page.id, action: p.payload.action }, undo: { pageId: page.id, actionId: r.actionId, prevTags } };
      } catch (e) { if (p.payload.tags.length) await setPageTags(wsId, page.id, prevTags).catch(() => {}); throw e; }
    }
    case "new_page": {
      const parent = p.payload.parentId ? await getPage(wsId, p.payload.parentId).catch(() => null) : null;
      const content: PMNode = { type: "doc", content: markdownToDoc(p.payload.markdown) }; assertDoc(content);
      const page = await createPage(wsId, { title: p.payload.title, parentId: parent?.id ?? null, section: parent?.section ?? "notes", content, properties: { ai_generated: true, agent_execution: executionId } });
      return { result: { pageId: page.id }, undo: { pageId: page.id } };
    }
    case "page_edit": {
      const page = await getPage(wsId, p.payload.pageId);
      const existing = ((page.content as PMNode).content ?? []).filter((n, _i, a) => !(a.length === 1 && n.type === "paragraph" && !n.content));
      const content: PMNode = { type: "doc", content: [...existing, ...markdownToDoc(p.payload.markdown)] }; assertDoc(content);
      // versionReason forces a history entry holding the page exactly as it was before the agent's addition.
      const r = await updatePage(wsId, page.id, { content }, { baseVersion: page.version, versionReason: "before agent addition" });
      return { result: { pageId: r.id, version: r.version }, undo: { pageId: r.id, restoreVersion: page.version, appliedVersion: r.version } };
    }
    case "task": {
      const [t] = await db.insert(schema.tasks).values({ workspaceId: wsId, pageId: p.payload.pageId, title: p.payload.title, priority: p.payload.priority, dueAt: p.payload.dueAt ? new Date(p.payload.dueAt) : null, status: "todo" }).returning({ id: schema.tasks.id });
      await recordEvent(db, { workspaceId: wsId, kind: "task.created", pageId: p.payload.pageId ?? null, entityKind: "task", entityId: t.id, summary: p.payload.title, data: { via: "agent" } });
      return { result: { taskId: t.id }, undo: { taskId: t.id } };
    }
    default: throw new HttpError(400, "This kind of proposal is no longer supported");
  }
}
async function undoOne(wsId: string, p: Proposal): Promise<void> {
  const u = (p.undo ?? {}) as { pageId?: string; prevTags?: string[]; actionId?: string; taskId?: string; restoreVersion?: number; appliedVersion?: number };
  switch (p.kind) {
    case "tags": if (!u.pageId) break; await setPageTags(wsId, u.pageId, u.prevTags ?? []); return;
    case "inbox_triage": if (!u.pageId || !u.actionId) break; await undoTriage(wsId, u.actionId); await setPageTags(wsId, u.pageId, u.prevTags ?? []); return;
    case "new_page": if (!u.pageId) break; await softDeletePage(wsId, u.pageId); return; // goes to the trash, where it can still be restored
    case "task": if (!u.taskId) break; await db.update(schema.tasks).set({ deletedAt: new Date() }).where(and(eq(schema.tasks.id, u.taskId), eq(schema.tasks.workspaceId, wsId))); return;
    case "page_edit": {
      if (!u.pageId || u.restoreVersion == null || u.appliedVersion == null) break;
      const page = await getPage(wsId, u.pageId);
      if (page.version !== u.appliedVersion) throw new HttpError(409, "The page was edited after this change, so it is not reverted automatically. Open the page history and restore the version saved “before agent addition”.", "changed_since");
      const [snap] = await db.select().from(schema.pageVersions).where(and(eq(schema.pageVersions.pageId, u.pageId), eq(schema.pageVersions.version, u.restoreVersion)));
      if (!snap) throw new HttpError(409, "The saved version is no longer in the page history");
      await updatePage(wsId, u.pageId, { content: snap.content as PMNode }, { baseVersion: u.appliedVersion, versionReason: "undo agent addition" });
      return;
    }
  }
  throw new HttpError(409, "This change has no undo information");
}
