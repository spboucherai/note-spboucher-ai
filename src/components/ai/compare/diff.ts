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
