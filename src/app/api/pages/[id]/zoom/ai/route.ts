/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/pages/[id]/zoom/ai/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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
import { handler, uuid, HttpError } from "@/lib/api";
import { aiSynopsis } from "@/lib/ai/zoom";
export const maxDuration = 120;
/**
 * Semantic zoom level 1 (SPEC §4.9) — AI synopsis of a page, cached by content hash, always marked `ai:true` with `model` + `generatedAt`.
 * GET  ?cachedOnly=1 → never calls a provider (`status:"missing"` when there is no valid synopsis); without it, generates when missing.
 * POST {model?}      → regenerates (owner pressed "Regenerate"), optionally with a chosen model.
 * The foundation route `GET /api/pages/<id>/zoom?level=1` delegates to the same function (`aiSynopsis`).
 */
export const GET = handler(async ({ req, ws, params }) => {
  const id = uuid.safeParse(params.id); if (!id.success) throw new HttpError(400, "Invalid page id", "bad_id");
  const u = new URL(req.url).searchParams; const model = u.get("model");
  return Response.json(await aiSynopsis(ws.id, id.data, { generate: u.get("cachedOnly") !== "1", model: model && model.length <= 200 ? model : null, signal: req.signal }));
});
export const POST = handler(async ({ req, ws, params }) => {
  const id = uuid.safeParse(params.id); if (!id.success) throw new HttpError(400, "Invalid page id", "bad_id");
  const b = z.object({ model: z.string().max(200).nullable().optional() }).safeParse(await req.json().catch(() => ({}))); if (!b.success) throw new HttpError(400, "Invalid body");
  return Response.json(await aiSynopsis(ws.id, id.data, { force: true, model: b.data.model ?? null, signal: req.signal }));
});
