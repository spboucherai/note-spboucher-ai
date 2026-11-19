/**
 * File: src/app/api/databases/[id]/row-templates/route.ts
 * Description: row templates of a database (presets for new rows: values + page body).
 *   GET → [template] · POST { id?, name, icon?, values?, content?, fromRowId?, isDefault? } → 201 template (`fromRowId` captures a row)
 *   PATCH { id, name?, icon?, values?, content?, isDefault?, position? } → template · DELETE ?id= → { ok }.
 *   A row is created from a template with `POST rows { templateId, … }`.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { listRowTemplates, createRowTemplate, updateRowTemplate, deleteRowTemplate } from "@/lib/databases/rows";
import { audit } from "@/lib/audit";
const values = z.record(z.string(), z.unknown());
export const GET = handler(async ({ ws, params }) => Response.json(await listRowTemplates(ws.id, params.id)));
export const POST = handler(async ({ ws, params, req, user }) => {
  const b = await parseBody(req, z.object({ id: uuid.optional(), name: z.string().min(1).max(200), icon: z.string().max(16).nullable().optional(), values: values.optional(), content: z.any().optional(), fromRowId: uuid.optional(), isDefault: z.boolean().optional() }));
  const t = await createRowTemplate(ws.id, params.id, b); await audit(user.id, "database.row_template.create", { type: "database", id: params.id }, { name: t.name });
  return Response.json(t, { status: 201 });
});
export const PATCH = handler(async ({ ws, params, req }) => {
  const { id, ...patch } = await parseBody(req, z.object({ id: uuid, name: z.string().min(1).max(200).optional(), icon: z.string().max(16).nullable().optional(), values: values.optional(), content: z.any().optional(), isDefault: z.boolean().optional(), position: z.number().int().optional() }));
  return Response.json(await updateRowTemplate(ws.id, params.id, id, patch));
});
export const DELETE = handler(async ({ ws, params, req, user }) => {
  const id = uuid.parse(new URL(req.url).searchParams.get("id")); await deleteRowTemplate(ws.id, params.id, id);
  await audit(user.id, "database.row_template.delete", { type: "database", id: params.id }, {}); return Response.json({ ok: true });
});
