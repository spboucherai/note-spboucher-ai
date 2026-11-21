/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/export/csv.ts
 * Description      : Database → CSV (title + one column per property, values
 *                    keyed by property id in database_rows.values). Formula
 *                    injection: a cell (or a header) that starts with `=`, `+`,
 *                    `-`, `@`, a tab or a carriage return would be run as a
 *                    formula by a spreadsheet; it is written with a leading
 *                    apostrophe (`'=SUM(A1)`), which spreadsheets show as plain
 *                    text. A plain number is left alone (`-5`, `+3.2`,
 *                    `-1,234.5`, `-$5.00`, `-12 %`): digits and separators
 *                    cannot call a function or reference a cell. The apostrophe
 *                    is NOT removed when the file is imported again: such a
 *                    cell comes back as `'=…` (text), by design.
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

import Papa from "papaparse";
import type { ExportSet } from "./data";
import { displayValue } from "@/lib/databases/values";
import type { Property } from "@/lib/databases/types";
export const asProperty = (p: ExportSet["properties"][number]): Property => ({ id: p.id, databaseId: p.databaseId, name: p.name, type: p.type as Property["type"], config: (p.config ?? {}) as Property["config"], position: p.position, width: p.width });

export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" && x ? ((x as any).label ?? (x as any).name ?? (x as any).title ?? JSON.stringify(x)) : String(x))).join(", ");
  if (typeof v === "object") { const o = v as any; return o.label ?? o.name ?? o.title ?? o.url ?? JSON.stringify(o); }
  return String(v);
}
const PLAIN_NUMBER = /^[-+]?[$€£]?\s?(?:\d[\d,. \u00a0\u202f]*|\.\d+)(?:[eE][-+]?\d+)?\s?[%$€£]?$/;
/** Neutralises a cell a spreadsheet would evaluate (rule in the file header). */
export function csvSafe(cell: string): string { return /^[=+\-@\t\r]/.test(cell) && !PLAIN_NUMBER.test(cell) ? `'${cell}` : cell; }
export function databaseCsv(set: ExportSet, databaseId: string): { name: string; csv: string; rows: number; columns: number; orphanRows: number } {
  const d = set.databases.find((x) => x.id === databaseId); if (!d) throw new Error("Database not found");
  const props = set.properties.filter((p) => p.databaseId === databaseId && p.type !== "title").sort((a, b) => a.position - b.position);
  const pageById = new Map(set.pages.map((p) => [p.id, p]));
  // a row whose page is in the trash is not exported as a blank line: it is counted in `orphanRows` (and in the export report)
  const all = set.rows.filter((r) => r.databaseId === databaseId).sort((a, b) => a.position - b.position);
  const rows = all.filter((r) => pageById.has(r.pageId));
  const header = ["Title", ...props.map((p) => p.name), "Created", "Updated"];
  const data = rows.map((r) => { const page = pageById.get(r.pageId); const v = (r.values ?? {}) as Record<string, unknown>; return [page?.title ?? "", ...props.map((p) => { const raw = v[p.id] ?? v[p.name]; if (raw == null || raw === "") return ""; if (["date", "number", "created_time", "last_edited_time", "url", "text"].includes(p.type)) return cellToString(raw); try { return displayValue(asProperty(p), raw); } catch { return cellToString(raw); } }), (page?.createdAt ?? r.createdAt).toISOString(), (page?.updatedAt ?? r.updatedAt).toISOString()]; });
  return { name: d.name, csv: Papa.unparse({ fields: header.map(csvSafe), data: data.map((row) => row.map(csvSafe)) }, { newline: "\n" }) + "\n", rows: rows.length, columns: header.length, orphanRows: all.length - rows.length };
}
