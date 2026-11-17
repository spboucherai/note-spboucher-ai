/** Database → CSV (title + one column per property, values keyed by property id in database_rows.values). */
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
export function databaseCsv(set: ExportSet, databaseId: string): { name: string; csv: string; rows: number; columns: number; orphanRows: number } {
  const d = set.databases.find((x) => x.id === databaseId); if (!d) throw new Error("Database not found");
  const props = set.properties.filter((p) => p.databaseId === databaseId && p.type !== "title").sort((a, b) => a.position - b.position);
  const pageById = new Map(set.pages.map((p) => [p.id, p]));
  // a row whose page is in the trash is not exported as a blank line: it is counted in `orphanRows` (and in the export report)
  const all = set.rows.filter((r) => r.databaseId === databaseId).sort((a, b) => a.position - b.position);
  const rows = all.filter((r) => pageById.has(r.pageId));
  const header = ["Title", ...props.map((p) => p.name), "Created", "Updated"];
  const data = rows.map((r) => { const page = pageById.get(r.pageId); const v = (r.values ?? {}) as Record<string, unknown>; return [page?.title ?? "", ...props.map((p) => { const raw = v[p.id] ?? v[p.name]; if (raw == null || raw === "") return ""; if (["date", "number", "created_time", "last_edited_time", "url", "text"].includes(p.type)) return cellToString(raw); try { return displayValue(asProperty(p), raw); } catch { return cellToString(raw); } }), (page?.createdAt ?? r.createdAt).toISOString(), (page?.updatedAt ?? r.updatedAt).toISOString()]; });
  return { name: d.name, csv: Papa.unparse({ fields: header, data }, { newline: "\n" }) + "\n", rows: rows.length, columns: header.length, orphanRows: all.length - rows.length };
}
