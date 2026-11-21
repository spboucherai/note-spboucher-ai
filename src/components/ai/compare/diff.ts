/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/ai/compare/diff.ts
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
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

/** Sentence-level "unique to this answer" diff using word-set overlap (no dependency). */
const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "with", "that", "this", "it", "as", "be", "by", "at", "le", "la", "les", "de", "des", "du", "un", "une", "et", "en", "est", "que", "qui", "pour", "dans", "sur", "au", "aux"]);
export function sentences(text: string): string[] { return text.replace(/```[\s\S]*?```/g, (m) => m.replace(/\n/g, " ")).split(/(?<=[.!?:;])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 0); }
export function words(s: string): Set<string> { return new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w))); }
function overlap(a: Set<string>, b: Set<string>) { if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.min(a.size, b.size); }
/** Returns, for `text`, each sentence with `unique = true` when no sentence of any `others` shares ≥ 60 % of its content words. */
export function uniqueSentences(text: string, others: string[], threshold = 0.4): { s: string; unique: boolean }[] {
  const otherSets = others.flatMap((o) => sentences(o).map(words)).filter((w) => w.size > 0);
  return sentences(text).map((s) => { const w = words(s); if (w.size < 2) return { s, unique: false }; return { s, unique: !otherSets.some((o) => overlap(w, o) >= threshold) }; });
}
