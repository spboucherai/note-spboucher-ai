/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/pages/[id]/resolve/route.ts
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
import { resolveConflict } from "@/lib/pages/service";
import { assertDoc } from "@/lib/editor/validate";
import { audit } from "@/lib/audit";
/** POST { choice: mine|theirs|both, serverVersion, mine: { title?, content? } } → settles a save conflict; both copies stay in the history. */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id);
  const b = await parseBody(req, z.object({ choice: z.enum(["mine", "theirs", "both"]), serverVersion: z.number().int().min(0), mine: z.object({ title: z.string().max(500).optional(), content: z.any().optional() }) }));
  if (b.mine.content !== undefined) assertDoc(b.mine.content);
  const r = await resolveConflict(ws.id, id, b);
  await audit(user.id, "page.conflict_resolved", { type: "page", id }, { choice: b.choice, copyId: r.copyId });
  return Response.json({ id: r.page.id, version: r.page.version, title: r.page.title, content: r.page.content, properties: r.page.properties, updatedAt: r.page.updatedAt, copyId: r.copyId });
});
