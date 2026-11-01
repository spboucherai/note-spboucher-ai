import type { Property, RowOut, OptionColor } from "@/lib/databases/types";
export interface Group { key: string; label: string; color: OptionColor; value: unknown; rows: RowOut[] }
/** Group rows by a select/status/checkbox property, keeping option order; empty group last. */
export function groupRows(rows: RowOut[], p: Property | undefined): Group[] {
  if (!p) return [{ key: "all", label: "All", color: "gray", value: undefined, rows }];
  if (p.type === "checkbox") return [{ key: "false", label: "Unchecked", color: "gray", value: false, rows: rows.filter((r) => !r.values[p.id]) }, { key: "true", label: "Checked", color: "green", value: true, rows: rows.filter((r) => !!r.values[p.id]) }];
  const opts = p.config.options ?? []; const groups: Group[] = opts.map((o) => ({ key: o.id, label: o.name, color: o.color, value: o.id, rows: [] }));
  const none: Group = { key: "__none", label: `No ${p.name}`, color: "gray", value: null, rows: [] };
  for (const r of rows) { const v = r.values[p.id]; const g = groups.find((x) => x.key === v); (g ?? none).rows.push(r); }
  return [...groups, none];
}
