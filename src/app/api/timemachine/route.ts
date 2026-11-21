/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/timemachine/route.ts
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

import { handler, HttpError, optDate, optUuid } from "@/lib/api";
import { stateAt } from "@/lib/timemachine/service";
export const dynamic = "force-dynamic";
/**
 * GET /api/timemachine?at=<ISO>&pageId=<id> | &projectId=<id> [&content=0|1]
 * → `{at, scope, pages, relations, references, removedSince, journalSince}`: the state at that date. Page content is included for
 * `pageId` (and for `projectId` only with `content=1`). To bring a page back to a listed version:
 * `POST /api/pages/<id>/versions/<versionId>/restore`.
 */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams; const at = optDate(u.get("at"), "at"); if (!at) throw new HttpError(400, "at is required (ISO date)", "bad_request");
  const pageId = optUuid(u.get("pageId")); const projectId = optUuid(u.get("projectId"));
  if (Boolean(pageId) === Boolean(projectId)) throw new HttpError(400, "Give exactly one of pageId or projectId", "bad_request");
  const c = u.get("content");
  return Response.json(await stateAt(ws.id, at, { pageId, projectId }, { content: c === null ? undefined : c === "1" }));
});
