import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { createView, updateView, deleteView, getDatabase } from "@/lib/databases/service";
import { VIEW_TYPES } from "@/lib/databases/types";
const config = z.record(z.string(), z.unknown());
export const GET = handler(async ({ ws, params }) => Response.json((await getDatabase(ws.id, params.id)).views));
export const POST = handler(async ({ ws, params, req }) => { const b = await parseBody(req, z.object({ id: uuid.optional(), name: z.string().max(200), type: z.enum(VIEW_TYPES), config: config.optional() })); return Response.json(await createView(ws.id, params.id, b as any), { status: 201 }); });
export const PATCH = handler(async ({ ws, params, req }) => { const { id, ...patch } = await parseBody(req, z.object({ id: uuid, name: z.string().max(200).optional(), type: z.enum(VIEW_TYPES).optional(), config: config.optional(), position: z.number().optional(), isDefault: z.boolean().optional() })); return Response.json(await updateView(ws.id, params.id, id, patch as any)); });
export const DELETE = handler(async ({ ws, params, req }) => { await deleteView(ws.id, params.id, uuid.parse(new URL(req.url).searchParams.get("id"))); return Response.json({ ok: true }); });
