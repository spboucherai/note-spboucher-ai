/** References service: CRUD, BibTeX import/export, Crossref DOI lookup, PDF attach. */
import { and, asc, desc, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/auth/guard";
import { parseBibtex, formatBibtex, fieldsOf, makeCiteKey, normDoi, type ParsedRef } from "./bibtex";
const R = schema.researchReferences;
export type ReferenceRow = typeof R.$inferSelect;
export type Verified = "user" | "doi_verified" | "ai_suggested";

export async function listReferences(wsId: string, opts: { pageId?: string | null; ids?: string[] } = {}) {
  return db.select().from(R).where(and(eq(R.workspaceId, wsId), isNull(R.deletedAt), opts.pageId ? eq(R.pageId, opts.pageId) : undefined, opts.ids?.length ? inArray(R.id, opts.ids) : undefined)).orderBy(desc(R.year), asc(R.citeKey));
}
export async function getReference(wsId: string, id: string) {
  const [r] = await db.select().from(R).where(and(eq(R.id, id), eq(R.workspaceId, wsId), isNull(R.deletedAt))); if (!r) throw new HttpError(404, "Reference not found"); return r;
}
/** Make a cite key unique in the workspace (gorton2019 → gorton2019a …). */
async function uniqueKey(wsId: string, base: string, excludeId?: string) {
  const key = base.replace(/[^A-Za-z0-9:_\-.]/g, "") || "ref";
  const rows = await db.select({ citeKey: R.citeKey, id: R.id }).from(R).where(and(eq(R.workspaceId, wsId), dsql`${R.citeKey} like ${key + "%"}`));
  const taken = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.citeKey));
  if (!taken.has(key)) return key;
  for (let i = 0; i < 26; i++) { const k = key + String.fromCharCode(97 + i); if (!taken.has(k)) return k; }
  return `${key}-${Date.now().toString(36)}`;
}
export interface ReferenceInput { pageId?: string | null; citeKey?: string | null; entryType?: string; title: string; authors?: string[]; year?: number | null; journal?: string | null; doi?: string | null; url?: string | null; fields?: Record<string, unknown>; verified?: Verified; attachmentId?: string | null; bibtex?: string | null }
export async function createReference(wsId: string, input: ReferenceInput) {
  const doi = normDoi(input.doi); const entryType = input.entryType ?? "article"; const authors = input.authors ?? [];
  const base = input.citeKey?.trim() || makeCiteKey(authors, input.year ?? null, input.title);
  const citeKey = await uniqueKey(wsId, base);
  const fields = fieldsOf({ ...input, entryType, authors, doi, fields: input.fields });
  const [r] = await db.insert(R).values({ workspaceId: wsId, pageId: input.pageId ?? null, citeKey, entryType, title: input.title.trim(), authors, year: input.year ?? null, journal: input.journal ?? null, doi, url: input.url ?? (doi ? `https://doi.org/${doi}` : null), fields, bibtex: input.bibtex ?? formatBibtex({ citeKey, entryType, fields }), verified: input.verified ?? "user", attachmentId: input.attachmentId ?? null }).returning();
  return r;
}
export async function updateReference(wsId: string, id: string, patch: Partial<ReferenceInput>) {
  const prev = await getReference(wsId, id);
  const set: Partial<ReferenceRow> = { updatedAt: new Date() };
  if (patch.citeKey !== undefined && patch.citeKey && patch.citeKey !== prev.citeKey) set.citeKey = await uniqueKey(wsId, patch.citeKey, id);
  for (const k of ["pageId", "entryType", "title", "authors", "year", "journal", "url", "verified", "attachmentId"] as const) if (patch[k] !== undefined) (set as any)[k] = patch[k];
  if (patch.doi !== undefined) set.doi = normDoi(patch.doi);
  if (patch.fields !== undefined) set.fields = { ...((prev.fields as any) ?? {}), ...patch.fields };
  const merged = { ...prev, ...set } as ReferenceRow;
  set.fields = fieldsOf({ title: merged.title, authors: merged.authors, year: merged.year, journal: merged.journal, doi: merged.doi, url: merged.url, entryType: merged.entryType, fields: (set.fields ?? merged.fields) as Record<string, unknown> });
  set.bibtex = formatBibtex({ citeKey: set.citeKey ?? merged.citeKey, entryType: merged.entryType, fields: set.fields as Record<string, unknown> });
  const [r] = await db.update(R).set(set).where(eq(R.id, id)).returning(); return r;
}
export async function deleteReference(wsId: string, id: string) { await db.update(R).set({ deletedAt: new Date() }).where(and(eq(R.id, id), eq(R.workspaceId, wsId))); }
export async function attachPdf(wsId: string, id: string, attachmentId: string | null) {
  if (attachmentId) { const [a] = await db.select({ id: schema.attachments.id }).from(schema.attachments).where(and(eq(schema.attachments.id, attachmentId), eq(schema.attachments.workspaceId, wsId), isNull(schema.attachments.deletedAt))); if (!a) throw new HttpError(404, "Attachment not found"); }
  const [r] = await db.update(R).set({ attachmentId, updatedAt: new Date() }).where(and(eq(R.id, id), eq(R.workspaceId, wsId))).returning(); return r;
}

/** Import BibTeX text: dedupe by DOI then by cite key (existing rows are kept, not overwritten). */
export async function importBibtex(wsId: string, text: string, pageId: string | null) {
  const parsed = parseBibtex(text);
  const existing = await db.select({ id: R.id, citeKey: R.citeKey, doi: R.doi }).from(R).where(and(eq(R.workspaceId, wsId), isNull(R.deletedAt)));
  const byDoi = new Map(existing.filter((e) => e.doi).map((e) => [e.doi!, e])); const byKey = new Map(existing.map((e) => [e.citeKey.toLowerCase(), e]));
  const created: ReferenceRow[] = []; const skipped: { citeKey: string; reason: string }[] = []; const seen = new Set<string>();
  for (const p of parsed) {
    const dup = (p.doi && byDoi.get(p.doi)) || byKey.get(p.citeKey.toLowerCase());
    if (dup) { skipped.push({ citeKey: p.citeKey, reason: p.doi && byDoi.get(p.doi) ? `DOI already stored as ${dup.citeKey}` : "cite key already exists" }); continue; }
    const sig = p.doi ?? p.citeKey.toLowerCase(); if (seen.has(sig)) { skipped.push({ citeKey: p.citeKey, reason: "duplicate inside file" }); continue; } seen.add(sig);
    const r = await createReference(wsId, { pageId, citeKey: p.citeKey, entryType: p.entryType, title: p.title, authors: p.authors, year: p.year, journal: p.journal, doi: p.doi, url: p.url, fields: p.fields, verified: "user", bibtex: p.bibtex });
    created.push(r); if (r.doi) byDoi.set(r.doi, r); byKey.set(r.citeKey.toLowerCase(), r);
  }
  return { created, skipped, parsed: parsed.length };
}
export async function exportBibtex(wsId: string, pageId?: string | null) {
  const rows = await listReferences(wsId, { pageId }); const sorted = [...rows].sort((a, b) => a.citeKey.localeCompare(b.citeKey));
  return sorted.map((r) => r.bibtex ?? formatBibtex({ citeKey: r.citeKey, entryType: r.entryType, fields: fieldsOf(r) })).join("\n\n") + (sorted.length ? "\n" : "");
}

/** Crossref metadata (polite pool). */
export interface DoiMeta { doi: string; title: string; authors: string[]; year: number | null; journal: string | null; entryType: string; url: string; fields: Record<string, string>; citeKey: string }
const UA = "NoteSPBoucherAI/1.0 (https://note.spboucher.ai; mailto:spbou4@icloud.com)";
const TYPE_MAP: Record<string, string> = { "journal-article": "article", "book": "book", "book-chapter": "incollection", "proceedings-article": "inproceedings", "posted-content": "misc", "report": "techreport", "dissertation": "phdthesis", "monograph": "book" };
export async function lookupDoi(raw: string): Promise<DoiMeta> {
  const doi = normDoi(raw); if (!doi) throw new HttpError(400, "Invalid DOI");
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000);
  let res: Response;
  try { res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctl.signal }); }
  catch (e) { throw new HttpError(502, "Crossref unreachable: " + String((e as any)?.message ?? e).slice(0, 120)); } finally { clearTimeout(t); }
  if (res.status === 404) throw new HttpError(404, "DOI not found on Crossref");
  if (!res.ok) throw new HttpError(502, `Crossref error ${res.status}`);
  const m = (await res.json())?.message; if (!m) throw new HttpError(502, "Crossref: empty response");
  const authors: string[] = (m.author ?? []).map((a: any) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean);
  const dateParts = m["published-print"]?.["date-parts"]?.[0] ?? m["published-online"]?.["date-parts"]?.[0] ?? m.issued?.["date-parts"]?.[0] ?? m.created?.["date-parts"]?.[0];
  const year = dateParts?.[0] ? Number(dateParts[0]) : null;
  const title = String(m.title?.[0] ?? "").replace(/\s+/g, " ").trim() || "Untitled";
  const journal = m["container-title"]?.[0] ?? m.publisher ?? null;
  const entryType = TYPE_MAP[m.type] ?? "misc";
  const fields: Record<string, string> = {};
  if (m.volume) fields.volume = String(m.volume); if (m.issue) fields.number = String(m.issue); if (m.page) fields.pages = String(m.page).replace(/-/g, "--"); if (m.publisher) fields.publisher = String(m.publisher);
  if (m.abstract) fields.abstract = String(m.abstract).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (m.ISSN?.[0]) fields.issn = m.ISSN[0]; if (m.subject?.length) fields.keywords = m.subject.slice(0, 8).join(", ");
  return { doi, title, authors, year, journal, entryType, url: `https://doi.org/${doi}`, fields, citeKey: makeCiteKey(authors, year, title) };
}
export async function addByDoi(wsId: string, raw: string, pageId: string | null) {
  const meta = await lookupDoi(raw);
  const [dup] = await db.select().from(R).where(and(eq(R.workspaceId, wsId), isNull(R.deletedAt), eq(R.doi, meta.doi)));
  if (dup) { if (pageId && !dup.pageId) return updateReference(wsId, dup.id, { pageId }); return dup; }
  return createReference(wsId, { pageId, citeKey: meta.citeKey, entryType: meta.entryType, title: meta.title, authors: meta.authors, year: meta.year, journal: meta.journal, doi: meta.doi, url: meta.url, fields: meta.fields, verified: "doi_verified" });
}
/** Re-verify an existing reference against Crossref (fills missing fields, marks doi_verified). */
export async function verifyReference(wsId: string, id: string) {
  const r = await getReference(wsId, id); if (!r.doi) throw new HttpError(400, "Reference has no DOI");
  const meta = await lookupDoi(r.doi);
  return updateReference(wsId, id, { title: r.title || meta.title, authors: r.authors?.length ? r.authors : meta.authors, year: r.year ?? meta.year, journal: r.journal ?? meta.journal, fields: { ...meta.fields, ...((r.fields as any) ?? {}) }, verified: "doi_verified", url: r.url ?? meta.url });
}
export type { ParsedRef };
