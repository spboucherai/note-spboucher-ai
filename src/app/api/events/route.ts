/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/events/route.ts
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
import { EVENT_KINDS, listEvents } from "@/lib/events/service";
import { descendants, getPage } from "@/lib/pages/service";
export const dynamic = "force-dynamic";
/**
 * GET /api/events?pageId=&projectId=&from=&to=&kinds=a,b&cursor=&limit= → `{events, nextCursor}` — the journal, newest first.
 * `projectId` = a page and all its sub-pages (trashed ones included: their history is part of the project's). `kinds` accepts exact
 * kinds and families (`page.*`, `task.*`). `limit` 1..200 (default 50). Pass `nextCursor` back as `cursor` until it is null.
 */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams; const pageId = optUuid(u.get("pageId")); const projectId = optUuid(u.get("projectId"));
  if (pageId && projectId) throw new HttpError(400, "Give pageId or projectId, not both", "bad_request");
  const lim = u.get("limit"); if (lim !== null && !/^\d{1,3}$/.test(lim)) throw new HttpError(400, "limit must be an integer", "bad_request");
  let kinds: string[] | null = null; const raw = u.get("kinds");
  if (raw) {
    kinds = []; for (const k of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const fam = k.endsWith(".*") ? EVENT_KINDS.filter((e) => e.startsWith(k.slice(0, -1))) : (EVENT_KINDS as readonly string[]).includes(k) ? [k] : [];
      if (!fam.length) throw new HttpError(400, `Unknown event kind: ${k}`, "bad_kinds", { kinds: [...EVENT_KINDS] }); kinds.push(...fam);
    }
  }
  let pageIds: string[] | null = null;
  if (projectId) { await getPage(ws.id, projectId, { includeDeleted: true }); pageIds = [projectId, ...(await descendants(ws.id, projectId, true))]; }
  return Response.json(await listEvents(ws.id, { pageId, pageIds, from: optDate(u.get("from"), "from"), to: optDate(u.get("to"), "to"), kinds, cursor: u.get("cursor"), limit: lim ? Number(lim) : 50 }));
});
