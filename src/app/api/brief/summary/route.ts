/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/brief/summary/route.ts
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
import { handler, HttpError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { summariseBrief } from "@/lib/knowledge/brief";
/** POST /api/brief/summary [{ tz? }] → `{ai: true, text, model, at, costUsd}` — explicit request only; one short model call over titles and counts. */
export const POST = handler(async ({ req, ws, user }) => {
  const b = z.object({ tz: z.string().max(64).optional() }).safeParse(await req.json().catch(() => ({}))); if (!b.success) throw new HttpError(400, "Validation: tz must be a string", "bad_request");
  const s = await summariseBrief(ws.id, { tz: b.data.tz }); await audit(user.id, "brief.summary", undefined, { model: s.model });
  return Response.json(s);
});
