/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/databases/[id]/query/route.ts
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
import { getDatabase, queryRows } from "@/lib/databases/service";
import { iterateRows, validateFilter, validateSorts } from "@/lib/databases/engine";
import { exportCsvStream } from "@/lib/databases/csv";
import { filterInput } from "@/lib/databases/filter-input";
/**
 * POST { viewId?, filter?, sorts?, search?, limit?, offset? } — explicit fields override the view's config. Answer `{rows, total, limit, offset}`.
 * 3.0 (additive): runs in SQL (window only); `extraFilter` (ANDed with the filter), `groupBy` (property id | null), `aggregates`, `rowIds`
 * (≤ 500: only those rows, e.g. to refresh one row), `limit: 0` (counts / groups only). The answer gains `engine`, `fallback`, `hasMore`,
 * `groups`, `aggregates`. An explicit filter / sort naming an unknown property or operator → 400 `bad_filter` / `bad_sort` (audit D10).
 */
export const POST = handler(async ({ ws, params, req }) => {
  const b = await parseBody(req, z.object({ viewId: z.string().uuid().optional(), filter: filterInput("filter").optional(), extraFilter: filterInput("extraFilter").optional(), sorts: z.array(z.object({ property: z.string(), dir: z.enum(["asc", "desc"]) })).optional(), search: z.string().max(200).optional(), limit: z.number().int().min(0).max(1000).optional(), offset: z.number().int().min(0).optional(), groupBy: z.string().nullable().optional(), aggregates: z.boolean().optional(), skipGroups: z.boolean().optional(), rowIds: z.array(uuid).max(500).optional() }));
  const d = await getDatabase(ws.id, params.id); const v = d.views.find((x) => x.id === b.viewId);
  if (b.filter !== undefined) validateFilter(b.filter, d.properties); if (b.extraFilter !== undefined) validateFilter(b.extraFilter, d.properties, "extraFilter"); if (b.sorts !== undefined) validateSorts(b.sorts, d.properties);
  if (b.groupBy && !d.properties.some((p) => p.id === b.groupBy && ["select", "status", "checkbox"].includes(p.type))) throw new HttpError(400, "groupBy must be a select, status or checkbox property of this database", "bad_request");
  const { rowIds, ...q } = b;
  return Response.json(await queryRows(d.id, d.properties, { ...q, ...(rowIds ? { ids: rowIds } : {}), filter: b.filter === undefined ? (v?.config.filter ?? null) : b.filter, sorts: b.sorts ?? v?.config.sorts ?? [] }));
});
/** GET ?viewId=&q= → first 1 000 rows (2.x shape). GET ?format=csv&viewId=&q= → CSV of EVERY row of the view, streamed (3.0, audit D11). */
export const GET = handler(async ({ ws, params, req }) => {
  const u = new URL(req.url); const d = await getDatabase(ws.id, params.id); const v = d.views.find((x) => x.id === u.searchParams.get("viewId"));
  const q = { filter: v?.config.filter ?? null, sorts: v?.config.sorts ?? [], search: u.searchParams.get("q") ?? undefined };
  if (u.searchParams.get("format") === "csv") return new Response(exportCsvStream(d.properties, iterateRows(d.id, d.properties, q), v?.config.hidden ?? []), { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="${(v ? `${d.name}-${v.name}` : d.name).replace(/[^\w.-]+/g, "_")}.csv"` } });
  return Response.json(await queryRows(d.id, d.properties, { ...q, limit: 1000 }));
});
