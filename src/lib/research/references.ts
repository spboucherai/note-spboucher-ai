/**
 * References service: CRUD, BibTeX import/export, Crossref DOI lookup, PDF attach, extracts, links to pages and experiments.
 *
 * Metadata rule: `fields` holds every BibTeX tag exactly as imported (LaTeX, protective braces, name particles, unknown tags) and is never
 * rebuilt from the structured columns. An edit only touches the tags whose value the user actually changed; `bibtex` (the entry as
 * imported) is regenerated only when something bibliographic changed. Application data kept in `fields` (`extracts`) is never written
 * to a .bib and can only be changed through its own functions.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { absPath } from "@/lib/files/storage";
import { parseBibtexDetailed, formatBibtex, fieldsOf, makeCiteKey, normDoi, bibAuthor, venueTag, bibFile, APP_FIELDS, type ParsedRef } from "./bibtex";
import { extractsOf, EXTRACT_LIMITS, type Extract } from "./cite";
const R = schema.researchReferences;
export type ReferenceRow = typeof R.$inferSelect;
export type Verified = "user" | "doi_verified" | "ai_suggested";

export async function listReferences(wsId: string, opts: { pageId?: string | null; ids?: string[] } = {}) {
  return db.select().from(R).where(and(eq(R.workspaceId, wsId), isNull(R.deletedAt), opts.pageId ? eq(R.pageId, opts.pageId) : undefined, opts.ids?.length ? inArray(R.id, opts.ids) : undefined)).orderBy(desc(R.year), asc(R.citeKey));
}
export async function getReference(wsId: string, id: string) {
  const [r] = await db.select().from(R).where(and(eq(R.id, id), eq(R.workspaceId, wsId), isNull(R.deletedAt))); if (!r) throw new HttpError(404, "Reference not found", "not_found"); return r;
}
/** Make a cite key unique in the workspace (gorton2019 → gorton2019a …). A deleted reference never blocks its old key. */
async function uniqueKey(wsId: string, base: string, excludeId?: string) {
  const key = base.replace(/[^A-Za-z0-9:_\-.]/g, "") || "ref";
  // the unique index also covers deleted rows: move a trashed holder of this exact key out of the way
  await db.update(R).set({ citeKey: dsql`${R.citeKey} || '~' || left(${R.id}::text, 8)` }).where(and(eq(R.workspaceId, wsId), eq(R.citeKey, key), isNotNull(R.deletedAt)));
  const rows = await db.select({ citeKey: R.citeKey, id: R.id }).from(R).where(and(eq(R.workspaceId, wsId), dsql`${R.citeKey} like ${key.replace(/[%_\\]/g, "\\$&") + "%"}`));
  const taken = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.citeKey));
  if (!taken.has(key)) return key;
  for (let i = 0; i < 26; i++) { const k = key + String.fromCharCode(97 + i); if (!taken.has(k)) return k; }
  return `${key}-${Date.now().toString(36)}`;
}
const plainName = (a: string) => a.replace(/^\{(.*)\}$/, "$1").replace(/\s+/g, " ").trim();
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface ReferenceInput { pageId?: string | null; citeKey?: string | null; entryType?: string; title: string; authors?: string[]; year?: number | null; journal?: string | null; doi?: string | null; url?: string | null; fields?: Record<string, unknown>; verified?: Verified; attachmentId?: string | null; bibtex?: string | null }
export async function createReference(wsId: string, input: ReferenceInput) {
  const doi = normDoi(input.doi); const entryType = input.entryType ?? "article"; const rawAuthors = (input.authors ?? []).map((a) => a.trim()).filter(Boolean); const authors = rawAuthors.map(plainName);
  const base = input.citeKey?.trim() || makeCiteKey(authors, input.year ?? null, input.title);
  const citeKey = await uniqueKey(wsId, base);
  const given: Record<string, unknown> = {}; for (const [k, v] of Object.entries(input.fields ?? {})) if (!APP_FIELDS.has(k) && v != null && String(v).trim() !== "") given[k] = v;
  if (rawAuthors.length && given.author == null && given.editor == null) given.author = rawAuthors.map(bibAuthor).join(" and ");
  const fields = fieldsOf({ title: input.title.trim(), authors, year: input.year ?? null, journal: input.journal ?? null, doi, url: input.url ?? null, entryType, fields: given });
  // the entry as imported is kept only when it carries the key we store
  const bibtex = input.bibtex && citeKey === input.citeKey?.trim() ? input.bibtex : formatBibtex({ citeKey, entryType, fields });
  const [r] = await db.insert(R).values({ workspaceId: wsId, pageId: input.pageId ?? null, citeKey, entryType, title: input.title.trim(), authors, year: input.year ?? null, journal: input.journal ?? null, doi, url: input.url ?? (doi ? `https://doi.org/${doi}` : null), fields, bibtex, verified: input.verified ?? "user", attachmentId: input.attachmentId ?? null }).returning();
  return r;
}
export async function updateReference(wsId: string, id: string, patch: Partial<ReferenceInput>) {
  const prev = await getReference(wsId, id);
  const set: Partial<ReferenceRow> = { updatedAt: new Date() };
  const fields: Record<string, unknown> = { ...((prev.fields as Record<string, unknown>) ?? {}) };
  let biblio = false; // did anything that belongs in the .bib change?
  if (patch.citeKey !== undefined && patch.citeKey && patch.citeKey.trim() !== prev.citeKey) { set.citeKey = await uniqueKey(wsId, patch.citeKey.trim(), id); biblio = true; }
  for (const k of ["pageId", "verified", "attachmentId"] as const) if (patch[k] !== undefined) (set as any)[k] = patch[k];
  if (patch.entryType !== undefined && patch.entryType !== prev.entryType) { set.entryType = patch.entryType; biblio = true; }
  // explicit tag edits: an empty value removes the tag, anything else replaces it; tags that are not mentioned are untouched
  for (const [k, v] of Object.entries(patch.fields ?? {})) {
    if (APP_FIELDS.has(k)) continue;
    const empty = v == null || (typeof v === "string" && v.trim() === "");
    if (empty) { if (k in fields) { delete fields[k]; biblio = true; } } else if (!same(fields[k], typeof v === "string" ? v.trim() : v)) { fields[k] = typeof v === "string" ? v.trim() : v; biblio = true; }
  }
  // structured columns: a tag is rewritten only when its column really changed
  const put = (k: string, v: string | null) => { if (v == null || v === "") delete fields[k]; else fields[k] = v; biblio = true; };
  if (patch.title !== undefined && patch.title.trim() !== prev.title) { set.title = patch.title.trim(); put("title", set.title); }
  if (patch.authors !== undefined) { const raw = patch.authors.map((a) => a.trim()).filter(Boolean); const clean = raw.map(plainName); if (!same(clean, prev.authors ?? [])) { set.authors = clean; put(fields.author == null && fields.editor != null ? "editor" : "author", raw.length ? raw.map(bibAuthor).join(" and ") : null); } }
  if (patch.year !== undefined && patch.year !== prev.year) { set.year = patch.year; put("year", patch.year == null ? null : String(patch.year)); }
  if (patch.journal !== undefined && (patch.journal || null) !== (prev.journal ?? null)) { set.journal = patch.journal || null; put(venueTag(set.entryType ?? prev.entryType, fields), set.journal); }
  if (patch.doi !== undefined) { const doi = normDoi(patch.doi); if (doi !== (prev.doi ?? null)) { set.doi = doi; put("doi", doi); } }
  if (patch.url !== undefined && (patch.url || null) !== (prev.url ?? null)) { set.url = patch.url || null; put("url", set.url); }
  if (biblio) {
    const merged = { ...prev, ...set } as ReferenceRow;
    set.fields = fieldsOf({ title: merged.title, authors: merged.authors, year: merged.year, journal: merged.journal, doi: merged.doi, url: merged.url, entryType: merged.entryType, fields });
    set.bibtex = formatBibtex({ citeKey: merged.citeKey, entryType: merged.entryType, fields: set.fields as Record<string, unknown> });
  }
  const [r] = await db.update(R).set(set).where(and(eq(R.id, id), eq(R.workspaceId, wsId))).returning(); return r;
}
export async function deleteReference(wsId: string, id: string) { await db.update(R).set({ deletedAt: new Date() }).where(and(eq(R.id, id), eq(R.workspaceId, wsId))); }
/** Undo of a delete (the Undo toast). */
export async function restoreReference(wsId: string, id: string) {
  const [r] = await db.update(R).set({ deletedAt: null, updatedAt: new Date() }).where(and(eq(R.id, id), eq(R.workspaceId, wsId))).returning(); if (!r) throw new HttpError(404, "Reference not found", "not_found"); return r;
}
export async function attachPdf(wsId: string, id: string, attachmentId: string | null) {
  if (attachmentId) { const [a] = await db.select({ id: schema.attachments.id }).from(schema.attachments).where(and(eq(schema.attachments.id, attachmentId), eq(schema.attachments.workspaceId, wsId), isNull(schema.attachments.deletedAt))); if (!a) throw new HttpError(404, "Attachment not found", "not_found"); }
  const [r] = await db.update(R).set({ attachmentId, updatedAt: new Date() }).where(and(eq(R.id, id), eq(R.workspaceId, wsId), isNull(R.deletedAt))).returning(); if (!r) throw new HttpError(404, "Reference not found", "not_found"); return r;
}

export interface BibImportReport { parsed: number; created: ReferenceRow[]; wouldCreate: { citeKey: string; title: string; year: number | null }[]; skipped: { citeKey: string; reason: string; existingKey?: string }[]; failed: { citeKey: string; reason: string }[] }
/**
 * Import BibTeX text. Duplicates are recognised by DOI first, then by cite key; a stored reference is never overwritten.
 * `dryRun` reports what would happen without writing. Entries that cannot be parsed are listed in `failed`, never dropped silently.
 */
export async function importBibtex(wsId: string, text: string, pageId: string | null, opts: { dryRun?: boolean } = {}): Promise<BibImportReport> {
  const { entries: parsed, errors } = parseBibtexDetailed(text);
  if (!parsed.length && errors.length) throw new HttpError(400, `This is not readable BibTeX — ${errors.slice(0, 2).map((e) => `${e.citeKey}: ${e.reason}`).join("; ")}`, "bibtex_parse", { failed: errors.slice(0, 50) });
  if (!parsed.length) throw new HttpError(400, "No BibTeX entry found (an entry looks like @article{key, title = {…}, …}).", "bibtex_empty");
  const existing = await db.select({ id: R.id, citeKey: R.citeKey, doi: R.doi }).from(R).where(and(eq(R.workspaceId, wsId), isNull(R.deletedAt)));
  const byDoi = new Map(existing.filter((e) => e.doi).map((e) => [e.doi!.toLowerCase(), e])); const byKey = new Map(existing.map((e) => [e.citeKey.toLowerCase(), e]));
  const out: BibImportReport = { parsed: parsed.length + errors.length, created: [], wouldCreate: [], skipped: [], failed: errors }; const seen = new Set<string>();
  for (const p of parsed) {
    const d = p.doi ? byDoi.get(p.doi) : undefined; const k = byKey.get(p.citeKey.toLowerCase());
    if (d) { out.skipped.push({ citeKey: p.citeKey, existingKey: d.citeKey, reason: `same DOI as “${d.citeKey}”, already in your library` }); continue; }
    if (k) { out.skipped.push({ citeKey: p.citeKey, existingKey: k.citeKey, reason: "this cite key is already in your library" }); continue; }
    const sigs = [p.doi ? `doi:${p.doi}` : "", `key:${p.citeKey.toLowerCase()}`].filter(Boolean);
    if (sigs.some((s) => seen.has(s))) { out.skipped.push({ citeKey: p.citeKey, reason: "repeated inside this BibTeX — the first occurrence is used" }); continue; }
    sigs.forEach((s) => seen.add(s));
    if (opts.dryRun) { out.wouldCreate.push({ citeKey: p.citeKey, title: p.title, year: p.year }); continue; }
    const r = await createReference(wsId, { pageId, citeKey: p.citeKey, entryType: p.entryType, title: p.title, authors: p.authors, year: p.year, journal: p.journal, doi: p.doi, url: p.url, fields: p.fields, verified: "user", bibtex: p.bibtex });
    out.created.push(r);
  }
  return out;
}
export async function exportBibtex(wsId: string, pageId?: string | null) { return bibFile(await listReferences(wsId, { pageId })); }

/** Crossref metadata. */
export interface DoiMeta { doi: string; title: string; authors: string[]; year: number | null; journal: string | null; entryType: string; url: string; fields: Record<string, string>; citeKey: string }
/**
 * Crossref asks automated clients to identify themselves; a contact address puts the client in its "polite pool".
 * The address is configuration, not code: set CROSSREF_MAILTO in the node's .env. Without it the public pool is used.
 */
const userAgent = () => { const contact = (process.env.CROSSREF_MAILTO ?? "").trim(); return `NoteSPBoucherAI/2.0 (${(process.env.APP_URL ?? "").replace(/\/$/, "") || "self-hosted notes app"}${contact ? `; mailto:${contact}` : ""})`; };
const TYPE_MAP: Record<string, string> = { "journal-article": "article", "book": "book", "book-chapter": "incollection", "proceedings-article": "inproceedings", "posted-content": "misc", "report": "techreport", "dissertation": "phdthesis", "monograph": "book" };
/**
 * Error codes the client branches on:
 *  invalid_doi (400) — not a DOI, fix the input · doi_not_found (404) — Crossref answered and does not know it (do not retry)
 *  crossref_unreachable (502/503/504) — network, timeout, rate limit or Crossref failure (retry later; the input is fine)
 */
export async function lookupDoi(raw: string): Promise<DoiMeta> {
  const doi = normDoi(raw); if (!doi) throw new HttpError(400, "This does not look like a DOI. A DOI starts with “10.” and contains a slash, e.g. 10.1016/j.jfineco.2019.09.005.", "invalid_doi");
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000);
  let res: Response;
  try { res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: ctl.signal }); }
  catch (e) { const timeout = (e as Error)?.name === "AbortError"; throw new HttpError(timeout ? 504 : 502, timeout ? "Crossref did not answer within 15 seconds. The DOI may be fine — try again." : "Crossref could not be reached from the server. The DOI may be fine — try again.", "crossref_unreachable", { retryable: true }); } finally { clearTimeout(t); }
  if (res.status === 404) throw new HttpError(404, `Crossref has no record for ${doi}. Check for a typo — DOIs registered with DataCite (datasets, some preprints) are not in Crossref: add the reference manually or paste its BibTeX.`, "doi_not_found");
  if (res.status === 429) throw new HttpError(503, "Crossref is rate-limiting requests right now. Wait a few seconds and try again.", "crossref_unreachable", { retryable: true });
  if (!res.ok) throw new HttpError(502, `Crossref answered with an error (${res.status}). The DOI may be fine — try again later.`, "crossref_unreachable", { retryable: true });
  const m = (await res.json().catch(() => null))?.message; if (!m) throw new HttpError(502, "Crossref sent an unreadable answer. Try again.", "crossref_unreachable", { retryable: true });
  const people: any[] = Array.isArray(m.author) && m.author.length ? m.author : Array.isArray(m.editor) ? m.editor : [];
  const authors: string[] = people.map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean);
  const dateParts = m["published-print"]?.["date-parts"]?.[0] ?? m["published-online"]?.["date-parts"]?.[0] ?? m.published?.["date-parts"]?.[0] ?? m.issued?.["date-parts"]?.[0] ?? m.created?.["date-parts"]?.[0];
  const year = dateParts?.[0] ? Number(dateParts[0]) : null;
  const strip = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const title = [strip(m.title?.[0]), strip(m.subtitle?.[0])].filter(Boolean).join(": ") || "Untitled";
  const journal = m["container-title"]?.[0] ?? m.publisher ?? null;
  const entryType = TYPE_MAP[m.type] ?? "misc";
  const fields: Record<string, string> = {};
  // family/given are known here: write the BibTeX name list exactly (institutions in braces) instead of guessing from "First Last"
  const bibNames = people.map((a) => (a.family ? `${a.family}${a.given ? `, ${a.given}` : ""}` : a.name ? `{${a.name}}` : "")).filter(Boolean).join(" and ");
  if (bibNames) fields[Array.isArray(m.author) && m.author.length ? "author" : "editor"] = bibNames;
  if (m.volume) fields.volume = String(m.volume); if (m.issue) fields.number = String(m.issue); if (m.page) fields.pages = String(m.page).replace(/-+/g, "--"); if (m.publisher) fields.publisher = String(m.publisher);
  if (m.abstract) fields.abstract = String(m.abstract).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (m.ISSN?.[0]) fields.issn = m.ISSN[0]; if (m.ISBN?.[0]) fields.isbn = m.ISBN[0]; if (m.subject?.length) fields.keywords = m.subject.slice(0, 8).join(", ");
  return { doi, title, authors, year, journal, entryType, url: `https://doi.org/${doi}`, fields, citeKey: makeCiteKey(authors, year, title) };
}
/** The stored reference with this DOI, if any (duplicates are recognised by DOI before anything is fetched or created). */
export async function findByDoi(wsId: string, raw: string) {
  const doi = normDoi(raw); if (!doi) return null;
  const [dup] = await db.select().from(R).where(and(eq(R.workspaceId, wsId), isNull(R.deletedAt), eq(R.doi, doi))); return dup ?? null;
}
/** Adds a reference from Crossref. When the DOI is already stored nothing is created: the stored reference is returned with `duplicate: true`. */
export async function addByDoi(wsId: string, raw: string, pageId: string | null): Promise<{ reference: ReferenceRow; duplicate: boolean; linked: boolean }> {
  const dup = await findByDoi(wsId, raw);
  if (dup) { if (pageId && !dup.pageId) return { reference: await updateReference(wsId, dup.id, { pageId }), duplicate: true, linked: true }; return { reference: dup, duplicate: true, linked: false }; }
  const meta = await lookupDoi(raw);
  const reference = await createReference(wsId, { pageId, citeKey: meta.citeKey, entryType: meta.entryType, title: meta.title, authors: meta.authors, year: meta.year, journal: meta.journal, doi: meta.doi, url: meta.url, fields: meta.fields, verified: "doi_verified" });
  return { reference, duplicate: false, linked: false };
}
/** Re-verify an existing reference against Crossref: fills tags that are missing (stored values always win), marks doi_verified. */
export async function verifyReference(wsId: string, id: string) {
  const r = await getReference(wsId, id); if (!r.doi) throw new HttpError(400, "This reference has no DOI to verify.", "invalid_doi");
  const meta = await lookupDoi(r.doi); const have = (r.fields as Record<string, unknown>) ?? {};
  const missing: Record<string, unknown> = {}; for (const [k, v] of Object.entries(meta.fields)) if (have[k] == null || String(have[k]).trim() === "") missing[k] = v;
  if (have.author != null || have.editor != null) { delete missing.author; delete missing.editor; }
  return updateReference(wsId, id, { ...(r.authors?.length ? {} : { authors: meta.authors }), ...(r.year ? {} : { year: meta.year }), ...(r.journal ? {} : { journal: meta.journal }), ...(r.url ? {} : { url: meta.url }), fields: missing, verified: "doi_verified" });
}

// ---------- extracts (quotes with page number and personal note) — references.fields.extracts
const clip = (s: string | null | undefined, n: number) => { const t = (s ?? "").trim(); return t ? t.slice(0, n) : null; };
async function writeExtracts(wsId: string, r: ReferenceRow, extracts: Extract[]) {
  const [row] = await db.update(R).set({ fields: { ...((r.fields as Record<string, unknown>) ?? {}), extracts }, updatedAt: new Date() }).where(and(eq(R.id, r.id), eq(R.workspaceId, wsId))).returning(); return row;
}
export async function addExtract(wsId: string, refId: string, input: { quote: string; page?: string | null; note?: string | null; id?: string }) {
  const r = await getReference(wsId, refId); const list = extractsOf(r.fields);
  const quote = clip(input.quote, EXTRACT_LIMITS.quote); if (!quote) throw new HttpError(400, "The quote is empty.", "validation");
  // a client-chosen id makes a retried request harmless (same extract, not a second one)
  const again = input.id ? list.find((e) => e.id === input.id) : undefined; if (again) return { reference: r, extract: again };
  if (list.length >= EXTRACT_LIMITS.perReference) throw new HttpError(400, `A reference holds at most ${EXTRACT_LIMITS.perReference} extracts.`, "limit");
  const extract: Extract = { id: input.id ?? randomUUID(), quote, page: clip(input.page, EXTRACT_LIMITS.page), note: clip(input.note, EXTRACT_LIMITS.note), createdAt: new Date().toISOString() };
  return { reference: await writeExtracts(wsId, r, [...list, extract]), extract };
}
export async function updateExtract(wsId: string, refId: string, extractId: string, patch: { quote?: string; page?: string | null; note?: string | null }) {
  const r = await getReference(wsId, refId); const list = extractsOf(r.fields); const cur = list.find((e) => e.id === extractId); if (!cur) throw new HttpError(404, "Extract not found", "not_found");
  const next: Extract = { ...cur, ...(patch.quote !== undefined ? { quote: clip(patch.quote, EXTRACT_LIMITS.quote) ?? cur.quote } : {}), ...(patch.page !== undefined ? { page: clip(patch.page, EXTRACT_LIMITS.page) } : {}), ...(patch.note !== undefined ? { note: clip(patch.note, EXTRACT_LIMITS.note) } : {}), updatedAt: new Date().toISOString() };
  return { reference: await writeExtracts(wsId, r, list.map((e) => (e.id === extractId ? next : e))), extract: next };
}
export async function deleteExtract(wsId: string, refId: string, extractId: string) {
  const r = await getReference(wsId, refId); const list = extractsOf(r.fields); const cur = list.find((e) => e.id === extractId); if (!cur) return { reference: r, extract: null };
  return { reference: await writeExtracts(wsId, r, list.filter((e) => e.id !== extractId)), extract: cur };
}
/** Puts a deleted extract back at its place (Undo). */
export async function restoreExtract(wsId: string, refId: string, extract: Extract) {
  const r = await getReference(wsId, refId); const list = extractsOf(r.fields); if (list.some((e) => e.id === extract.id)) return { reference: r, extract };
  const next = [...list, extract].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { reference: await writeExtracts(wsId, r, next), extract };
}

// ---------- links: pages that hold or cite the reference, their experiments, its PDF
export interface ReferenceLinks {
  attached: { id: string; title: string; icon: string | null; type: string } | null;
  citing: { id: string; title: string; icon: string | null; type: string }[];
  experiments: { id: string; name: string; status: string; pageId: string | null; pageTitle: string | null }[];
  pdf: { id: string; filename: string; size: number; pageCount: number | null; mime: string; available: boolean } | null;
}
export async function referenceLinks(wsId: string, id: string): Promise<ReferenceLinks> {
  const r = await getReference(wsId, id); const P = schema.pages;
  const cols = { id: P.id, title: P.title, icon: P.icon, type: P.type };
  const attached = r.pageId ? (await db.select(cols).from(P).where(and(eq(P.id, r.pageId), eq(P.workspaceId, wsId), isNull(P.deletedAt))))[0] ?? null : null;
  // the cite key as a whole token (\cite{a,key,b}, [@key], (key, p. 3)…) anywhere in the text of a page
  const rx = `(^|[^A-Za-z0-9:_.-])${r.citeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9:_-])`;
  const citing = (await db.select(cols).from(P).where(and(eq(P.workspaceId, wsId), isNull(P.deletedAt), dsql`${P.plainText} ~ ${rx}`)).orderBy(desc(P.updatedAt)).limit(100)).filter((p) => p.id !== attached?.id);
  const pageIds = [...new Set([...(attached ? [attached.id] : []), ...citing.map((p) => p.id)])];
  const titles = new Map([...(attached ? [attached] : []), ...citing].map((p) => [p.id, p.title]));
  const E = schema.experiments;
  const exps = pageIds.length ? await db.select({ id: E.id, name: E.name, status: E.status, pageId: E.pageId }).from(E).where(and(eq(E.workspaceId, wsId), inArray(E.pageId, pageIds))).orderBy(desc(E.updatedAt)).limit(100) : [];
  let pdf: ReferenceLinks["pdf"] = null;
  if (r.attachmentId) {
    const A = schema.attachments; const [a] = await db.select({ id: A.id, filename: A.filename, size: A.size, pageCount: A.pageCount, mime: A.mime, storagePath: A.storagePath, deletedAt: A.deletedAt }).from(A).where(and(eq(A.id, r.attachmentId), eq(A.workspaceId, wsId)));
    if (a) { let available = !a.deletedAt; try { available = available && fs.existsSync(absPath(a.storagePath)); } catch { available = false; } pdf = { id: a.id, filename: a.filename, size: a.size, pageCount: a.pageCount, mime: a.mime, available }; }
  }
  return { attached, citing, experiments: exps.map((e) => ({ ...e, pageTitle: e.pageId ? titles.get(e.pageId) ?? null : null })), pdf };
}
export type { ParsedRef, Extract };
