/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/research/bibtex.ts
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

/** BibTeX helpers: parse (bibtex-parse-js), normalise, format. Pure functions, no DB. */
import { toJSON } from "bibtex-parse-js";

export interface ParsedRef { citeKey: string; entryType: string; title: string; authors: string[]; year: number | null; journal: string | null; doi: string | null; url: string | null; fields: Record<string, string>; bibtex: string }

const stripBraces = (s: string) => s.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
const ACCENTS: Record<string, Record<string, string>> = { "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", c: "ć", n: "ń", s: "ś", z: "ź", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" }, "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È", U: "Ù" }, "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", O: "Ô" }, '"': { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ", A: "Ä", O: "Ö", U: "Ü" }, "~": { a: "ã", n: "ñ", o: "õ", A: "Ã", N: "Ñ", O: "Õ" }, c: { c: "ç", C: "Ç" }, v: { c: "č", s: "š", z: "ž", r: "ř", e: "ě", C: "Č", S: "Š", Z: "Ž" }, "=": { a: "ā", e: "ē", o: "ō" } };
const SPECIAL: Record<string, string> = { aa: "å", AA: "Å", o: "ø", O: "Ø", l: "ł", L: "Ł", ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ" };
export function cleanLatex(s: string) {
  let t = s.replace(/\\([`'^"~=cv])\s*\{?(\w)\}?/g, (_m, acc: string, ch: string) => ACCENTS[acc]?.[ch] ?? ch).replace(/\\(aa|AA|ae|AE|oe|OE|o|O|l|L|ss)\b\{?\}?/g, (_m, k: string) => SPECIAL[k] ?? k);
  t = t.replace(/\\(?:emph|textit|textbf|mkbibquote|url)\{([^}]*)\}/g, "$1").replace(/---?/g, "–").replace(/~/g, " ");
  return stripBraces(t);
}

/** "Last, First and First Last and {Bank of Canada}" → ["First Last", …] */
export function parseAuthors(s: string | undefined | null): string[] {
  if (!s) return [];
  return s.split(/\s+and\s+/i).map((a) => a.trim()).filter(Boolean).map((a) => {
    if (/^\{.*\}$/.test(a)) return stripBraces(a);
    const parts = a.split(",").map((x) => cleanLatex(x));
    if (parts.length >= 2) return `${parts[1]} ${parts[0]}`.replace(/\s+/g, " ").trim();
    return cleanLatex(a);
  });
}
export const lastName = (full: string) => { const p = full.trim().split(/\s+/); return p[p.length - 1] ?? ""; };
export const normDoi = (d: string | null | undefined) => { if (!d) return null; const m = d.trim().replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, ""); return /^10\.\d{4,9}\/\S+$/i.test(m) ? m.toLowerCase() : null; };

/** citeKey from authors/year/title: gorton2019does */
export function makeCiteKey(authors: string[], year: number | null, title: string) {
  const ln = (authors[0] ? lastName(authors[0]) : "anon").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z]/g, "").toLowerCase() || "anon";
  const w = title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2 && !STOP.has(x))[0] ?? "";
  return `${ln}${year ?? ""}${w}`;
}
const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "does", "are", "was", "how", "why", "what", "when", "into", "over", "under", "between", "des", "les", "une", "sur", "dans", "pour"]);

const MONTHS = new Set(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]);
/** `@string{jfe = "Journal of Financial Economics"}` definitions (bibtex-parse-js cannot expand them). */
export function readMacros(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/@string\s*[{(]\s*([A-Za-z][\w:.+-]*)\s*=\s*(?:"([^"]*)"|\{((?:[^{}]|\{[^{}]*\})*)\})\s*[})]/gi)) out.set(m[1].toLowerCase(), (m[2] ?? m[3] ?? "").trim());
  return out;
}
export interface RawEntry { entryType: string; citeKey: string; raw: string }
/** Splits a .bib source into its entries by brace matching (text between entries, @string, @preamble and @comment are not entries). */
export function splitEntries(src: string): { entries: RawEntry[]; errors: { citeKey: string; reason: string }[] } {
  const entries: RawEntry[] = []; const errors: { citeKey: string; reason: string }[] = [];
  const re = /@([A-Za-z]+)\s*([{(])/g; let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const type = m[1].toLowerCase(); const open = m[2]; const start = m.index; let i = re.lastIndex; let depth = 0; let end = -1;
    for (; i < src.length; i++) { const ch = src[i]; if (ch === "\\") { i++; continue; } if (ch === "{") depth++; else if (ch === "}") { if (depth === 0 && open === "{") { end = i; break; } depth--; } else if (ch === ")" && open === "(" && depth === 0) { end = i; break; } }
    const head = src.slice(re.lastIndex, end < 0 ? Math.min(src.length, re.lastIndex + 80) : end); const key = (head.match(/^\s*([^,\s]*)/)?.[1] ?? "").trim();
    if (end < 0) { if (!["string", "preamble", "comment"].includes(type)) errors.push({ citeKey: key || `@${type}`, reason: "unterminated entry (a closing brace is missing)" }); break; }
    re.lastIndex = end + 1;
    if (["string", "preamble", "comment"].includes(type)) continue;
    // normalise `@article( … )` to braces: the parser only knows the brace form
    const raw = open === "(" ? `@${m[1]}{${src.slice(m.index + m[0].length, end)}}` : src.slice(start, end + 1);
    entries.push({ entryType: type, citeKey: key, raw });
  }
  return { entries, errors };
}
/** Bare-word values: `journal = jfe` → the @string expansion, or the word in braces when it is not a known macro (keeps the entry parseable). */
function expandMacros(raw: string, macros: Map<string, string>): { text: string; changed: boolean } {
  let changed = false;
  const text = raw.replace(/^(\s*[A-Za-z][\w-]*\s*=\s*)([A-Za-z][\w:.+-]*)(\s*,?\s*\}?\s*)$/gm, (all, head: string, word: string, tail: string) => {
    const w = word.toLowerCase(); if (MONTHS.has(w) && !macros.has(w)) return all;
    changed = true; return `${head}{${macros.get(w) ?? word}}${tail}`;
  });
  return { text, changed };
}

export interface ParseReport { entries: ParsedRef[]; /** entries that could not be read — reported, never silently dropped */ errors: { citeKey: string; reason: string }[] }
/**
 * Every entry is parsed on its own: one malformed entry does not reject the file, it is listed in `errors`.
 * `fields` keeps every tag as written (lower-cased names, whitespace collapsed); `bibtex` keeps the entry as written
 * (re-formatted only when a @string macro had to be expanded).
 */
export function parseBibtexDetailed(src: string): ParseReport {
  const text = src.replace(/^\uFEFF/, "");
  const macros = readMacros(text); const { entries: raws, errors } = splitEntries(text);
  const out: ParsedRef[] = [];
  for (const r of raws) {
    const ex = expandMacros(r.raw, macros);
    let e: ReturnType<typeof toJSON>[number] | undefined;
    try { e = toJSON(ex.text)[0]; } catch (err) { errors.push({ citeKey: r.citeKey || `@${r.entryType}`, reason: String((err as any)?.message ?? err).replace(/\s+/g, " ").slice(0, 160) }); continue; }
    if (!e?.entryTags || !e.citationKey) { errors.push({ citeKey: r.citeKey || `@${r.entryType}`, reason: e && !e.citationKey ? "no cite key" : "no fields" }); continue; }
    const tags: Record<string, string> = {}; for (const [k, v] of Object.entries(e.entryTags)) tags[k.toLowerCase()] = String(v).replace(/\s+/g, " ").trim();
    const authors = parseAuthors(tags.author ?? tags.editor);
    const year = tags.year ? Number((tags.year.match(/\d{4}/) ?? [])[0]) || null : (tags.date ? Number((tags.date.match(/\d{4}/) ?? [])[0]) || null : null);
    const title = cleanLatex(tags.title ?? "") || "Untitled";
    const journal = cleanLatex(tags.journal ?? tags.journaltitle ?? tags.booktitle ?? tags.publisher ?? tags.institution ?? tags.school ?? "") || null;
    const doi = normDoi(tags.doi); if (doi) tags.doi = doi;
    const url = tags.url ?? (doi ? `https://doi.org/${doi}` : null);
    const citeKey = e.citationKey.trim() || makeCiteKey(authors, year, title);
    const entryType = e.entryType.toLowerCase();
    out.push({ citeKey, entryType, title, authors, year, journal, doi, url, fields: tags, bibtex: ex.changed ? formatBibtex({ citeKey, entryType, fields: tags }) : r.raw.trim() });
  }
  return { entries: out, errors };
}
export function parseBibtex(src: string): ParsedRef[] {
  const r = parseBibtexDetailed(src);
  if (!r.entries.length && r.errors.length) throw new Error(`Could not parse BibTeX: ${r.errors.slice(0, 3).map((e) => `${e.citeKey}: ${e.reason}`).join("; ")}`);
  return r.entries;
}

const ORDER = ["author", "editor", "title", "journal", "booktitle", "year", "volume", "number", "pages", "publisher", "institution", "school", "doi", "url", "abstract", "keywords", "note"];
/** Keys of `references.fields` that are application data, not BibTeX tags. */
export const APP_FIELDS = new Set(["extracts"]);
const isTag = (k: string, v: unknown) => !APP_FIELDS.has(k) && (typeof v === "string" || typeof v === "number") && String(v).trim() !== "";
/** Deterministic BibTeX entry. Only scalar tags are written (application data such as `extracts` stays out of the .bib). */
export function formatBibtex(e: { citeKey: string; entryType: string; fields: Record<string, unknown> }) {
  const keys = Object.keys(e.fields).filter((k) => isTag(k, e.fields[k])).sort((a, b) => (ORDER.indexOf(a) === -1 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 99 : ORDER.indexOf(b)) || a.localeCompare(b));
  const pad = Math.max(6, ...keys.map((k) => k.length));
  return `@${e.entryType}{${e.citeKey},\n${keys.map((k) => `  ${k.padEnd(pad)} = {${String(e.fields[k]).replace(/\n+/g, " ").trim()}}`).join(",\n")}\n}`;
}
/** "First Last" → "Last, First"; a name already in "Last, First" form or wrapped in {braces} (institution) is kept as written. */
export const bibAuthor = (a: string) => { const t = a.trim(); if (/^\{.*\}$/.test(t) || t.includes(",")) return t; const p = t.split(/\s+/); return p.length > 1 ? `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}` : t; };
/** The BibTeX tag that carries the "journal" column for an entry type (an existing tag wins). */
export function venueTag(entryType: string, fields: Record<string, unknown> = {}) {
  for (const k of ["journal", "journaltitle", "booktitle", "publisher", "institution", "school"]) if (typeof fields[k] === "string" && fields[k]) return k;
  return entryType === "book" ? "publisher" : entryType === "inproceedings" || entryType === "incollection" ? "booktitle" : entryType === "techreport" ? "institution" : entryType === "phdthesis" || entryType === "mastersthesis" ? "school" : "journal";
}
/**
 * Field map of a reference row. The stored `fields` (what was imported: LaTeX, braces, name particles, unknown tags) always win;
 * the structured columns only fill tags that are missing.
 */
export function fieldsOf(r: { title: string; authors?: string[] | null; year?: number | null; journal?: string | null; doi?: string | null; url?: string | null; entryType: string; fields?: unknown }) {
  const f: Record<string, unknown> = { ...((r.fields as Record<string, unknown>) ?? {}) };
  const missing = (k: string) => f[k] == null || String(f[k]).trim() === "";
  if (r.authors?.length && missing("author") && missing("editor")) f.author = r.authors.map(bibAuthor).join(" and ");
  if (missing("title")) f.title = r.title;
  if (r.year && missing("year") && missing("date")) f.year = String(r.year);
  if (r.journal) { const k = venueTag(r.entryType, f); if (missing(k)) f[k] = r.journal; }
  if (r.doi && missing("doi")) f.doi = r.doi;
  // the url column defaults to the DOI link: that is not a tag of its own
  if (r.url && missing("url") && !(r.doi && r.url.toLowerCase() === `https://doi.org/${r.doi}`.toLowerCase())) f.url = r.url;
  return f;
}
/** BibTeX of a stored reference: the stored entry when there is one, otherwise formatted from its fields. */
export const referenceBibtex = (r: { citeKey: string; entryType: string; bibtex?: string | null; title: string; authors?: string[] | null; year?: number | null; journal?: string | null; doi?: string | null; url?: string | null; fields?: unknown }) => (r.bibtex && r.bibtex.trim() ? r.bibtex.trim() : formatBibtex({ citeKey: r.citeKey, entryType: r.entryType, fields: fieldsOf(r) }));
export const bibFile = (refs: Parameters<typeof referenceBibtex>[0][]) => { const s = refs.slice().sort((a, b) => a.citeKey.localeCompare(b.citeKey)).map(referenceBibtex).join("\n\n"); return s ? s + "\n" : ""; };
/** Short in-text label: "Gorton & Metrick (2019)". */
export function shortCite(r: { authors?: string[] | null; year?: number | null; citeKey?: string }) {
  const a = (r.authors ?? []).map(lastName).filter(Boolean);
  const who = a.length === 0 ? (r.citeKey ?? "?") : a.length === 1 ? a[0] : a.length === 2 ? `${a[0]} & ${a[1]}` : `${a[0]} et al.`;
  return `${who}${r.year ? ` (${r.year})` : ""}`;
}
