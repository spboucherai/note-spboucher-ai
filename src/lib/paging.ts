/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/paging.ts
 * Description      : Offset paging shared by the list routes and the "Show
 *                    more" lists of the web app (trash, archive, search). Pure
 *                    functions, no dependency: imported by route handlers and
 *                    by client components alike.
 * Module           : lib
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

/** Rows asked per request by the trash and archive lists (the cap of `GET /api/pages?limit=`). */
export const LIST_PAGE_SIZE = 100;
/** Universal search: first request, step of "Show more", and the cap accepted by `GET /api/search?limit=`. */
export const SEARCH_PAGE_SIZE = 40;
export const SEARCH_MAX_LIMIT = 120;
/** Highest offset a list route accepts: keeps `OFFSET` scans bounded. */
export const MAX_OFFSET = 100_000;

/** `?offset=` of a list route: absent → 0; otherwise a plain non-negative integer ≤ MAX_OFFSET, or null (the route answers 400). */
export function parseOffset(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return 0;
  if (!/^\d{1,6}$/.test(raw)) return null;
  const n = Number(raw); return n <= MAX_OFFSET ? n : null;
}
/** Offset of the next page for an infinite list, or undefined when the last page came back short (nothing left). */
export function nextOffset(pages: readonly (readonly unknown[])[], pageSize = LIST_PAGE_SIZE): number | undefined {
  const last = pages[pages.length - 1]; if (!last || last.length < pageSize) return undefined;
  const loaded = pages.reduce((n, p) => n + p.length, 0); return loaded > MAX_OFFSET ? undefined : loaded;
}
/** Pages of an infinite list as one array, without the duplicates an insertion between two requests can produce. */
export function flattenPages<T extends { id: string }>(pages: readonly (readonly T[])[] | undefined): T[] {
  const seen = new Set<string>(); const out: T[] = [];
  for (const p of pages ?? []) for (const row of p) if (!seen.has(row.id)) { seen.add(row.id); out.push(row); }
  return out;
}
/**
 * Search has no offset (results are a fused ranking): "Show more" asks again with a higher limit. `more` = the server filled the whole
 * limit and a higher one is allowed; `capped` = it filled the highest limit, so the list is truncated and the UI must say so.
 */
export function searchPaging(shown: number, limit: number): { more: boolean; capped: boolean; nextLimit: number } {
  const full = shown >= limit; const nextLimit = Math.min(SEARCH_MAX_LIMIT, limit + SEARCH_PAGE_SIZE);
  return { more: full && limit < SEARCH_MAX_LIMIT, capped: full && limit >= SEARCH_MAX_LIMIT, nextLimit };
}
