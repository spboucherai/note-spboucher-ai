/**
 * File: src/app/api/databases/[id]/rows/duplicate/route.ts
 * Description: POST { id } | { ids: [..≤200] } — duplicate rows (stored values, forward relations, page body, icon, cover). Each copy is
 *   placed right after its source and titled "<title> (copy)". Answer 201: the new row (`id`) or the list of new rows (`ids`).
 *   Bulk duplication with undo goes through `rows/bulk`.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { duplicateRows } from "@/lib/databases/rows";
import { audit } from "@/lib/audit";
export const POST = handler(async ({ ws, params, req, user }) => {
  const b = await parseBody(req, z.object({ id: uuid.optional(), ids: z.array(uuid).min(1).max(200).optional() }));
  if (!b.id && !b.ids) throw new HttpError(400, "id or ids required", "bad_request");
  const rows = await duplicateRows(ws.id, params.id, b.ids ?? [b.id!]);
  if (b.id && !rows.length) throw new HttpError(404, "Row not found", "not_found");
  await audit(user.id, "database.row.duplicate", { type: "database", id: params.id }, { count: rows.length });
  return Response.json(b.ids ? rows : rows[0], { status: 201 });
});
