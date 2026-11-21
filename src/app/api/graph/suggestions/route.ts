/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/graph/suggestions/route.ts
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
import { handler, parseBody, uuid } from "@/lib/api";
import { listSuggestions, suggestionCounts, decideSuggestion, revertSuggestion } from "@/lib/graph/service";
import { suggestLinksForPage } from "@/lib/graph/suggest";
import { enqueue, QUEUES } from "@/lib/jobs";
import { audit } from "@/lib/audit";

/** GET ?status=suggested|accepted|rejected&pageId= */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams;
  const status = (["suggested", "accepted", "rejected"] as const).find((s) => s === u.get("status")) ?? "suggested";
  const pid = uuid.safeParse(u.get("pageId"));
  const [items, counts] = await Promise.all([listSuggestions(ws.id, status, { pageId: pid.success ? pid.data : null }), suggestionCounts(ws.id)]);
  return Response.json({ items, counts }, { headers: { "cache-control": "private, no-store" } });
});

/** POST { action: "suggest", pageId?, inline? } — enqueue the suggest-links job (inline=true runs one page synchronously and returns the result). */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ action: z.literal("suggest"), pageId: uuid.nullable().optional(), inline: z.boolean().optional() }));
  if (b.inline && b.pageId) {
    const r = await suggestLinksForPage(ws.id, b.pageId, { k: 8 });
    await audit(user.id, "graph.suggest", { type: "page", id: b.pageId }, { inline: true, suggested: r.suggested, candidates: r.candidates });
    return Response.json({ queued: false, result: r });
  }
  const jobId = await enqueue(QUEUES.suggestLinks, { workspaceId: ws.id, pageId: b.pageId ?? null }, b.pageId ? { singletonKey: `suggest:${b.pageId}`, singletonSeconds: 30 } : { singletonKey: `suggest:ws:${ws.id}`, singletonSeconds: 300 });
  await audit(user.id, "graph.suggest", b.pageId ? { type: "page", id: b.pageId } : { type: "workspace", id: ws.id }, { jobId });
  return Response.json({ queued: true, jobId });
});

/** PATCH { id, status: "accepted" | "rejected" | "suggested" } — "suggested" undoes a decision (back to the review queue). */
export const PATCH = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ id: uuid, status: z.enum(["accepted", "rejected", "suggested"]) }));
  if (b.status === "suggested") {
    const k = await revertSuggestion(ws.id, b.id);
    await audit(user.id, "graph.suggestion.reverted", { type: "knowledge_edge", id: b.id }, { from: k.fromId, to: k.toId, previous: k.previousStatus });
    return Response.json({ ok: true, id: k.id, status: k.status, fromId: k.fromId, toId: k.toId });
  }
  const k = await decideSuggestion(ws.id, b.id, b.status);
  await audit(user.id, `graph.suggestion.${b.status}`, { type: "knowledge_edge", id: b.id }, { from: k.fromId, to: k.toId });
  return Response.json({ ok: true, id: k.id, status: k.status, fromId: k.fromId, toId: k.toId });
});
