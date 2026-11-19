import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { queueAiProperty } from "@/lib/ai/properties";
/**
 * { rowId, propertyId } | { rowIds: [...], propertyId } — enqueue AI property computation (manual action on one or several cells).
 * NEXT-AI: each cell becomes a row of `ai_property_runs`; a cell edited by hand is skipped unless the property is AI-managed or
 * `force:true` is sent. Historical answer kept (`ok`, `queued`), plus `runs` and `skipped`.
 */
export const POST = handler(async ({ ws, params, req }) => {
  const b = await parseBody(req, z.object({ rowId: uuid.optional(), rowIds: z.array(uuid).max(200).optional(), propertyId: uuid, force: z.boolean().optional() }));
  const ids = b.rowIds ?? (b.rowId ? [b.rowId] : []); const runs = [];
  for (const id of ids) runs.push({ rowId: id, ...(await queueAiProperty(ws.id, params.id, id, b.propertyId, { trigger: "manual", force: b.force })) });
  return Response.json({ ok: true, queued: runs.filter((r) => r.queued).length, runs, skipped: runs.filter((r) => r.skipped).map((r) => ({ rowId: r.rowId, reason: r.skipped, runId: r.runId })) });
});
