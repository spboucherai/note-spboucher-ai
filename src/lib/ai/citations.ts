/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/ai/citations.ts
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
 * Block-level citation anchoring (SPEC §4.10). A retrieved chunk covers several blocks of a page (~350 tokens); the index only remembers
 * the first one. These pure helpers find the blocks a chunk is made of in the CURRENT page content and pick the one that best matches a
 * piece of text (the question, then the sentences of the answer that carry the citation marker), so that a citation opens the paragraph
 * that actually supports the sentence — and so that a chunk whose text is no longer in the page is recognised as unverifiable.
 * Lexical on purpose: deterministic, free, and independent of any provider.
 */
export interface DocBlock { id: string | null; type: string; heading: string | null; text: string }
export const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const STOP = new Set(["the", "a", "an", "of", "to", "in", "and", "or", "is", "are", "for", "on", "with", "that", "this", "it", "as", "by", "at", "be", "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "est", "sont", "pour", "sur", "avec", "que", "qui", "ce", "cette", "il", "elle", "en", "au", "aux", "dans", "par", "se", "sa", "son", "ses", "d", "l", "qu"]);
export function tokens(s: string): string[] {
  return (s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 && !STOP.has(t));
}
/** Share of the distinct query tokens present in the block, damped for very short blocks (a 2-word block must not win on one word). */
export function overlapScore(query: string, block: string): number {
  const q = new Set(tokens(query)); if (!q.size) return 0;
  const b = new Set(tokens(block)); if (!b.size) return 0;
  let hit = 0; for (const t of q) if (b.has(t)) hit++;
  return (hit / q.size) * Math.min(1, b.size / 4);
}
/**
 * Blocks of the page that make up a chunk: a block whose text is contained in the chunk, or (block longer than a chunk, split by the
 * indexer) a block that contains the chunk. Headings are not evidence and are skipped. Empty result = the chunk is stale.
 */
export function blocksOfChunk(blocks: DocBlock[], chunkContent: string): DocBlock[] {
  const c = norm(chunkContent); if (!c) return [];
  return blocks.filter((b) => { if (b.type === "heading") return false; const t = norm(b.text); return t.length > 0 && (c.includes(t) || (t.length > c.length && t.includes(c))); });
}
/** Best block for a text among candidates; ties and zero scores fall back to the first candidate that has an id. */
export function bestBlock(cands: DocBlock[], text: string): DocBlock | null {
  let best: DocBlock | null = null; let bestScore = 0;
  for (const b of cands) { if (!b.id) continue; const s = overlapScore(text, b.text); if (s > bestScore) { best = b; bestScore = s; } }
  return best ?? cands.find((b) => b.id) ?? null;
}
/** Sentences (or list items / lines) of an answer that carry the marker `[n]`, without the markers themselves. */
export function citingSentences(answer: string, n: number): string {
  const marker = `[${n}]`; const out: string[] = [];
  for (const line of answer.split(/\n+/)) {
    if (!line.includes(marker)) continue;
    for (const s of line.split(/(?<=[.!?…])\s+(?=[^\[\s])/)) if (s.includes(marker)) out.push(s);
  }
  // a marker placed at the start of the following sentence ("… text. [1] Next") still belongs to what precedes: fall back to its line
  return out.join(" ").replace(/\[\d{1,3}\]/g, " ").replace(/\s+/g, " ").replace(/ ([.,;:!?])/g, "$1").trim();
}
