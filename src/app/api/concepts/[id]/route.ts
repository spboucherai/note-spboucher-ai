/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/concepts/[id]/route.ts
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
import { deleteConcept, getConcept, updateConcept } from "@/lib/graph/concepts";
import { conceptPatch } from "@/lib/graph/schema";

/** GET → concept + `pageLinks` (pages about it, with origin / status / confidence). */
export const GET = handler(async ({ ws, params }) => Response.json(await getConcept(ws.id, uuid.parse(params.id))));
/** PATCH { name?, description?, status?, addPages?, removePages?, pageLinks?: [{pageId, status}] } → concept + pageLinks. */
export const PATCH = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const c = await updateConcept(ws.id, id, await parseBody(req, conceptPatch));
  await audit(user.id, "concept.update", { type: "concept", id }); return Response.json(c);
});
export const DELETE = handler(async ({ ws, params, user }) => {
  const id = uuid.parse(params.id); if (await deleteConcept(ws.id, id)) await audit(user.id, "concept.delete", { type: "concept", id }); /* idempotent: an unknown id answers the same 200 */ return Response.json({ ok: true });
});
