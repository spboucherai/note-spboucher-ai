/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/graph/route.ts
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

import { handler, HttpError, optDate, optUuid } from "@/lib/api";
import { buildGraphView, GRAPH_VIEWS, type GraphView } from "@/lib/graph/views";
import { buildGraph } from "@/lib/graph/service";
import { NODE_KINDS, type NodeKind } from "@/lib/graph/types";

/** GET /api/graph?types=page,database&section=notes&since=ISO&pageId=&depth=1&hideOrphans=1&suggestions=0 */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams;
  // 3.0 — ?view=global|local|project|timeline|concepts|documents|references&pageId=&depth=&from=&to=&suggestions=0&hideOrphans=1 → graph 2.0
  // shape (typed relations, references, concepts; see docs/next/API-NEXT.md §4.3). Without `view` the 2.x answer below is unchanged.
  const view = u.get("view");
  if (view !== null) {
    if (!(GRAPH_VIEWS as readonly string[]).includes(view)) throw new HttpError(400, `Unknown view (expected ${GRAPH_VIEWS.join(" | ")})`, "bad_view");
    const d = u.get("depth"); if (d !== null && !/^[1-4]$/.test(d)) throw new HttpError(400, "depth must be 1 to 4", "bad_request");
    return Response.json(await buildGraphView(ws.id, view as GraphView, { pageId: optUuid(u.get("pageId")), depth: d ? Number(d) : 1, from: optDate(u.get("from"), "from"), to: optDate(u.get("to"), "to"), suggestions: u.get("suggestions") !== "0", hideOrphans: u.get("hideOrphans") === "1" }));
  }
  const types = (u.get("types") ?? "").split(",").map((s) => s.trim()).filter((s): s is NodeKind => (NODE_KINDS as string[]).includes(s));
  const since = u.get("since") ? new Date(u.get("since")!) : null;
  const pageId = u.get("pageId"); const depth = Math.min(4, Math.max(0, Number(u.get("depth") ?? 1) || 1));
  const g = await buildGraph(ws.id, {
    types: types.length ? types : undefined, section: u.get("section") || null, since: since && !isNaN(since.getTime()) ? since : null,
    pageId: pageId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pageId) ? pageId : null /* 3.0: a real uuid test (36 hyphens used to reach a ::uuid cast → 500) */, depth, hideOrphans: u.get("hideOrphans") === "1", suggestions: u.get("suggestions") !== "0",
  });
  return Response.json(g, { headers: { "cache-control": "private, no-store" } });
});
