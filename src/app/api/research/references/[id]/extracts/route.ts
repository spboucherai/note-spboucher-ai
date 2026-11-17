import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { getReference, addExtract, updateExtract, deleteExtract, restoreExtract } from "@/lib/research/references";
import { extractsOf, EXTRACT_LIMITS } from "@/lib/research/cite";
import { audit } from "@/lib/audit";
/** Quoted extracts of a reference (quote, page, personal note) — stored in references.fields.extracts. Audit: ids and counts only. */
const body = { quote: z.string().min(1).max(EXTRACT_LIMITS.quote), page: z.string().max(EXTRACT_LIMITS.page).nullable().optional(), note: z.string().max(EXTRACT_LIMITS.note).nullable().optional() };
export const GET = handler(async ({ ws, params }) => Response.json(extractsOf((await getReference(ws.id, uuid.parse(params.id))).fields)));
/** POST { id?, quote, page?, note? } — `id` chosen by the client makes a retry harmless. POST ?restore=1 { extract } puts a deleted extract back (Undo). */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id);
  if (new URL(req.url).searchParams.get("restore") === "1") {
    const b = await parseBody(req, z.object({ extract: z.object({ id: uuid, ...body, createdAt: z.string().max(40), updatedAt: z.string().max(40).optional() }) }));
    const r = await restoreExtract(ws.id, id, { ...b.extract, page: b.extract.page ?? null, note: b.extract.note ?? null });
    await audit(user.id, "reference.extract.restore", { type: "reference", id }, { extractId: r.extract.id }); return Response.json({ extract: r.extract, extracts: extractsOf(r.reference.fields) });
  }
  const b = await parseBody(req, z.object({ id: uuid.optional(), ...body }));
  const r = await addExtract(ws.id, id, b);
  await audit(user.id, "reference.extract.add", { type: "reference", id }, { extractId: r.extract.id, count: extractsOf(r.reference.fields).length });
  return Response.json({ extract: r.extract, extracts: extractsOf(r.reference.fields) }, { status: 201 });
});
/** PATCH { id, quote?, page?, note? } */
export const PATCH = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const b = await parseBody(req, z.object({ id: uuid, quote: body.quote.optional(), page: body.page, note: body.note }));
  const r = await updateExtract(ws.id, id, b.id, b);
  await audit(user.id, "reference.extract.update", { type: "reference", id }, { extractId: b.id }); return Response.json({ extract: r.extract, extracts: extractsOf(r.reference.fields) });
});
/** DELETE ?extractId= → { extract } (the removed extract, so the client can offer Undo) */
export const DELETE = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const x = uuid.safeParse(new URL(req.url).searchParams.get("extractId")); if (!x.success) throw new HttpError(400, "extractId required");
  const r = await deleteExtract(ws.id, id, x.data);
  if (r.extract) await audit(user.id, "reference.extract.delete", { type: "reference", id }, { extractId: x.data });
  return Response.json({ extract: r.extract, extracts: extractsOf(r.reference.fields) });
});
