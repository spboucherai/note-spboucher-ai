/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/databases/[id]/route.ts
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
import { handler, parseBody } from "@/lib/api";
import { getDatabase, updateDatabase } from "@/lib/databases/service";
import { iterateRows } from "@/lib/databases/engine";
import { exportCsvStream } from "@/lib/databases/csv";
import { audit } from "@/lib/audit";
/** GET by database id OR host page id. ?format=csv[&viewId=] exports the rows. */
export const GET = handler(async ({ ws, params, req }) => {
  const d = await getDatabase(ws.id, params.id); const u = new URL(req.url);
  if (u.searchParams.get("format") === "csv") {
    const view = d.views.find((v) => v.id === u.searchParams.get("viewId")); // 3.0 (audit D11): every row, streamed
    return new Response(exportCsvStream(d.properties, iterateRows(d.id, d.properties, { filter: view?.config.filter ?? null, sorts: view?.config.sorts ?? [] }), view?.config.hidden ?? []), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${d.name.replace(/[^\w.-]+/g, "_") || "database"}.csv"` } });
  }
  return Response.json(d);
});
export const PATCH = handler(async ({ ws, params, req, user }) => {
  const b = await parseBody(req, z.object({ name: z.string().max(500).optional(), description: z.string().max(2000).nullable().optional(), icon: z.string().max(16).nullable().optional(), isTemplate: z.boolean().optional() }));
  const d = await updateDatabase(ws.id, params.id, b); await audit(user.id, "database.update", { type: "database", id: d.id }, { keys: Object.keys(b) });
  return Response.json(d);
});
