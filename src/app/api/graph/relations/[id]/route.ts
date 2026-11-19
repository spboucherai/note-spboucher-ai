import { handler, parseBody, uuid } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteRelation, getRelation, updateRelation } from "@/lib/graph/relations";
import { relationPatch, toDate } from "@/lib/graph/schema";

export const GET = handler(async ({ ws, params }) => Response.json(await getRelation(ws.id, uuid.parse(params.id))));
/** PATCH { status?: accepted|rejected|suggested, relType?, note?, validFrom?, validTo? } → relation. Accept / reject set `decidedAt`. */
export const PATCH = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const b = await parseBody(req, relationPatch);
  const r = await updateRelation(ws.id, id, { ...b, validFrom: toDate(b.validFrom), validTo: toDate(b.validTo) });
  await audit(user.id, b.status ? `graph.relation.${b.status}` : "graph.relation.update", { type: "edge", id });
  return Response.json(r);
});
/** DELETE → `{ok:true}`, idempotent (an unknown or already deleted id answers the same 200). Only relations (kind `relation`); a document link or a citation → 409 `derived_edge`. */
export const DELETE = handler(async ({ ws, params, user }) => {
  const id = uuid.parse(params.id);
  if (await deleteRelation(ws.id, id)) await audit(user.id, "graph.relation.delete", { type: "edge", id });
  return Response.json({ ok: true });
});
