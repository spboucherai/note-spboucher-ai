/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/research/cite.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
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

/** Citation helpers shared by the server and the browser. Pure, dependency-free (the BibTeX parser stays out of the client bundle). */

/** A quoted passage saved under a reference — stored in `references.fields.extracts`. */
export interface Extract { id: string; quote: string; page: string | null; note: string | null; createdAt: string; updatedAt?: string }
export const EXTRACT_LIMITS = { quote: 8000, note: 4000, page: 40, perReference: 500 } as const;
export const extractsOf = (fields: unknown): Extract[] => { const x = (fields as { extracts?: unknown } | null | undefined)?.extracts; return Array.isArray(x) ? (x.filter((e) => e && typeof e === "object" && typeof (e as Extract).id === "string" && typeof (e as Extract).quote === "string") as Extract[]) : []; };

export interface CiteRef { citeKey: string; entryType?: string | null; title: string; authors?: string[] | null; year?: number | null; journal?: string | null; doi?: string | null; url?: string | null; fields?: unknown }
const tag = (r: CiteRef, k: string) => { const v = (r.fields as Record<string, unknown> | null | undefined)?.[k]; return typeof v === "string" || typeof v === "number" ? String(v).replace(/[{}]/g, "").trim() : ""; };
/** "Gary B. Gorton" → "Gorton, G. B." ; an institution (single token, or written "Last, First" already) is kept. */
function apaName(full: string): string {
  const t = full.replace(/[{}]/g, "").trim(); if (!t) return "";
  if (t.includes(",")) { const [last, first = ""] = t.split(",").map((x) => x.trim()); return first ? `${last}, ${initials(first)}` : last; }
  const p = t.split(/\s+/); if (p.length === 1) return t;
  // keep lower-case particles with the family name: "Jean de la Fontaine" → "de la Fontaine, J."
  let i = p.length - 1; while (i > 1 && /^(de|del|della|der|den|di|du|la|le|van|von|ten|ter|dos|da)$/.test(p[i - 1])) i--;
  return `${p.slice(i).join(" ")}, ${initials(p.slice(0, i).join(" "))}`;
}
const initials = (given: string) => given.split(/[\s]+/).filter(Boolean).map((g) => g.split("-").map((x) => (x ? x[0].toUpperCase() + "." : "")).join("-")).join(" ");
const lastOf = (full: string) => { const t = full.replace(/[{}]/g, "").trim(); return t.includes(",") ? t.split(",")[0].trim() : t.split(/\s+/).pop() ?? t; };

/** Author–year label: "Gorton & Metrick (2019)". */
export function shortLabel(r: CiteRef): string {
  const a = (r.authors ?? []).map(lastOf).filter(Boolean);
  const who = a.length === 0 ? r.citeKey : a.length === 1 ? a[0] : a.length === 2 ? `${a[0]} & ${a[1]}` : `${a[0]} et al.`;
  return `${who} (${r.year ?? "n.d."})`;
}
/** APA-style reference line, plain text (journal/volume are not italicised: it is pasted into notes, e-mails, Word). */
export function formatCitation(r: CiteRef): string {
  // the stored BibTeX name list tells which authors are institutions ({Bank of Canada}): those are never inverted
  const rawList = (() => { const a = (r.fields as Record<string, unknown> | null | undefined)?.author; return typeof a === "string" ? a.split(/\s+and\s+/i).map((x) => x.trim()) : []; })();
  const list = r.authors ?? [];
  const names = list.map((a, i) => (rawList.length === list.length && /^\{.*\}$/.test(rawList[i]) ? a.replace(/[{}]/g, "").trim() : apaName(a))).filter(Boolean);
  const who = names.length === 0 ? "" : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]}, & ${names[1]}` : names.length <= 20 ? `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}` : `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}`;
  const title = r.title.replace(/[{}]/g, "").replace(/\s+/g, " ").trim().replace(/[.]$/, "");
  const vol = tag(r, "volume"); const num = tag(r, "number") || tag(r, "issue"); const pages = tag(r, "pages").replace(/--+/g, "–"); const publisher = tag(r, "publisher");
  const type = (r.entryType ?? "article").toLowerCase();
  const parts: string[] = [];
  parts.push(`${who ? who.replace(/\.$/, "") + ". " : ""}(${r.year ?? "n.d."}). ${title}.`);
  if (type === "book") { if (publisher || r.journal) parts.push(`${publisher || r.journal}.`); }
  else if (type === "incollection" || type === "inproceedings") { const bt = tag(r, "booktitle") || r.journal || ""; if (bt) parts.push(`In ${bt}${pages ? ` (pp. ${pages})` : ""}.`); if (publisher) parts.push(`${publisher}.`); }
  else if (type === "phdthesis" || type === "mastersthesis") { parts.push(`[${type === "phdthesis" ? "Doctoral dissertation" : "Master's thesis"}${tag(r, "school") || r.journal ? `, ${tag(r, "school") || r.journal}` : ""}].`); }
  else if (r.journal) parts.push(`${r.journal}${vol ? `, ${vol}` : ""}${num ? `(${num})` : ""}${pages ? `, ${pages}` : ""}.`);
  const link = r.doi ? `https://doi.org/${r.doi}` : r.url ?? ""; if (link) parts.push(link);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
/** Markdown inserted into a page for an extract: a block quote followed by its source. */
export function extractMarkdown(r: { citeKey: string }, e: { quote: string; page?: string | null }): string {
  const quote = e.quote.trim().split(/\r?\n/).map((l) => `> ${l}`).join("\n");
  return `${quote}\n> — (${r.citeKey}${e.page ? `, p. ${e.page}` : ""})`;
}
