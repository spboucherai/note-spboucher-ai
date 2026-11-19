/**
 * file: src/lib/import/csv.ts
 * description: CSV → database: one property per header (number / date / checkbox inferred, else text), one row page per line.
 *   Headers are made unique (`Name`, `Name 2`, …) and cut to 200 characters (the property name limit) so no column overwrites another.
 *   Numbers — the rule, decided per COLUMN (never per cell):
 *     1. every cell is first stripped of an optional leading `-`, an optional currency sign (`$`, `€`, `£`, before or after) and an
 *        optional trailing `%`;
 *     2. "dot" style: digits, optionally grouped by `,` or a space in groups of three, optional `.` decimals — `1234`, `1,234`,
 *        `1 234.5`, `.5`. "comma" style: digits, optionally grouped by a space or `.` in groups of three, optional `,` decimals —
 *        `1,5`, `1 234,5`, `1.234,56`;
 *     3. a column whose cells ALL read in the dot style is dot-style (so an ambiguous `1,234` alone stays 1234, as before); otherwise,
 *        if ALL its cells read in the comma style it is comma-style (`1,5` → 1.5, and then `1,234` → 1.234); otherwise the column is
 *        not a number column and stays text — nothing is guessed cell by cell;
 *     4. a column is never a number column when one of its cells would lose information as a number: more than 15 significant
 *        digits (ids, card or phone numbers) or a leading zero before another digit (`007`, postal codes). It stays text.
 *   Problems reported by the parser (unterminated quote, ragged line…) and renamed headers are returned as `warnings` and end up in the
 *   import report (`stats.skipped`) and in the preview. An empty CSV is refused with a 400 `empty_csv` (it is not a retryable failure).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import Papa from "papaparse";
import type { PMNode } from "@/lib/editor/text";
import { createDatabase, addRow, tick, dbKey, getPageById, ImportError, type ImportCtx, type PropType } from "./pages";
import { parseValue } from "@/lib/databases/values";
import type { Property } from "@/lib/databases/types";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

const TRUE = new Set(["true", "yes", "y", "1", "x", "✓", "✔", "checked", "oui"]); const FALSE = new Set(["false", "no", "n", "0", "", "unchecked", "non"]);
export type NumberStyle = "dot" | "comma";
const SP = "[ \\u00a0\\u202f]";
const DOT_STYLE = new RegExp(`^(?:\\d+|\\d{1,3}(?:,\\d{3})+|\\d{1,3}(?:${SP}\\d{3})+)?(?:\\.\\d+)?$`);
const COMMA_STYLE = new RegExp(`^(?:\\d+|\\d{1,3}(?:${SP}\\d{3})+|\\d{1,3}(?:\\.\\d{3})+)(?:,\\d+)?$`);
/** Sign, currency sign and percent removed: `-$ 1,234.50` → `{ neg: true, body: "1,234.50" }`; null when the cell has no digit. */
function numberBody(raw: string): { neg: boolean; body: string } | null {
  let s = raw.trim(); let neg = false;
  if (s.startsWith("-") || s.startsWith("−")) { neg = true; s = s.slice(1).trim(); }
  s = s.replace(/^[$€£]\s?/, "").replace(/\s?%$/, "").replace(/\s?[$€£]$/, "").trim();
  return /\d/.test(s) ? { neg, body: s } : null;
}
/** A cell that would not survive as a JS number: more than 15 significant digits, or a leading zero before a digit (`007`). */
export function lossyNumber(raw: string): boolean {
  const b = numberBody(raw); if (!b) return false;
  if (/^0\d/.test(b.body)) return true;
  return b.body.replace(/\D/g, "").replace(/^0+/, "").length > 15;
}
/** Canonical decimal string (`-1234.5`) of a cell read in the given style, or null when the cell is not a number in that style. */
export function normaliseNumber(raw: string, style: NumberStyle): string | null {
  const b = numberBody(raw); if (!b) return null;
  if (!(style === "dot" ? DOT_STYLE : COMMA_STYLE).test(b.body)) return null;
  const plain = style === "dot" ? b.body.replace(/[,   ]/g, "") : b.body.replace(/[.   ]/g, "").replace(",", ".");
  if (!Number.isFinite(Number(plain))) return null;
  return `${b.neg ? "-" : ""}${plain.startsWith(".") ? "0" : ""}${plain}`;
}
/** Number style of a whole column (rule in the file header), or null when the column is not a number column. Empty cells are ignored. */
export function numberStyle(values: string[]): NumberStyle | null {
  const v = values.map((x) => (x ?? "").trim()).filter((x) => x !== ""); if (!v.length || v.some(lossyNumber)) return null;
  if (v.every((x) => normaliseNumber(x, "dot") !== null)) return "dot";
  if (v.every((x) => normaliseNumber(x, "comma") !== null)) return "comma";
  return null;
}
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(s.trim()) || (/^[A-Za-z]{3,9} \d{1,2}, \d{4}/.test(s.trim()) && !isNaN(Date.parse(s)));
export function inferType(values: string[]): PropType {
  const v = values.map((x) => (x ?? "").trim()).filter((x) => x !== ""); if (!v.length) return "text";
  if (v.every((x) => TRUE.has(x.toLowerCase()) || FALSE.has(x.toLowerCase())) && v.some((x) => TRUE.has(x.toLowerCase()))) return "checkbox";
  if (numberStyle(v)) return "number";
  if (v.every(isDate)) return "date";
  if (v.every((x) => /^https?:\/\/\S+$/i.test(x))) return "url";
  const distinct = new Set(v); if (values.length >= 8 && distinct.size <= Math.max(3, values.length / 4) && [...distinct].every((x) => x.length <= 40 && !x.includes(","))) return "select";
  return "text";
}
/** Unique, non-empty header names of at most 200 characters: an empty cell → `Column N`, a repeated name → `Name 2`, `Name 3`… (case-insensitive). */
export function uniqueHeaders(raw: string[]): { header: string[]; renamed: { column: number; from: string; to: string }[] } {
  const seen = new Set<string>(); const renamed: { column: number; from: string; to: string }[] = [];
  const header = raw.map((h, i) => {
    const base = ((h ?? "").trim() || `Column ${i + 1}`).slice(0, 200); let name = base; let n = 2;
    while (seen.has(name.toLowerCase())) { const suffix = ` ${n++}`; name = base.slice(0, 200 - suffix.length) + suffix; }
    seen.add(name.toLowerCase()); if (name !== base) renamed.push({ column: i + 1, from: base, to: name }); return name;
  });
  return { header, renamed };
}
export function parseCsv(text: string) {
  const r = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const rows = r.data.filter((row) => row.some((c) => (c ?? "").trim() !== ""));
  if (!rows.length) return { header: [] as string[], rows: [] as string[][], warnings: [] as string[] };
  const { header, renamed } = uniqueHeaders(rows[0]);
  // "the delimiter could not be detected" is what papaparse says of every one-column file: not a problem worth reporting
  const errors = (r.errors ?? []).filter((e) => e.type !== "Delimiter");
  const warnings: string[] = [];
  if (errors.length) warnings.push(`${errors.length} line(s) could not be read cleanly and may be incomplete: ${errors.slice(0, 5).map((e) => `${typeof e.row === "number" ? `line ${e.row + 1}: ` : ""}${e.message}`).join("; ")}${errors.length > 5 ? "…" : ""}`);
  if (renamed.length) warnings.push(`${renamed.length} repeated column name(s) renamed: ${renamed.slice(0, 5).map((x) => `column ${x.column} “${x.from.slice(0, 40)}” → “${x.to.slice(0, 40)}”`).join(", ")}${renamed.length > 5 ? "…" : ""}`);
  return { header, rows: rows.slice(1).map((row) => header.map((_h, i) => row[i] ?? "")), warnings };
}
/** Column plan of a CSV (first column = row title, the others typed by inference) — shared by the importer and the preview. */
export function csvPlan(text: string) {
  const { header, rows, warnings } = parseCsv(text);
  const columns = header.map((name, i) => ({ name, type: i === 0 ? ("text" as PropType) : inferType(rows.map((r) => r[i])) })).filter((_c, i) => i !== 0);
  // how the cells of each number column are written (`dot` / `comma`), keyed by column name
  const numberStyles: Record<string, NumberStyle> = {}; header.forEach((name, i) => { if (i > 0 && columns[i - 1].type === "number") numberStyles[name] = numberStyle(rows.map((r) => r[i])) ?? "dot"; });
  return { header, rows, columns, numberStyles, warnings };
}
export interface CsvRowBody { content?: PMNode; createdAt?: Date; updatedAt?: Date }
export interface CsvImportOptions { /** ledger key of this database inside the job */ key?: string; name: string; parentId?: string | null; description?: string | null; /** called per row to attach a body (used by the ZIP / Notion importer); may also return the dates of the row page */ rowContent?: (title: string, values: Record<string, string>) => Promise<PMNode | CsvRowBody | undefined> }
export async function importCsv(ctx: ImportCtx, text: string, opts: CsvImportOptions) {
  const { header, rows, columns: cols, numberStyles, warnings } = csvPlan(text);
  if (!header.length) throw new ImportError(`The CSV file “${opts.name}” is empty: there is nothing to import.`, 400, "empty_csv");
  const key = opts.key ?? "csv";
  // a database with the same name and the same number of rows is taken as already imported
  if (!ctx.ledger?.has(`page:db:${key}`)) {
    const dup = ctx.existing?.databases.get(dbKey(opts.name, rows.length)); const dupPage = dup ? await getPageById(ctx, dup.pageId) : undefined;
    if (dupPage) { ctx.stats.duplicates++; ctx.stats.skipped.push(`Database “${dupPage.title}” (${rows.length} rows) already exists — not imported again`); await tick(ctx, `Database ${opts.name} already exists`, rows.length + 1); return { page: dupPage, database: null, properties: [], rowPageIds: [] as string[], rows: rows.length, duplicate: true }; }
  }
  for (const w of warnings) ctx.stats.skipped.push(`${opts.name}.csv: ${w}`);
  const titleIdx = 0; // first column = row title
  const { page, database, titleProp, properties } = await createDatabase(ctx, { key, name: opts.name, parentId: opts.parentId ?? null, description: opts.description ?? null, titleName: header[titleIdx], columns: cols.map((c) => ({ name: c.name, type: c.type, config: {} })) });
  const props: Property[] = properties.map((p) => ({ id: p.id, databaseId: p.databaseId, name: p.name, type: p.type as Property["type"], config: (p.config ?? {}) as Property["config"], position: p.position, width: p.width }));
  const propByName = new Map(props.map((p) => [p.name, p]));
  // parse every value first and persist the select options BEFORE inserting rows: a retried job then reuses the same option ids
  const parsed = rows.map((r, i) => {
    const title = (r[titleIdx] ?? "").trim() || `Row ${i + 1}`; const values: Record<string, unknown> = {}; const raw: Record<string, string> = {};
    header.forEach((h, j) => {
      raw[h] = r[j]; if (j === titleIdx) return; const p = propByName.get(h); if (!p) return;
      // numbers are brought to a plain decimal string here (decimal comma, grouping, currency sign): parseValue would read `1,5` as 15
      const cell = p.type === "number" ? normaliseNumber(r[j] ?? "", numberStyles[h] ?? "dot") ?? "" : r[j] ?? "";
      const v = parseValue(p, cell); if (v !== null && v !== undefined) values[p.id] = v;
    });
    return { title, values, raw };
  });
  for (const p of props) if ((p.type === "select" || p.type === "multi_select") && p.config.options?.length) await db.update(schema.databaseProperties).set({ config: p.config }).where(eq(schema.databaseProperties.id, p.id));
  const created: string[] = [];
  await tick(ctx, `Database ${opts.name}`);
  for (let i = 0; i < parsed.length; i++) {
    const { title, values, raw } = parsed[i];
    const got = opts.rowContent ? await opts.rowContent(title, raw) : undefined;
    const body: CsvRowBody = got && typeof (got as PMNode).type === "string" ? { content: got as PMNode } : ((got as CsvRowBody | undefined) ?? {});
    const { page: rp } = await addRow(ctx, { id: database.id, pageId: database.pageId, titlePropId: titleProp.id }, { key: `${key}:r${i}`, title, values, content: body.content, position: i + 1, createdAt: body.createdAt, updatedAt: body.updatedAt });
    created.push(rp.id);
    await tick(ctx, `Rows ${i + 1}/${rows.length} of ${opts.name}`);
  }
  return { page, database, properties, rowPageIds: created, rows: rows.length, duplicate: false };
}
