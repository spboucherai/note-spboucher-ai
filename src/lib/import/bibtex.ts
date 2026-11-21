/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/import/bibtex.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-17
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
 * BibTeX → references. Duplicates are recognised by DOI, then by cite key (same rules as src/lib/research/references.ts importBibtex,
 * which is Next-only). Every BibTeX field is kept in `fields`, the entry as written in `bibtex`.
 *  - duplicates = "skip": an entry already stored is left alone (reported with the reason);
 *  - duplicates = "import": it is added again under a free cite key (`key` → `keya`), never overwriting the stored one.
 */
import { and, eq, isNotNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseBibtex, type ParsedRef } from "@/lib/research/bibtex";
import { claimItem, tick, ImportError, type ImportCtx } from "./pages";
const R = schema.researchReferences;

export function parseBibtexSafe(text: string): ParsedRef[] {
  try { return parseBibtex(text); } catch (e) { throw new ImportError((e as Error).message || "Could not parse BibTeX", 400, "bibtex_parse"); }
}
export interface RefDuplicate { citeKey: string; reason: string; existingKey?: string }
/** Which parsed entries are already stored (or repeated inside the file). Pure given the existing keys — shared with the preview. */
export function bibDuplicates(parsed: ParsedRef[], existing: { citeKey: string; doi: string | null }[]): { fresh: ParsedRef[]; duplicates: (RefDuplicate & { entry: ParsedRef; inFile: boolean })[] } {
  const byDoi = new Map(existing.filter((e) => e.doi).map((e) => [e.doi!.toLowerCase(), e])); const byKey = new Map(existing.map((e) => [e.citeKey.toLowerCase(), e]));
  const seen = new Set<string>(); const fresh: ParsedRef[] = []; const duplicates: (RefDuplicate & { entry: ParsedRef; inFile: boolean })[] = [];
  for (const p of parsed) {
    const sig = p.doi ?? `key:${p.citeKey.toLowerCase()}`;
    if (seen.has(sig) || seen.has(`key:${p.citeKey.toLowerCase()}`)) { duplicates.push({ entry: p, citeKey: p.citeKey, reason: "repeated inside the file — only the first occurrence is used", inFile: true }); continue; }
    seen.add(sig); seen.add(`key:${p.citeKey.toLowerCase()}`);
    const d = p.doi ? byDoi.get(p.doi) : undefined; const k = byKey.get(p.citeKey.toLowerCase());
    if (d) duplicates.push({ entry: p, citeKey: p.citeKey, existingKey: d.citeKey, reason: `same DOI as the stored reference “${d.citeKey}”`, inFile: false });
    else if (k) duplicates.push({ entry: p, citeKey: p.citeKey, existingKey: k.citeKey, reason: "a reference with this cite key is already stored", inFile: false });
    else fresh.push(p);
  }
  return { fresh, duplicates };
}

export async function importBibtexRefs(ctx: ImportCtx, text: string, pageId: string | null, keyPrefix = "bib") {
  const parsed = parseBibtexSafe(text);
  const all = await db.select({ id: R.id, citeKey: R.citeKey, doi: R.doi, deletedAt: R.deletedAt }).from(R).where(eq(R.workspaceId, ctx.workspaceId));
  // references created by an earlier attempt of this job are not "existing"
  const mine = ctx.ledger?.ids() ?? new Set<string>();
  const live = all.filter((e) => !e.deletedAt && !mine.has(e.id));
  const taken = new Set(all.filter((e) => !e.deletedAt).map((e) => e.citeKey.toLowerCase()));
  const trashed = new Set(all.filter((e) => e.deletedAt).map((e) => e.citeKey));
  const { fresh, duplicates } = bibDuplicates(parsed, live);
  const skipped: RefDuplicate[] = duplicates.filter((d) => d.inFile || ctx.duplicates === "skip").map(({ citeKey, reason, existingKey }) => ({ citeKey, reason, existingKey }));
  const todo: { p: ParsedRef; again: boolean }[] = [...fresh.map((p) => ({ p, again: false })), ...(ctx.duplicates === "import" ? duplicates.filter((d) => !d.inFile).map((d) => ({ p: d.entry, again: true })) : [])];
  const created: string[] = []; const renamed: { from: string; to: string }[] = [];
  for (const { p, again } of todo) {
    const lk = `ref:${keyPrefix}:${p.citeKey.toLowerCase()}`;
    const c = await claimItem(ctx, lk, async (id) => (await db.select({ id: R.id }).from(R).where(and(eq(R.id, id), eq(R.workspaceId, ctx.workspaceId))))[0]);
    if (c.row) { created.push(c.row.id); ctx.stats.references++; await tick(ctx, `Reference ${p.citeKey}`); continue; }
    let citeKey = p.citeKey; let bibtex = p.bibtex;
    if (again || taken.has(citeKey.toLowerCase())) {
      let k = ""; for (let i = 0; i < 26 && !k; i++) { const cand = p.citeKey + String.fromCharCode(97 + i); if (!taken.has(cand.toLowerCase()) && !trashed.has(cand)) k = cand; }
      citeKey = k || `${p.citeKey}-${Date.now().toString(36)}`; renamed.push({ from: p.citeKey, to: citeKey });
      bibtex = bibtex.replace(/^(\s*@\s*[A-Za-z]+\s*[{(]\s*)[^,\s]+/, (_m, head: string) => head + citeKey);
    }
    // the unique index also covers deleted rows: move a trashed reference out of the way instead of failing or renaming the new one
    if (trashed.has(citeKey)) { await db.update(R).set({ citeKey: dsql`${R.citeKey} || '~' || left(${R.id}::text, 8)` }).where(and(eq(R.workspaceId, ctx.workspaceId), eq(R.citeKey, citeKey), isNotNull(R.deletedAt))); trashed.delete(citeKey); }
    const [r] = await db.insert(R).values({ ...(c.id ? { id: c.id } : {}), workspaceId: ctx.workspaceId, pageId, citeKey, entryType: p.entryType, title: p.title, authors: p.authors, year: p.year, journal: p.journal, doi: p.doi, url: p.url, fields: p.fields, verified: "user", bibtex }).returning({ id: R.id });
    created.push(r.id); taken.add(citeKey.toLowerCase()); ctx.stats.references++;
    await tick(ctx, `Reference ${citeKey}`);
  }
  if (skipped.length) ctx.stats.duplicates += skipped.length;
  for (const r of renamed) ctx.stats.skipped.push(`${r.from} was already stored — imported again as ${r.to}`);
  return { created: created.length, skipped, renamed, parsed: parsed.length };
}
