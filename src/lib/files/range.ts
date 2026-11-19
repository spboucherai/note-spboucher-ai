/**
 * File: src/lib/files/range.ts
 * Description: HTTP `Range` header (RFC 9110 §14.2) for a resource of `size` bytes. Single byte range only.
 *   Returns {start, end} (inclusive) for a satisfiable range, "unsatisfiable" (→ 416), or null (no / ignorable header → whole body).
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
export function parseRange(header: string | null | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim()); if (!m || (m[1] === "" && m[2] === "")) return null; // other units, several ranges, garbage: ignored
  if (m[1] === "") { const n = Number(m[2]); if (n === 0 || size === 0) return "unsatisfiable"; return { start: Math.max(0, size - n), end: size - 1 }; } // last n bytes
  const start = Number(m[1]); const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (!Number.isSafeInteger(start) || start >= size || end < start) return "unsatisfiable";
  return { start, end };
}
