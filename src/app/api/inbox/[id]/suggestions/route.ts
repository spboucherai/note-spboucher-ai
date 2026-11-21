/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/inbox/[id]/suggestions/route.ts
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

import { handler, uuid, HttpError } from "@/lib/api";
import { suggest } from "@/lib/ai/inbox";
export const maxDuration = 120;
/**
 * GET → AI suggestions for one capture of the inbox (SPEC §4.12): title, tags, destination, related pages, summary — validated against
 * the workspace, cached by content hash, marked `ai:true`. SUGGESTIONS ONLY: this route changes nothing in the workspace.
 * `?refresh=1` regenerates; `?cachedOnly=1` never calls a provider (404 `not_generated` when nothing is cached); `?model=` chooses the model.
 */
export const GET = handler(async ({ req, ws, params }) => {
  const id = uuid.safeParse(params.id); if (!id.success) throw new HttpError(400, "Invalid id", "bad_id");
  const u = new URL(req.url).searchParams; const model = u.get("model");
  return Response.json(await suggest(ws.id, id.data, { refresh: u.get("refresh") === "1", generate: u.get("cachedOnly") !== "1", model: model && model.length <= 200 ? model : null, signal: req.signal }));
});
