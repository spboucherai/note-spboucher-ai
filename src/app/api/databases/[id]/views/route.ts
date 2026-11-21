/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/databases/[id]/views/route.ts
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
import { handler, parseBody, uuid } from "@/lib/api";
import { createView, updateView, deleteView, getDatabase } from "@/lib/databases/service";
import { VIEW_TYPES } from "@/lib/databases/types";
const config = z.record(z.string(), z.unknown());
export const GET = handler(async ({ ws, params }) => Response.json((await getDatabase(ws.id, params.id)).views));
export const POST = handler(async ({ ws, params, req }) => { const b = await parseBody(req, z.object({ id: uuid.optional(), name: z.string().max(200), type: z.enum(VIEW_TYPES), config: config.optional() })); return Response.json(await createView(ws.id, params.id, b as any), { status: 201 }); });
export const PATCH = handler(async ({ ws, params, req }) => { const { id, ...patch } = await parseBody(req, z.object({ id: uuid, name: z.string().max(200).optional(), type: z.enum(VIEW_TYPES).optional(), config: config.optional(), position: z.number().optional(), isDefault: z.boolean().optional() })); return Response.json(await updateView(ws.id, params.id, id, patch as any)); });
export const DELETE = handler(async ({ ws, params, req }) => { await deleteView(ws.id, params.id, uuid.parse(new URL(req.url).searchParams.get("id"))); return Response.json({ ok: true }); });
