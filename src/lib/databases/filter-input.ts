/**
 * File: src/lib/databases/filter-input.ts
 * Description: body schema of a database filter sent by a client (query, bulk selection). A filter is a group `{and: […]}` / `{or: […]}`,
 *   `{}` / null (no filter), or — accepted since 3.0 — one bare rule `{property, op, value?}` (read as `{and: [rule]}`). Anything else
 *   is refused with 400 `bad_filter`: a filter is never silently ignored (a bare rule used to be dropped by the body schema, which
 *   turned "the rows matching X" into "every row" — including for a bulk delete).
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { z } from "zod";
import { HttpError } from "@/lib/errors";
import type { FilterGroup } from "./types";

const rule = z.object({ property: z.string(), op: z.string(), value: z.unknown().optional() });
const group: z.ZodType<any> = z.lazy(() => z.object({ and: z.array(z.union([rule, group])).optional(), or: z.array(z.union([rule, group])).optional() }));
const bad = (m: string) => new HttpError(400, m, "bad_filter");
/** Exported for the unit tests. */
export function normaliseFilter(v: unknown, path = "filter"): FilterGroup | null | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw bad(`${path}: a filter group or rule is expected`);
  const o = v as Record<string, unknown>; const isRule = "property" in o || "op" in o;
  if ("and" in o || "or" in o) {
    if (isRule) throw bad(`${path}: a filter is either a group ("and" / "or") or one rule, not both`);
    const g = group.safeParse(o); if (!g.success) throw bad(`${path}: ${g.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`); return g.data as FilterGroup;
  }
  if (isRule) { const r = rule.safeParse(o); if (!r.success) throw bad(`${path}: a rule needs "property" and "op" (strings)`); return { and: [r.data] } as FilterGroup; }
  if (Object.keys(o).length) throw bad(`${path}: expected {"and": […]}, {"or": […]} or a rule {"property", "op", "value"}`);
  return {};
}
/** Zod field: `filter: filterInput("filter").optional()`. */
export const filterInput = (path: string) => z.unknown().transform((v) => normaliseFilter(v, path));
