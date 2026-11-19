import { z } from "zod";
import { handler, parseBody, optUuid, uuid, HttpError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createConcept, getConcept, listConcepts, updateConcept } from "@/lib/graph/concepts";
import { conceptCreate, conceptPatch } from "@/lib/graph/schema";

/** GET /api/concepts?status=accepted|suggested|rejected|all&pageId= → `{concepts: [...]}` by name, with page counts. */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams; const status = u.get("status");
  if (status && !["accepted", "suggested", "rejected", "all"].includes(status)) throw new HttpError(400, "Unknown status", "bad_request");
  return Response.json({ concepts: await listConcepts(ws.id, { status, pageId: optUuid(u.get("pageId")) }) });
});
/** POST { id?, name, description?, pageIds? } → 201 concept. Client `id` → idempotent (200 + `x-existing: 1`); same name → 409 `concept_exists`. */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, conceptCreate);
  const { concept, existing } = await createConcept(ws.id, b, { origin: "user" });
  if (!existing) await audit(user.id, "concept.create", { type: "concept", id: concept.id }, { name: concept.name });
  return Response.json(await getConcept(ws.id, concept.id), { status: existing ? 200 : 201, headers: existing ? { "x-existing": "1" } : {} });
});
/** PATCH { id, … } — same body as PATCH /api/concepts/<id>, with the id in the body. */
export const PATCH = handler(async ({ req, ws, user }) => {
  const { id, ...patch } = await parseBody(req, conceptPatch.extend({ id: uuid }));
  const c = await updateConcept(ws.id, id, patch); await audit(user.id, "concept.update", { type: "concept", id }); return Response.json(c);
});
