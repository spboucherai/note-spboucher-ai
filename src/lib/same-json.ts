/** Structural equality that ignores key order: PostgreSQL jsonb returns object keys in its own order, so string comparison would lie. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true; if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) { const y = b as unknown[]; return a.length === y.length && a.every((v, i) => sameJson(v, y[i])); }
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>; const kx = Object.keys(x).filter((k) => x[k] !== undefined), ky = Object.keys(y).filter((k) => y[k] !== undefined);
  return kx.length === ky.length && kx.every((k) => sameJson(x[k], y[k]));
}
