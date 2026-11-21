/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/databases/[id]/ai/route.ts
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
import { handler, parseBody, uuid } from "@/lib/api";
import { queueAiProperty } from "@/lib/ai/properties";
/**
 * { rowId, propertyId } | { rowIds: [...], propertyId } — enqueue AI property computation (manual action on one or several cells).
 * NEXT-AI: each cell becomes a row of `ai_property_runs`; a cell edited by hand is skipped unless the property is AI-managed or
 * `force:true` is sent. Historical answer kept (`ok`, `queued`), plus `runs` and `skipped`.
 */
export const POST = handler(async ({ ws, params, req }) => {
  const b = await parseBody(req, z.object({ rowId: uuid.optional(), rowIds: z.array(uuid).max(200).optional(), propertyId: uuid, force: z.boolean().optional() }));
  const ids = b.rowIds ?? (b.rowId ? [b.rowId] : []); const runs = [];
  for (const id of ids) runs.push({ rowId: id, ...(await queueAiProperty(ws.id, params.id, id, b.propertyId, { trigger: "manual", force: b.force })) });
  return Response.json({ ok: true, queued: runs.filter((r) => r.queued).length, runs, skipped: runs.filter((r) => r.skipped).map((r) => ({ rowId: r.rowId, reason: r.skipped, runId: r.runId })) });
});
