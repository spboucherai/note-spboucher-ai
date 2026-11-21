/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/graph/relations/[id]/route.ts
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

import { handler, parseBody, uuid } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteRelation, getRelation, updateRelation } from "@/lib/graph/relations";
import { relationPatch, toDate } from "@/lib/graph/schema";

export const GET = handler(async ({ ws, params }) => Response.json(await getRelation(ws.id, uuid.parse(params.id))));
/** PATCH { status?: accepted|rejected|suggested, relType?, note?, validFrom?, validTo? } → relation. Accept / reject set `decidedAt`. */
export const PATCH = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const b = await parseBody(req, relationPatch);
  const r = await updateRelation(ws.id, id, { ...b, validFrom: toDate(b.validFrom), validTo: toDate(b.validTo) });
  await audit(user.id, b.status ? `graph.relation.${b.status}` : "graph.relation.update", { type: "edge", id });
  return Response.json(r);
});
/** DELETE → `{ok:true}`, idempotent (an unknown or already deleted id answers the same 200). Only relations (kind `relation`); a document link or a citation → 409 `derived_edge`. */
export const DELETE = handler(async ({ ws, params, user }) => {
  const id = uuid.parse(params.id);
  if (await deleteRelation(ws.id, id)) await audit(user.id, "graph.relation.delete", { type: "edge", id });
  return Response.json({ ok: true });
});
