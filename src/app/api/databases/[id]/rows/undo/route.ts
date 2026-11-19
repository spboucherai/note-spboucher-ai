/**
 * File: src/app/api/databases/[id]/rows/undo/route.ts
 * Description: POST { opId, redo? } — revert (or re-apply) a bulk action journaled by `rows/bulk`. Answer { ok, kind, affected, undone }.
 *   404 when the journal entry is gone (kept 7 days), 409 when it is already in the requested state.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { undoOp } from "@/lib/databases/rows";
import { audit } from "@/lib/audit";
export const POST = handler(async ({ ws, params, req, user }) => {
  const b = await parseBody(req, z.object({ opId: uuid, redo: z.boolean().optional() }));
  const r = await undoOp(ws.id, params.id, b.opId, !!b.redo);
  await audit(user.id, b.redo ? "database.row.redo" : "database.row.undo", { type: "database", id: params.id }, { kind: r.kind, count: r.affected });
  return Response.json(r);
});
