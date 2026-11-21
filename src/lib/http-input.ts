/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/http-input.ts
 * Description      : input helpers of the route handlers that need no session
 *                    (so services, the worker and the tests can import them):
 *                    uuid / date parsing of path and query values, and the
 *                    central mapping of "the caller sent something malformed"
 *                    to HTTP 400.
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
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
