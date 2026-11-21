/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/databases/[id]/rows/route.ts
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
import { createRow, updateRow, deleteRows, reorderRows, listRowsSimple, getDatabase, queryRows } from "@/lib/databases/service";
import { moveRow } from "@/lib/databases/rows";
import { audit } from "@/lib/audit";
import { autoRunForRow } from "@/lib/ai/properties";
const values = z.record(z.string(), z.unknown());
/** GET ?q=&limit= → lightweight refs (relation pickers); ?full=1 → hydrated rows. */
export const GET = handler(async ({ ws, params, req }) => {
  const u = new URL(req.url); const q = u.searchParams.get("q") ?? undefined;
  // 3.0 (audit D23): `limit` / `offset` that are not whole numbers ≥ 0 → 400 (NaN used to give an empty answer, negatives passed)
  const int = (k: string, dflt: number, min: number) => { const raw = u.searchParams.get(k); if (raw == null || raw === "") return dflt; const n = Number(raw); if (!Number.isInteger(n) || n < min) throw new HttpError(400, `Invalid ${k}`, "bad_request"); return n; };
  const limit = Math.min(500, int("limit", 50, 1));
  if (u.searchParams.get("full") === "1") { const d = await getDatabase(ws.id, params.id); return Response.json(await queryRows(d.id, d.properties, { search: q, limit, offset: int("offset", 0, 0) })); }
  return Response.json(await listRowsSimple(ws.id, params.id, q, limit));
});
/** { title?, values?, position?, content? } or { rows: [...] } */
export const POST = handler(async ({ ws, params, req, user }) => {
  const row = z.object({ id: uuid.optional(), pageId: uuid.optional(), title: z.string().max(500).optional(), values: values.optional(), position: z.number().optional(), content: z.any().optional(), icon: z.string().max(16).nullable().optional(), templateId: uuid.optional() });
  const b = await parseBody(req, z.union([z.object({ rows: z.array(row).max(500) }), row.strict()]));
  const inputs = "rows" in b ? b.rows : [b]; const out = []; for (const i of inputs) out.push(await createRow(ws.id, params.id, i));
  for (const r of out) await autoRunForRow(ws.id, params.id, r.id, ["title"]); // NEXT-AI: AI properties with auto-run
  await audit(user.id, "database.row.create", { type: "database", id: params.id }, { count: out.length });
  return Response.json("rows" in b ? out : out[0], { status: 201 });
});
/** { id, values } | { updates: [{ id, values }] } | { order: [ids] } | 3.0: { move: { id, after? | before? } } → { id, position } (one row written, audit D7) */
export const PATCH = handler(async ({ ws, params, req }) => {
  const b = await parseBody(req, z.object({ id: uuid.optional(), values: values.optional(), updates: z.array(z.object({ id: uuid, values })).max(500).optional(), order: z.array(uuid).max(5000).optional(), move: z.object({ id: uuid, after: uuid.nullable().optional(), before: uuid.nullable().optional() }).optional() }));
  if (b.move) return Response.json(await moveRow(ws.id, params.id, b.move.id, b.move));
  if (b.order) { await reorderRows(ws.id, params.id, b.order); return Response.json({ ok: true }); }
  // NEXT-AI: after a row changed, AI properties with auto-run are queued (never when only AI cells changed; never fails the write)
  if (b.updates) { const out = []; for (const u of b.updates) { out.push(await updateRow(ws.id, params.id, u.id, u.values)); await autoRunForRow(ws.id, params.id, u.id, Object.keys(u.values)); } return Response.json(out); }
  if (!b.id) throw new HttpError(400, "id required");
  const row = await updateRow(ws.id, params.id, b.id, b.values ?? {});
  await autoRunForRow(ws.id, params.id, b.id, Object.keys(b.values ?? {}));
  return Response.json(row);
});
/** ?id=… or ?ids=a,b,c */
export const DELETE = handler(async ({ ws, params, req, user }) => {
  const u = new URL(req.url); const ids = [...(u.searchParams.get("ids")?.split(",") ?? []), ...(u.searchParams.get("id") ? [u.searchParams.get("id")!] : [])].map((x) => uuid.parse(x));
  const n = await deleteRows(ws.id, params.id, ids); await audit(user.id, "database.row.delete", { type: "database", id: params.id }, { count: n });
  return Response.json({ ok: true, deleted: n });
});
