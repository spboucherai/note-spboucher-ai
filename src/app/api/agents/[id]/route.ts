/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/agents/[id]/route.ts
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
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { decideProposals, undoProposals } from "@/lib/agents/apply";
import { AGENT_BY_ID, agentInfo } from "@/lib/agents/definitions";
import { parseMeta, reapStale } from "@/lib/agents/runner";

const E = schema.aiExecutions;
/** GET → one execution: live status, proposals with their before/after previews, and the execution log (tools, documents, approvals, cost). */
export const GET = handler(async ({ ws, params }) => {
  const id = uuid.parse(params.id);
  await reapStale(ws.id);
  const [ex] = await db.select().from(E).where(and(eq(E.id, id), eq(E.workspaceId, ws.id)));
  if (!ex) throw new HttpError(404, "Execution not found");
  const ids = ex.documentsAccessed ?? [];
  const docs = ids.length ? await db.select({ id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon, deletedAt: schema.pages.deletedAt }).from(schema.pages).where(and(eq(schema.pages.workspaceId, ws.id), inArray(schema.pages.id, ids))) : [];
  const a = AGENT_BY_ID[ex.agent]; const pending = ex.status === "pending";
  return Response.json({ ...ex, outcome: pending ? null : ex.outcome, contextPageId: pending ? parseMeta(ex.outcome).pageId ?? null : null, agentName: a?.name ?? ex.agent, agentIcon: a?.icon ?? "🤖", info: a ? agentInfo(a) : null, documents: ids.map((d) => docs.find((x) => x.id === d) ?? { id: d, title: "(page no longer available)", icon: null, deletedAt: null }) });
});
/**
 * POST { action: "approve", changes, confirmDestructive? } | { action: "reject", changes } | { action: "undo", changes } | { action: "cancel" }
 * Approving is the only path by which an agent proposal is written. Trash proposals need `confirmDestructive: true` (409 otherwise).
 */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const changes = z.array(z.number().int().min(0).max(500)).min(1).max(200);
  const b = await parseBody(req, z.discriminatedUnion("action", [z.object({ action: z.literal("approve"), changes, confirmDestructive: z.boolean().optional() }), z.object({ action: z.literal("reject"), changes }), z.object({ action: z.literal("undo"), changes }), z.object({ action: z.literal("cancel") })]));
  if (b.action === "cancel") {
    const [ex] = await db.select({ status: E.status, proposedChanges: E.proposedChanges }).from(E).where(and(eq(E.id, id), eq(E.workspaceId, ws.id)));
    if (!ex) throw new HttpError(404, "Execution not found");
    if (ex.status === "pending" || ex.status === "running") {
      // The runner only writes while the row is `running`: after this update it stops at its next step and nothing of the run survives.
      await db.update(E).set({ status: "failed", error: "Cancelled by the owner. Nothing was changed.", outcome: "cancelled", proposedChanges: [], finishedAt: new Date() }).where(and(eq(E.id, id), inArray(E.status, ["pending", "running"])));
    } else if (ex.status === "awaiting_approval") {
      const at = new Date().toISOString(); const props = ((ex.proposedChanges ?? []) as { idx: number; status: string; decidedAt?: string }[]).map((p) => (p.status === "proposed" ? { ...p, status: "rejected", decidedAt: at } : p));
      const anyApplied = props.some((p) => p.status === "applied" || p.status === "undone");
      await db.update(E).set({ status: anyApplied ? "approved" : "rejected", outcome: "remaining proposals rejected", proposedChanges: props }).where(eq(E.id, id));
    } else throw new HttpError(409, `A ${ex.status} run cannot be cancelled`);
    await audit(user.id, "agent.cancel", { type: "execution", id });
    return Response.json({ ok: true });
  }
  if (b.action === "undo") return Response.json(await undoProposals(ws, user.id, id, b.changes));
  return Response.json(await decideProposals(ws, user.id, id, { approve: b.action === "approve" ? b.changes : [], reject: b.action === "reject" ? b.changes : [], confirmDestructive: b.action === "approve" ? b.confirmDestructive : false }));
});
