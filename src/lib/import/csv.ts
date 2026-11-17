/** CSV → database: one property per header (number / date / checkbox inferred, else text), one row page per line. */
import Papa from "papaparse";
import type { PMNode } from "@/lib/editor/text";
import { createDatabase, addRow, tick, dbKey, getPageById, type ImportCtx, type PropType } from "./pages";
import { parseValue } from "@/lib/databases/values";
import type { Property } from "@/lib/databases/types";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

const TRUE = new Set(["true", "yes", "y", "1", "x", "✓", "✔", "checked", "oui"]); const FALSE = new Set(["false", "no", "n", "0", "", "unchecked", "non"]);
const isNum = (s: string) => /^-?\$?\s?[\d,]*\.?\d+\s?%?$/.test(s.trim()) && !/^0\d/.test(s.trim());
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(s.trim()) || (/^[A-Za-z]{3,9} \d{1,2}, \d{4}/.test(s.trim()) && !isNaN(Date.parse(s)));
export function inferType(values: string[]): PropType {
  const v = values.map((x) => (x ?? "").trim()).filter((x) => x !== ""); if (!v.length) return "text";
  if (v.every((x) => TRUE.has(x.toLowerCase()) || FALSE.has(x.toLowerCase())) && v.some((x) => TRUE.has(x.toLowerCase()))) return "checkbox";
  if (v.every(isNum)) return "number";
  if (v.every(isDate)) return "date";
  if (v.every((x) => /^https?:\/\/\S+$/i.test(x))) return "url";
  const distinct = new Set(v); if (values.length >= 8 && distinct.size <= Math.max(3, values.length / 4) && [...distinct].every((x) => x.length <= 40 && !x.includes(","))) return "select";
  return "text";
}
export function parseCsv(text: string) {
  const r = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const rows = r.data.filter((row) => row.some((c) => (c ?? "").trim() !== ""));
  if (!rows.length) return { header: [] as string[], rows: [] as string[][] };
  const header = rows[0].map((h, i) => (h ?? "").trim() || `Column ${i + 1}`);
  return { header, rows: rows.slice(1).map((row) => header.map((_h, i) => row[i] ?? "")) };
}
/** Column plan of a CSV (first column = row title, the others typed by inference) — shared by the importer and the preview. */
export function csvPlan(text: string) {
  const { header, rows } = parseCsv(text);
  const columns = header.map((name, i) => ({ name, type: i === 0 ? ("text" as PropType) : inferType(rows.map((r) => r[i])) })).filter((_c, i) => i !== 0);
  return { header, rows, columns };
}
export interface CsvImportOptions { /** ledger key of this database inside the job */ key?: string; name: string; parentId?: string | null; description?: string | null; /** called per row to attach a body (used by the Notion importer) */ rowContent?: (title: string, values: Record<string, string>) => Promise<PMNode | undefined> }
export async function importCsv(ctx: ImportCtx, text: string, opts: CsvImportOptions) {
  const { header, rows, columns: cols } = csvPlan(text);
  if (!header.length) throw new Error("CSV is empty");
  const key = opts.key ?? "csv";
  // a database with the same name and the same number of rows is taken as already imported
  if (!ctx.ledger?.has(`page:db:${key}`)) {
    const dup = ctx.existing?.databases.get(dbKey(opts.name, rows.length)); const dupPage = dup ? await getPageById(ctx, dup.pageId) : undefined;
    if (dupPage) { ctx.stats.duplicates++; ctx.stats.skipped.push(`Database “${dupPage.title}” (${rows.length} rows) already exists — not imported again`); await tick(ctx, `Database ${opts.name} already exists`, rows.length + 1); return { page: dupPage, database: null, properties: [], rowPageIds: [] as string[], rows: rows.length, duplicate: true }; }
  }
  const titleIdx = 0; // first column = row title
  const { page, database, titleProp, properties } = await createDatabase(ctx, { key, name: opts.name, parentId: opts.parentId ?? null, description: opts.description ?? null, titleName: header[titleIdx], columns: cols.map((c) => ({ name: c.name, type: c.type, config: {} })) });
  const props: Property[] = properties.map((p) => ({ id: p.id, databaseId: p.databaseId, name: p.name, type: p.type as Property["type"], config: (p.config ?? {}) as Property["config"], position: p.position, width: p.width }));
  const propByName = new Map(props.map((p) => [p.name, p]));
  // parse every value first and persist the select options BEFORE inserting rows: a retried job then reuses the same option ids
  const parsed = rows.map((r, i) => {
    const title = (r[titleIdx] ?? "").trim() || `Row ${i + 1}`; const values: Record<string, unknown> = {}; const raw: Record<string, string> = {};
    header.forEach((h, j) => { raw[h] = r[j]; if (j === titleIdx) return; const p = propByName.get(h); if (!p) return; const v = parseValue(p, r[j] ?? ""); if (v !== null && v !== undefined) values[p.id] = v; });
    return { title, values, raw };
  });
  for (const p of props) if ((p.type === "select" || p.type === "multi_select") && p.config.options?.length) await db.update(schema.databaseProperties).set({ config: p.config }).where(eq(schema.databaseProperties.id, p.id));
  const created: string[] = [];
  await tick(ctx, `Database ${opts.name}`);
  for (let i = 0; i < parsed.length; i++) {
    const { title, values, raw } = parsed[i];
    const content = opts.rowContent ? await opts.rowContent(title, raw) : undefined;
    const { page: rp } = await addRow(ctx, { id: database.id, pageId: database.pageId, titlePropId: titleProp.id }, { key: `${key}:r${i}`, title, values, content, position: i + 1 });
    created.push(rp.id);
    await tick(ctx, `Rows ${i + 1}/${rows.length} of ${opts.name}`);
  }
  return { page, database, properties, rowPageIds: created, rows: rows.length, duplicate: false };
}
