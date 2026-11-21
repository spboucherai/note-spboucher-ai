/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/inbox/[id]/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
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
import { triage } from "@/lib/inbox/service";
import { audit } from "@/lib/audit";
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep"), section: z.enum(["notes", "documents", "projects", "research"]).optional(), parentId: uuid.nullable().optional() }),
  z.object({ action: z.literal("task"), dueAt: z.string().datetime({ offset: true }).nullable().optional(), priority: z.enum(["low", "medium", "high"]).optional() }),
  z.object({ action: z.literal("database"), databaseId: uuid }),
  z.object({ action: z.literal("reference") }), z.object({ action: z.literal("archive") }), z.object({ action: z.literal("trash") }),
]);
/** POST → triage one capture. The answer carries `actionId`, which POST /api/inbox/undo reverses. */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const b = await parseBody(req, body);
  const r = await triage(ws.id, id, b);
  await audit(user.id, `inbox.${b.action}`, { type: "page", id }, { actionId: r.actionId });
  return Response.json(r);
});
