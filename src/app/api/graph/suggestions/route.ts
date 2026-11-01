import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { listSuggestions, suggestionCounts, decideSuggestion } from "@/lib/graph/service";
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

/** PATCH { id, status: "accepted" | "rejected" } */
export const PATCH = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ id: uuid, status: z.enum(["accepted", "rejected"]) }));
  const k = await decideSuggestion(ws.id, b.id, b.status);
  await audit(user.id, `graph.suggestion.${b.status}`, { type: "knowledge_edge", id: b.id }, { from: k.fromId, to: k.toId });
  return Response.json({ ok: true, id: k.id, status: k.status, fromId: k.fromId, toId: k.toId });
});
