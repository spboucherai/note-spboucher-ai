/**
 * File: src/app/api/databases/[id]/rows/bulk/route.ts
 * Description: POST — one action on many rows, journaled for undo.
 *   Body: { action: "update", values: {propertyId: value | null} } | { action: "delete" } | { action: "duplicate" }
 *         + the selection: { ids: [...] }  or  { all: { viewId?, filter?, extraFilter?, search?, except?: [...] } } (every row of that query).
 *   Answer: { ok, action, affected, opId, rows? } — `opId` feeds `POST rows/undo`. Limits: update 50 000 rows, delete 5 000, duplicate 200.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { filterInput } from "@/lib/databases/filter-input";
import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { bulkRows } from "@/lib/databases/rows";
import { validateFilter } from "@/lib/databases/engine";
import { getDatabase } from "@/lib/databases/service";
import { autoRunForRow } from "@/lib/ai/properties";
import { audit } from "@/lib/audit";
export const POST = handler(async ({ ws, params, req, user }) => {
  const b = await parseBody(req, z.object({
    action: z.enum(["update", "delete", "duplicate"]), values: z.record(z.string(), z.unknown()).optional(), ids: z.array(uuid).max(50_000).optional(),
    all: z.object({ viewId: uuid.optional(), filter: filterInput("all.filter").optional(), extraFilter: filterInput("all.extraFilter").optional(), search: z.string().max(200).optional(), except: z.array(uuid).max(5000).optional() }).optional(),
  }));
  if (!b.ids === !b.all) throw new HttpError(400, "Send either `ids` or `all`", "bad_request");
  if (b.all && (b.all.filter !== undefined || b.all.extraFilter !== undefined)) { const d = await getDatabase(ws.id, params.id); validateFilter(b.all.filter, d.properties); validateFilter(b.all.extraFilter, d.properties, "extraFilter"); }
  if (b.action === "update" && !b.values) throw new HttpError(400, "values required", "bad_request");
  const r = await bulkRows(ws.id, params.id, { ids: b.ids, all: b.all }, b.action === "update" ? { type: "update", values: b.values! } : { type: b.action });
  // AI properties with auto-run follow a bulk edit only for small batches (≤ 25 rows): a 20 000-row edit must never start 20 000 paid runs
  if (b.action === "update" && b.ids && b.ids.length <= 25) for (const id of b.ids) await autoRunForRow(ws.id, params.id, id, Object.keys(b.values!));
  await audit(user.id, `database.row.bulk_${b.action}`, { type: "database", id: params.id }, { count: r.affected });
  return Response.json(r);
});
