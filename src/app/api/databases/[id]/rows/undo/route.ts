/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/databases/[id]/rows/undo/route.ts
 * Description      : POST { opId, redo? } — revert (or re-apply) a bulk action
 *                    journaled by `rows/bulk`. Answer { ok, kind, affected,
 *                    undone }. 404 when the journal entry is gone (kept 7
 *                    days), 409 when it is already in the requested state.
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
import { handler, parseBody, uuid } from "@/lib/api";
import { undoOp } from "@/lib/databases/rows";
import { audit } from "@/lib/audit";
export const POST = handler(async ({ ws, params, req, user }) => {
  const b = await parseBody(req, z.object({ opId: uuid, redo: z.boolean().optional() }));
  const r = await undoOp(ws.id, params.id, b.opId, !!b.redo);
  await audit(user.id, b.redo ? "database.row.redo" : "database.row.undo", { type: "database", id: params.id }, { kind: r.kind, count: r.affected });
  return Response.json(r);
});
