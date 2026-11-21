/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/canvases/[pageId]/route.ts
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
import { handler, parseBody, uuid } from "@/lib/api";
import { getCanvas, putCanvas } from "@/lib/canvas/service";
export const dynamic = "force-dynamic";
/** GET /api/canvases/<pageId> → `{pageId, title, data, version, rev, updatedAt}`. 404 `not_canvas` when the page is not of type `canvas`. */
export const GET = handler(async ({ ws, params }) => Response.json(await getCanvas(ws.id, uuid.parse(params.pageId))));
/** PUT /api/canvases/<pageId> { data, baseVersion } → 200 `{version, rev, updatedAt, unchanged}` | 409 `conflict` + `server: {version, data, updatedAt}`. */
export const PUT = handler(async ({ req, ws, params }) => {
  const pageId = uuid.parse(params.pageId); const b = await parseBody(req, z.object({ data: z.any(), baseVersion: z.number().int().min(0) }));
  return Response.json(await putCanvas(ws.id, pageId, b.data, b.baseVersion));
});
