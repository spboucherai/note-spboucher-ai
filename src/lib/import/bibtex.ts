/** BibTeX → references (dedupe by DOI / cite key, same rules as src/lib/research/references.ts importBibtex, which is Next-only). */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseBibtex } from "@/lib/research/bibtex";
import type { ImportCtx } from "./pages";
const R = schema.researchReferences;
export async function importBibtexRefs(ctx: ImportCtx, text: string, pageId: string | null) {
  const parsed = parseBibtex(text);
  const existing = await db.select({ id: R.id, citeKey: R.citeKey, doi: R.doi }).from(R).where(and(eq(R.workspaceId, ctx.workspaceId), isNull(R.deletedAt)));
  const byDoi = new Map(existing.filter((e) => e.doi).map((e) => [e.doi!, e])); const byKey = new Map(existing.map((e) => [e.citeKey.toLowerCase(), e]));
  const created: string[] = []; const skipped: { citeKey: string; reason: string }[] = []; const seen = new Set<string>();
  for (const p of parsed) {
    const dup = (p.doi && byDoi.get(p.doi)) || byKey.get(p.citeKey.toLowerCase());
    if (dup) { skipped.push({ citeKey: p.citeKey, reason: p.doi && byDoi.get(p.doi) ? `DOI already stored as ${dup.citeKey}` : "cite key already exists" }); continue; }
    const sig = p.doi ?? p.citeKey.toLowerCase(); if (seen.has(sig)) { skipped.push({ citeKey: p.citeKey, reason: "duplicate inside file" }); continue; } seen.add(sig);
    const [r] = await db.insert(R).values({ workspaceId: ctx.workspaceId, pageId, citeKey: p.citeKey, entryType: p.entryType, title: p.title, authors: p.authors, year: p.year, journal: p.journal, doi: p.doi, url: p.url, fields: p.fields, verified: "user", bibtex: p.bibtex }).returning({ id: R.id, citeKey: R.citeKey, doi: R.doi });
    created.push(r.id); if (r.doi) byDoi.set(r.doi, r); byKey.set(r.citeKey.toLowerCase(), r); ctx.stats.references++;
  }
  return { created: created.length, skipped, parsed: parsed.length };
}
