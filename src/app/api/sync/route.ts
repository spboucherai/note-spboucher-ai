/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/sync/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-18
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

import { handler } from "@/lib/api";
import { syncFeed } from "@/lib/sync/feed";
export const dynamic = "force-dynamic";
/**
 * GET /api/sync?since=<rev>&limit=<n> — change feed for native clients (SP Notes on macOS / iOS), which keep a full local copy.
 *
 * Returns everything whose revision is greater than `since`, oldest first: whole pages (content included, in every state — live, inbox,
 * archived, in the trash), attachment metadata, and tombstones of permanently deleted rows. `cursor` is the revision to send next time;
 * `more: true` means the answer was cut at `limit` and the client should call again at once. `since=0` is a full copy.
 *
 * Revisions come from one sequence taken under an advisory lock (migration 0002), so they are visible in commit order: every change
 * numbered ≤ `head` is committed when `head` is read, and nothing can later appear below a cursor the client already holds.
 * Read-only; nothing is marked as opened.
 *
 * 3.0 — `kinds=task,database,database_property,database_view,database_row,edge,reference,canvas,concept` (or `kinds=all`) adds
 * `"entities": { "<kind>": [ {…row…, "rev": n} ] }`, windowed exactly like pages (same cursor, same cut rule), and the tombstones of
 * those kinds. WITHOUT `kinds` the answer is the 2.x one, byte for byte: same keys in the same order, tombstones of pages and
 * attachments only, and a `head` that ignores the revisions of the new kinds. A cursor is therefore only meaningful for the set of
 * kinds it was obtained with: a client that starts asking for a new kind starts that kind from `since=0`.
 */
export const GET = handler(async ({ req, ws, user }) => Response.json(await syncFeed(ws, user, new URL(req.url).searchParams)));
