/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/errors.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
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

/** HTTP-mappable error. Lives outside the Next.js-only modules so services, the worker, the CLI and tests can share it. */
export class HttpError extends Error { constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) { super(message); } }

/**
 * Every error answer carries a stable `code` (3.0 integration): the one given by the service, else the default of its HTTP status.
 * Clients test `code`, never the English message.
 */
const DEFAULT_CODES: Record<number, string> = { 400: "bad_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found", 405: "method_not_allowed", 409: "invalid_state", 410: "gone", 413: "too_large", 415: "unsupported_media_type", 416: "range_not_satisfiable", 422: "unprocessable", 429: "rate_limited", 501: "not_implemented", 502: "upstream_error", 503: "unavailable" };
export const errorCode = (status: number, code?: string | null): string => code || DEFAULT_CODES[status] || (status >= 500 ? "internal" : "error");
