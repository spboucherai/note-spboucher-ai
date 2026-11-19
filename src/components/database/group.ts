/**
 * File: src/components/database/group.ts
 * Description: groups of a view. 3.0: the counts, offsets and aggregates come from the server (whole database, see `GroupOut`); the
 *   metadata (label, colour, value) comes from the property. `groupRows` (2.x: groups computed from the loaded rows) is kept for the
 *   places that group a small in-memory list.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import type { Property, RowOut, OptionColor, GroupOut, NumAgg } from "@/lib/databases/types";
import { groupKeyOf, groupMetas } from "@/lib/databases/group";
export interface Group { key: string; label: string; color: OptionColor; value: unknown; rows: RowOut[] }
/** Group rows by a select/status/checkbox property, keeping option order; empty group last. */
export function groupRows(rows: RowOut[], p: Property | undefined): Group[] {
  if (!p) return [{ key: "all", label: "All", color: "gray", value: undefined, rows }];
  const groups: Group[] = groupMetas(p).map((m) => ({ ...m, rows: [] })); const by = new Map(groups.map((g) => [g.key, g]));
  for (const r of rows) by.get(groupKeyOf(p, r.values[p.id]))?.rows.push(r);
  return groups;
}
/** A group of the view with its server-side numbers. `offset` = index of its first row in the view's order. */
export interface ViewGroup { key: string; label: string; color: OptionColor; value: unknown; count: number; offset: number; aggregates: Record<string, NumAgg> }
export function viewGroups(p: Property | undefined, server: GroupOut[] | undefined, total: number): ViewGroup[] {
  if (!p) return [{ key: "all", label: "All", color: "gray", value: undefined, count: total, offset: 0, aggregates: {} }];
  const by = new Map((server ?? []).map((g) => [g.key, g])); let at = 0;
  return groupMetas(p).map((m) => { const g = by.get(m.key); const out: ViewGroup = { ...m, count: g?.count ?? 0, offset: g?.offset ?? at, aggregates: g?.aggregates ?? {} }; at = out.offset + out.count; return out; });
}
