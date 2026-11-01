import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { enqueueAi } from "@/lib/databases/service";
/** { rowId, propertyId } | { rowIds: [...], propertyId } — enqueue AI property computation. */
export const POST = handler(async ({ ws, params, req }) => {
  const b = await parseBody(req, z.object({ rowId: uuid.optional(), rowIds: z.array(uuid).max(200).optional(), propertyId: uuid }));
  const ids = b.rowIds ?? (b.rowId ? [b.rowId] : []); for (const id of ids) await enqueueAi(ws.id, params.id, id, b.propertyId);
  return Response.json({ ok: true, queued: ids.length });
});
