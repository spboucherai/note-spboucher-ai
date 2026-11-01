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

/** Strip @string/@preamble/@comment blocks (bibtex-parse-js chokes on @string). */
function preclean(src: string) { return src.replace(/^﻿/, "").replace(/@(string|preamble|comment)\s*[{(][\s\S]*?[})]\s*$/gim, "").replace(/^%.*$/gm, ""); }

export function parseBibtex(src: string): ParsedRef[] {
  const text = preclean(src);
  let entries: ReturnType<typeof toJSON> = [];
  try { entries = toJSON(text); } catch (e) { throw new Error("Could not parse BibTeX: " + String((e as any)?.message ?? e).slice(0, 200)); }
  const out: ParsedRef[] = [];
  for (const e of entries) {
    if (!e.entryTags || !e.citationKey) continue;
    const tags: Record<string, string> = {}; for (const [k, v] of Object.entries(e.entryTags)) tags[k.toLowerCase()] = String(v).replace(/\s+/g, " ").trim();
    const authors = parseAuthors(tags.author ?? tags.editor);
    const year = tags.year ? Number((tags.year.match(/\d{4}/) ?? [])[0]) || null : null;
    const title = cleanLatex(tags.title ?? "") || "Untitled";
    const journal = cleanLatex(tags.journal ?? tags.booktitle ?? tags.publisher ?? tags.institution ?? tags.school ?? "") || null;
    const doi = normDoi(tags.doi); if (doi) tags.doi = doi;
    const url = tags.url ?? (doi ? `https://doi.org/${doi}` : null);
    const citeKey = e.citationKey.trim() || makeCiteKey(authors, year, title);
    const entryType = e.entryType.toLowerCase();
    out.push({ citeKey, entryType, title, authors, year, journal, doi, url, fields: tags, bibtex: formatBibtex({ citeKey, entryType, fields: tags }) });
  }
  return out;
}

const ORDER = ["author", "title", "journal", "booktitle", "year", "volume", "number", "pages", "publisher", "institution", "school", "doi", "url", "abstract", "keywords", "note"];
/** Deterministic BibTeX entry. */
export function formatBibtex(e: { citeKey: string; entryType: string; fields: Record<string, unknown> }) {
  const keys = Object.keys(e.fields).filter((k) => e.fields[k] != null && String(e.fields[k]).trim() !== "").sort((a, b) => (ORDER.indexOf(a) === -1 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 99 : ORDER.indexOf(b)) || a.localeCompare(b));
  const pad = Math.max(6, ...keys.map((k) => k.length));
  return `@${e.entryType}{${e.citeKey},\n${keys.map((k) => `  ${k.padEnd(pad)} = {${String(e.fields[k]).replace(/\n+/g, " ").trim()}}`).join(",\n")}\n}`;
}
/** Build the field map of a reference row (merges structured columns into fields). */
export function fieldsOf(r: { title: string; authors?: string[] | null; year?: number | null; journal?: string | null; doi?: string | null; url?: string | null; entryType: string; fields?: unknown }) {
  const f: Record<string, unknown> = { ...((r.fields as Record<string, unknown>) ?? {}) };
  if (r.authors?.length) f.author = r.authors.map((a) => { const p = a.trim().split(/\s+/); return p.length > 1 ? `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}` : a; }).join(" and ");
  f.title = r.title; if (r.year) f.year = String(r.year);
  if (r.journal) f[["book", "inproceedings", "incollection"].includes(r.entryType) ? (r.entryType === "book" ? "publisher" : "booktitle") : "journal"] = r.journal;
  if (r.doi) f.doi = r.doi; if (r.url && !f.url) f.url = r.url;
  return f;
}
/** Short in-text label: "Gorton & Metrick (2019)". */
export function shortCite(r: { authors?: string[] | null; year?: number | null; citeKey?: string }) {
  const a = (r.authors ?? []).map(lastName).filter(Boolean);
  const who = a.length === 0 ? (r.citeKey ?? "?") : a.length === 1 ? a[0] : a.length === 2 ? `${a[0]} & ${a[1]}` : `${a[0]} et al.`;
  return `${who}${r.year ? ` (${r.year})` : ""}`;
}
