import { handler, parseBody, uuid } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteConcept, getConcept, updateConcept } from "@/lib/graph/concepts";
import { conceptPatch } from "@/lib/graph/schema";

/** GET → concept + `pageLinks` (pages about it, with origin / status / confidence). */
export const GET = handler(async ({ ws, params }) => Response.json(await getConcept(ws.id, uuid.parse(params.id))));
/** PATCH { name?, description?, status?, addPages?, removePages?, pageLinks?: [{pageId, status}] } → concept + pageLinks. */
export const PATCH = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const c = await updateConcept(ws.id, id, await parseBody(req, conceptPatch));
  await audit(user.id, "concept.update", { type: "concept", id }); return Response.json(c);
});
export const DELETE = handler(async ({ ws, params, user }) => {
  const id = uuid.parse(params.id); if (await deleteConcept(ws.id, id)) await audit(user.id, "concept.delete", { type: "concept", id }); /* idempotent: an unknown id answers the same 200 */ return Response.json({ ok: true });
});
