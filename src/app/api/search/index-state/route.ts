import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { indexStats, indexHealth } from "@/lib/search";
import { enqueue, QUEUES } from "@/lib/jobs";
import { audit } from "@/lib/audit";
/** GET → counters + what is pending / failed in the index. */
export const GET = handler(async ({ ws }) => { const [stats, health] = await Promise.all([indexStats(ws.id), indexHealth(ws.id)]); return Response.json({ ...stats, health }); });
/**
 * POST { scope?: "all" | "pending" } → "all" rebuilds the whole index (unchanged content is skipped by hash); "pending" (re)queues only
 * the sources that are not indexed or failed. Jobs are de-duplicated per source (singleton key), so pressing twice does not double the work.
 */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ scope: z.enum(["all", "pending"]).default("all") }).default({ scope: "all" }));
  if (b.scope === "all") { await enqueue(QUEUES.reindexAll, { workspaceId: ws.id }, { singletonKey: `reindex:${ws.id}`, singletonSeconds: 120 }); await audit(user.id, "search.reindex", undefined, { scope: "all" }); return Response.json({ ok: true, queued: 1 }); }
  const h = await indexHealth(ws.id); let n = 0;
  for (const p of h.pending) { await enqueue(QUEUES.index, { sourceType: "page", sourceId: p.id, workspaceId: ws.id }, { singletonKey: `page:${p.id}`, singletonSeconds: 20 }); n++; }
  for (const f of h.failed) if (f.sourceType === "attachment" && f.sourceId) { await enqueue(QUEUES.index, { sourceType: "attachment", sourceId: f.sourceId, workspaceId: ws.id }, { singletonKey: `attachment:${f.sourceId}`, singletonSeconds: 20 }); n++; }
  await audit(user.id, "search.reindex", undefined, { scope: "pending", queued: n });
  return Response.json({ ok: true, queued: n });
});
