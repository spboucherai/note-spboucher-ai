/**
 * File: src/lib/http-input.ts
 * Description: input helpers of the route handlers that need no session (so services, the worker and the tests can import them):
 *   uuid / date parsing of path and query values, and the central mapping of "the caller sent something malformed" to HTTP 400.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { z } from "zod";
import { HttpError } from "@/lib/errors";

/**
 * Malformed input is the caller's fault, not ours (3.0, defect D-3): a `ZodError` thrown by a bare `uuid.parse(...)` / `schema.parse(...)`
 * and PostgreSQL "invalid text representation" (22P02: a non-uuid string reached a uuid column or cast) become 400 instead of 500.
 * Exported for the unit tests.
 */
export function clientError(e: unknown): unknown {
  if (e instanceof HttpError) return e;
  if (e instanceof z.ZodError) return new HttpError(400, "Validation: " + e.issues.map((i) => `${i.path.join(".")} ${i.message}`.trim()).join("; "), "bad_request");
  const pg = (e as { code?: unknown; cause?: { code?: unknown } } | null); const code = pg?.code ?? pg?.cause?.code;
  if (code === "22P02") return new HttpError(400, "Malformed identifier or value", "bad_request");
  return e;
}
export const uuid = z.string().uuid();
/** Optional uuid from a query string: absent → null, malformed → 400 (through `clientError`). */
export const optUuid = (v: string | null): string | null => (v == null || v === "" ? null : uuid.parse(v));
/** ISO date or datetime from a query string: absent → null, unparsable → 400. */
export function optDate(v: string | null, name = "date"): Date | null { if (v == null || v === "") return null; const d = new Date(v); if (isNaN(d.getTime())) throw new HttpError(400, `Invalid ${name}`, "bad_request"); return d; }
