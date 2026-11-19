/**
 * File: src/lib/pg-values.ts
 * Description: JSON-safe values for rows read with raw SQL (`db.execute`, the bare `sql` client). The driver hands back timestamps as
 *   PostgreSQL text (`2026-11-19 13:45:47.060354-05`) and bigint / numeric aggregates as strings; an API answer carries ISO-8601 UTC
 *   strings and JSON numbers (3.0, integration defect 10).
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
/** A timestamp as ISO-8601 UTC with milliseconds; `null` stays `null`; a `Date` is accepted; an unparsable value is returned as it came. */
export function pgIso(v: unknown): string | null {
  if (v == null) return null; if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  let s = String(v).trim();
  if (/\d{2}:\d{2}/.test(s)) s = s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(s); return isNaN(d.getTime()) ? String(v) : d.toISOString();
}
/** A count / sum as a JSON number (`null` → 0). */
export const pgNum = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
