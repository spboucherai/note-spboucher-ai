/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/databases/[id]/properties/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

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
