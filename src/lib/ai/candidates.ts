/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/ai/candidates.ts
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

/**
 * Pages similar to a piece of text, for the features that let the model CHOOSE among existing pages (smart inbox, link suggestions).
 * Two passes of the existing hybrid search are merged: the natural text (meaning + all-terms keyword match) and an any-term keyword
 * query built from its distinctive words — the second one keeps candidates coming when embeddings are unavailable or when the text is
 * too long for every word to appear in one passage.
 */
import { hybridSearch, type Hit } from "@/lib/search";

const STOP = new Set(["avec", "dans", "pour", "plus", "cette", "sont", "être", "avoir", "mais", "donc", "comme", "leur", "leurs", "nous", "vous", "elle", "elles", "tout", "tous", "toute", "très", "avant", "après", "entre", "from", "with", "that", "this", "have", "will", "they", "their", "there", "what", "when", "which", "about", "into", "than", "then", "been", "were", "also"]);
/** `mot1 OR mot2 …` from the first distinctive words of a text (accents kept: the full-text index is not unaccented). */
export function anyTermQuery(text: string, max = 16): string {
  const seen = new Set<string>(); const out: string[] = [];
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []) { if (STOP.has(w) || seen.has(w)) continue; seen.add(w); out.push(w); if (out.length >= max) break; }
  return out.join(" OR ");
}
/** Best passage per page, best first; `exclude` page ids never appear. */
export async function similarPages(workspaceId: string, text: string, opts: { exclude?: Iterable<string>; limit?: number } = {}): Promise<Hit[]> {
  const limit = opts.limit ?? 10; const exclude = new Set(opts.exclude ?? []); const natural = text.replace(/\s+/g, " ").trim().slice(0, 600); if (!natural) return [];
  const anyTerm = anyTermQuery(text);
  const [a, b] = await Promise.all([
    hybridSearch(workspaceId, natural, { limit: 24, sourceTypes: ["page"] }).catch(() => [] as Hit[]),
    anyTerm ? hybridSearch(workspaceId, anyTerm, { limit: 24, sourceTypes: ["page"], semantic: false }).catch(() => [] as Hit[]) : Promise.resolve([] as Hit[]),
  ]);
  const out = new Map<string, Hit>();
  for (const h of [...a, ...b]) { if (!h.pageId || exclude.has(h.pageId) || out.has(h.pageId)) continue; out.set(h.pageId, h); if (out.size >= limit) break; }
  return [...out.values()];
}
