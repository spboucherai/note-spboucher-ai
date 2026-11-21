/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/graph/relations/route.ts
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

import { handler, parseBody, optUuid, HttpError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createRelation, listRelations, REL_TYPES } from "@/lib/graph/relations";
import { relationCreate, toDate } from "@/lib/graph/schema";

/** GET /api/graph/relations?nodeId=&status=&relType=&origin=&include=cites,ai_suggested → typed relations (newest first, ≤ 500). */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams; const status = u.get("status"); const relType = u.get("relType"); const origin = u.get("origin");
  if (status && !["accepted", "rejected", "suggested"].includes(status)) throw new HttpError(400, "Unknown status", "bad_request");
  if (relType && !(REL_TYPES as readonly string[]).includes(relType)) throw new HttpError(400, "Unknown relType", "bad_request");
  if (origin && !["user", "ai", "system"].includes(origin)) throw new HttpError(400, "Unknown origin", "bad_request");
  const include = (u.get("include") ?? "").split(",").map((s) => s.trim()).filter((s) => s === "cites" || s === "ai_suggested" || s === "link");
  return Response.json({ relations: await listRelations(ws.id, { nodeId: optUuid(u.get("nodeId")), status, relType, origin, kinds: ["relation", ...include] }) });
});
/** POST → 201 relation (origin `user`, accepted). Client-chosen `id` → idempotent (200 + `x-existing: 1`). Same (from, to, relType) → 409 `relation_exists`. */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, relationCreate);
  const { relation, existing } = await createRelation(ws.id, { ...b, validFrom: toDate(b.validFrom), validTo: toDate(b.validTo) }, { origin: "user" });
  if (existing) return Response.json(relation, { status: 200, headers: { "x-existing": "1" } });
  await audit(user.id, "graph.relation.create", { type: "edge", id: relation.id }, { relType: relation.relType });
  return Response.json(relation, { status: 201 });
});
