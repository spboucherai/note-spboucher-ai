/**
 * file: src/lib/stable-json.ts
 * description: canonical JSON text of a value (object keys sorted, `undefined` dropped) — the input of the content hash compared between
 *   the device replica and the server by the integrity check (GET /api/sync/integrity). PostgreSQL jsonb and JavaScript do not agree on
 *   key order, so hashing JSON.stringify output would report false differences. Shared by the server route and the browser.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
export const INTEGRITY_ALGORITHM = "sha256-stable-json-1";
export function stableJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => stableJson(x)).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
}
