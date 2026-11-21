/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/graph/neighbors/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
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
import { pageNeighbourhood, linkedPages, listSuggestions } from "@/lib/graph/service";

/** GET /api/graph/neighbors?pageId=&depth=1&suggestions=1&linked=1 — page-level mini graph (+ linked page list and pending suggestions when linked=1). */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams;
  const r = uuid.safeParse(u.get("pageId")); if (!r.success) throw new HttpError(400, "pageId required");
  const depth = Math.min(3, Math.max(1, Number(u.get("depth") ?? 1) || 1));
  const g = await pageNeighbourhood(ws.id, r.data, depth, { suggestions: u.get("suggestions") !== "0" });
  if (u.get("linked") !== "1") return Response.json(g, { headers: { "cache-control": "private, no-store" } });
  const [linked, suggestions] = await Promise.all([linkedPages(ws.id, r.data), listSuggestions(ws.id, "suggested", { pageId: r.data, limit: 50 })]);
  return Response.json({ ...g, linked, suggestions }, { headers: { "cache-control": "private, no-store" } });
});
