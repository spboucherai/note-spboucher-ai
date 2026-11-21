/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/inbox/[id]/apply/route.ts
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
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { applySuggestions, SECTIONS } from "@/lib/ai/inbox";
import { audit } from "@/lib/audit";
const body = z.object({
  title: z.string().trim().min(1).max(300).optional(), tags: z.array(z.string().max(60)).max(10).optional(),
  destination: z.object({ section: z.enum(SECTIONS).optional(), parentId: uuid.nullable().optional() }).optional(),
  relations: z.array(z.object({ pageId: uuid, reason: z.string().max(300).optional() })).max(10).optional(), summary: z.string().trim().min(1).max(1000).optional(),
}).strict();
/**
 * POST → apply the subset of AI suggestions the owner chose (SPEC §4.12). Only the keys present in the body are applied, with the values
 * sent (the owner may have edited them). Journaled in `inbox_actions`: the answer carries `actionId`, which POST /api/inbox/undo reverses.
 * The capture leaves the inbox only when `destination` is part of the choice.
 */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.safeParse(params.id); if (!id.success) throw new HttpError(400, "Invalid id", "bad_id");
  const b = await parseBody(req, body);
  const r = await applySuggestions(ws.id, id.data, b);
  await audit(user.id, "inbox.suggestions_apply", { type: "page", id: id.data }, { actionId: r.actionId, applied: r.applied });
  return Response.json(r);
});
