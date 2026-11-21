/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/research/ai/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
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
import { sse } from "@/lib/ai/chat";
import { researchAI, RESEARCH_FEATURES } from "@/lib/research/ai";
export const maxDuration = 300;
/** POST { feature, pageId, referenceIds?, attachmentIds?, text?, instruction?, question?, latex?, language?, model? } → SSE (meta | text | result | done | error). Output is AI-generated and never written anywhere by this route. */
export const POST = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({ feature: z.enum(RESEARCH_FEATURES), pageId: uuid, referenceIds: z.array(uuid).max(50).optional(), attachmentIds: z.array(uuid).max(20).optional(), text: z.string().max(200_000).optional(), instruction: z.string().max(4000).optional(), question: z.string().max(4000).optional(), latex: z.string().max(20_000).optional(), language: z.enum(["fr", "en"]).nullable().optional(), model: z.string().max(80).nullable().optional() }));
  return sse(researchAI(ws.id, b, req.signal), req.signal);
});
