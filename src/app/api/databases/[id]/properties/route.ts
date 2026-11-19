import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { createProperty, updateProperty, deleteProperty, reorderProperties, ensureDatabase } from "@/lib/databases/service";
import { PROPERTY_TYPES } from "@/lib/databases/types";
import { audit } from "@/lib/audit";
const type = z.enum(PROPERTY_TYPES); const config = z.record(z.string(), z.unknown());
export const POST = handler(async ({ ws, params, req, user }) => {
  const b = await parseBody(req, z.object({ id: uuid.optional(), name: z.string().max(200), type, config: config.optional(), width: z.number().int().min(40).max(2000).nullable().optional(), position: z.number().optional() }));
  const p = await createProperty(ws.id, params.id, b as any); await audit(user.id, "database.property.create", { type: "property", id: p.id }, { name: p.name, type: p.type });
  return Response.json(p, { status: 201 });
});
/** { id, ...patch } or { order: [ids] } */
export const PATCH = handler(async ({ ws, params, req }) => {
  const b = await parseBody(req, z.object({ id: uuid.optional(), name: z.string().max(200).optional(), type: type.optional(), config: config.optional(), width: z.number().int().min(40).max(2000).nullable().optional(), position: z.number().optional(), order: z.array(uuid).optional() }));
  if (b.order) { await reorderProperties(ws.id, params.id, b.order); return Response.json({ ok: true }); }
  if (!b.id) throw new HttpError(400, "id required"); const { id, order: _o, ...patch } = b;
  return Response.json(await updateProperty(ws.id, params.id, id, patch as any));
});
export const DELETE = handler(async ({ ws, params, req, user }) => {
  const id = uuid.parse(new URL(req.url).searchParams.get("id")); const d = await ensureDatabase(ws.id, params.id);
  await deleteProperty(ws.id, d.id, id); await audit(user.id, "database.property.delete", { type: "property", id }); return Response.json({ ok: true });
});
