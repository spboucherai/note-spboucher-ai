/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/log.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
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

/**
 * Structured logs (pino JSON on stdout → PM2 logs). Rule: identifiers and timings only.
 * Never log note text, excerpts, prompts, upload contents, cookies, session tokens, API keys or WebAuthn assertions.
 * The redact list is a safety net for objects passed by mistake.
 */
import pino from "pino";
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "note" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: ["token", "cookie", "authorization", "password", "apiKey", "content", "text", "prompt", "response", "assertion", "*.token", "*.cookie", "*.authorization", "*.password", "*.apiKey", "*.content", "*.text", "*.prompt", "*.assertion"], censor: "[redacted]" },
});
export const newRequestId = () => crypto.randomUUID();
