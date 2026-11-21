/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/search/route.ts
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

import { handler, HttpError } from "@/lib/api";
import { hybridSearch, quickSearch, type SearchFilters } from "@/lib/search";
import { SEARCH_MAX_LIMIT } from "@/lib/paging";
const KINDS = ["page", "entry", "file", "reference"] as const;
/**
 * GET ?q=&mode=quick|hybrid&limit=&semantic=0|1&kinds=page,entry,file,reference&section=&since=YYYY-MM-DD&until=YYYY-MM-DD&archived=1&group=1
 * `limit`: 1–120 (default 10 quick, 20 hybrid; the cap was 60 before "Show more"). There is no offset: a longer list is asked with a higher limit.
 * (legacy `types=page,attachment` still accepted). `semantic=1` sends the query text to the embedding provider; `semantic=0` stays local.
 */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url); const q = (u.searchParams.get("q") ?? "").slice(0, 500); const mode = u.searchParams.get("mode") ?? "quick";
  const limit = Math.min(SEARCH_MAX_LIMIT, Math.max(1, Number(u.searchParams.get("limit") ?? (mode === "quick" ? 10 : 20)) || 10));
  if (mode === "quick") return Response.json(await quickSearch(ws.id, q, limit));
  if (q.trim().length < 2) return Response.json([]);
  const date = (v: string | null, end = false) => { if (!v) return undefined; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, "Dates must be YYYY-MM-DD"); return new Date(`${v}T${end ? "23:59:59.999" : "00:00:00"}Z`); };
  const kinds = (u.searchParams.get("kinds") ?? "").split(",").filter((k): k is (typeof KINDS)[number] => (KINDS as readonly string[]).includes(k));
  const section = u.searchParams.get("section"); if (section && !["notes", "documents", "projects", "research", "databases"].includes(section)) throw new HttpError(400, "Unknown space");
  const f: SearchFilters = { limit, semantic: u.searchParams.get("semantic") !== "0", sourceTypes: u.searchParams.get("types")?.split(",").filter(Boolean), kinds: kinds.length ? kinds : undefined, section: section || undefined, since: date(u.searchParams.get("since")), until: date(u.searchParams.get("until"), true), includeArchived: u.searchParams.get("archived") === "1", group: u.searchParams.get("group") === "1" };
  return Response.json(await hybridSearch(ws.id, q, f));
});
