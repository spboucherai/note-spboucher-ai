import Papa from "papaparse";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Property, RowOut } from "./types";
import { displayValue, parseValue, sortedProps, titleProp } from "./values";
import { createProperty, createRow, ensureDatabase } from "./service";
import { loadProps, loadRaw } from "./query";

export function exportCsv(props: Property[], rows: RowOut[], hidden: string[] = []): string {
  const cols = sortedProps(props).filter((p) => p.type === "title" || !hidden.includes(p.id));
  return "﻿" + Papa.unparse({ fields: cols.map((p) => p.name), data: rows.map((r) => cols.map((p) => (p.type === "title" ? r.title : p.type === "file" ? (Array.isArray(r.values[p.id]) ? (r.values[p.id] as any[]).map((f) => f.url).join(", ") : "") : p.type === "date" || p.type === "created_time" || p.type === "last_edited_time" ? String(r.values[p.id] ?? "") : p.type === "number" ? String(r.values[p.id] ?? "") : displayValue(p, r.values[p.id])))) });
}
/** Import rows from CSV text; unknown columns become text properties. */
export async function importCsv(wsId: string, dbId: string, text: string) {
  const d = await ensureDatabase(wsId, dbId);
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  if (!parsed.meta.fields?.length) throw new Error("CSV has no header row");
  let props = await loadProps(d.id); const tp = titleProp(props)!; const created: string[] = [];
  const byName = (n: string) => props.find((p) => p.name.toLowerCase() === n.toLowerCase());
  const titleCol = parsed.meta.fields.find((f) => f.toLowerCase() === tp.name.toLowerCase()) ?? parsed.meta.fields.find((f) => /^(name|title|titre|nom)$/i.test(f)) ?? parsed.meta.fields[0];
  const colMap = new Map<string, Property>();
  for (const f of parsed.meta.fields) {
    if (!f || f === titleCol) continue;
    let p = byName(f);
    if (!p) { p = await createProperty(wsId, d.id, { name: f, type: "text" }); props = [...props, p]; created.push(f); }
    colMap.set(f, p);
  }
  const relCache = new Map<string, Map<string, string>>();
  const relLookup = async (p: Property, s: string) => { const t = p.config.targetDatabaseId as string | undefined; if (!t) return []; let m = relCache.get(t); if (!m) { m = new Map((await loadRaw([eq(schema.databaseRows.databaseId, t)])).map((r) => [r.title.toLowerCase(), r.id])); relCache.set(t, m); } return s.split(/[,;|]/).map((x) => m!.get(x.trim().toLowerCase())).filter((x): x is string => !!x); };
  let n = 0; const touched = new Set<Property>();
  for (const rec of parsed.data) {
    const values: Record<string, unknown> = {};
    for (const [col, p] of colMap) { const raw = rec[col] ?? ""; if (!raw.trim()) continue; if (p.type === "relation") values[p.id] = await relLookup(p, raw); else if (["rollup", "formula", "created_time", "last_edited_time", "file"].includes(p.type)) continue; else { const before = JSON.stringify(p.config.options ?? []); values[p.id] = parseValue(p, raw); if (JSON.stringify(p.config.options ?? []) !== before) touched.add(p); } }
    await createRow(wsId, d.id, { title: (rec[titleCol] ?? "").trim(), values }); n++;
  }
  for (const p of touched) await db.update(schema.databaseProperties).set({ config: p.config }).where(eq(schema.databaseProperties.id, p.id));
  return { created: n, properties: created };
}
