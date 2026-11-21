/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/ai/chat/route.ts
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
import { chat, sse, CHAT_MODES, CHAT_SCOPES } from "@/lib/ai/chat";
export const maxDuration = 600;
/**
 * POST → SSE stream of ChatEvent. `clientId` identifies one send: repeating it after a lost connection replays the stored answer instead
 * of calling (and paying) the provider again. `confirmExpensive` is required for expensive classes (the stream answers
 * `needs_confirmation` otherwise, having written and sent nothing).
 * `scope` (all | page | project | selection) restricts the evidence; every citation of the answer points to a block that exists in the
 * page now (`sources[].blockId`), and an answer that cites nothing is withheld. Contract: docs/next/API-NEXT-AI.md §2.
 */
export const POST = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({
    conversationId: z.string().uuid().nullable().optional(), clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().optional(),
    message: z.string().trim().min(1).max(60_000), mode: z.enum(CHAT_MODES).nullable().optional(), pageId: z.string().uuid().nullable().optional(), model: z.string().max(200).nullable().optional(),
    task: z.enum(["chat", "quick", "write", "reason", "deep", "code", "extract", "longctx", "agent", "judge"]).nullable().optional(), useWorkspace: z.boolean().optional(), confirmExpensive: z.boolean().optional(),
    images: z.array(z.object({ mime: z.string().regex(/^image\/(png|jpeg|webp|gif)$/), dataBase64: z.string().max(8_000_000) })).max(4).optional(), scopePageIds: z.array(z.string().uuid()).max(50).optional(),
    // SPEC §4.10 — Ask my knowledge: where the answer may come from
    scope: z.enum(CHAT_SCOPES).nullable().optional(), projectId: z.string().uuid().nullable().optional(), selection: z.string().max(20_000).nullable().optional(), selectionBlockId: z.string().max(64).nullable().optional(),
  }));
  return sse(chat(ws.id, b, req.signal), req.signal);
});
