/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/pages/[id]/zoom/route.ts
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

import { handler, HttpError, uuid } from "@/lib/api";
import { getPage } from "@/lib/pages/service";
import { zoomLevel2, zoomLevel3 } from "@/lib/pages/zoom";
import { aiSynopsis } from "@/lib/ai/zoom";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
/** GET /api/pages/<id>/zoom?level=1|2|3 — 3 = full document, 2 = outline (no model), 1 = AI synopsis (cached by content hash, always `ai:true` with model + generatedAt; `cachedOnly=1` never calls a provider, `refresh=1` regenerates). Same function as `/zoom/ai`. */
export const GET = handler(async ({ req, ws, params }) => {
  const id = uuid.parse(params.id); const u = new URL(req.url).searchParams; const level = u.get("level") ?? "2";
  if (!["1", "2", "3"].includes(level)) throw new HttpError(400, "level must be 1, 2 or 3", "bad_request");
  const p = await getPage(ws.id, id, { includeDeleted: true });
  if (level === "3") return Response.json(zoomLevel3(p)); if (level === "2") return Response.json(zoomLevel2(p));
  const syn = await aiSynopsis(ws.id, id, { generate: u.get("cachedOnly") !== "1", force: u.get("refresh") === "1", signal: req.signal });
  return Response.json({ ...syn, title: p.title, version: p.version });
});
