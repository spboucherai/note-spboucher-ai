import { handler, parseBody, optUuid, HttpError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createRelation, listRelations, REL_TYPES } from "@/lib/graph/relations";
import { relationCreate, toDate } from "@/lib/graph/schema";

/** GET /api/graph/relations?nodeId=&status=&relType=&origin=&include=cites,ai_suggested → typed relations (newest first, ≤ 500). */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams; const status = u.get("status"); const relType = u.get("relType"); const origin = u.get("origin");
  if (status && !["accepted", "rejected", "suggested"].includes(status)) throw new HttpError(400, "Unknown status", "bad_request");
  if (relType && !(REL_TYPES as readonly string[]).includes(relType)) throw new HttpError(400, "Unknown relType", "bad_request");
  if (origin && !["user", "ai", "system"].includes(origin)) throw new HttpError(400, "Unknown origin", "bad_request");
  const include = (u.get("include") ?? "").split(",").map((s) => s.trim()).filter((s) => s === "cites" || s === "ai_suggested" || s === "link");
  return Response.json({ relations: await listRelations(ws.id, { nodeId: optUuid(u.get("nodeId")), status, relType, origin, kinds: ["relation", ...include] }) });
});
/** POST → 201 relation (origin `user`, accepted). Client-chosen `id` → idempotent (200 + `x-existing: 1`). Same (from, to, relType) → 409 `relation_exists`. */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, relationCreate);
  const { relation, existing } = await createRelation(ws.id, { ...b, validFrom: toDate(b.validFrom), validTo: toDate(b.validTo) }, { origin: "user" });
  if (existing) return Response.json(relation, { status: 200, headers: { "x-existing": "1" } });
  await audit(user.id, "graph.relation.create", { type: "edge", id: relation.id }, { relType: relation.relType });
  return Response.json(relation, { status: 201 });
});
