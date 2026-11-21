/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/instrumentation.ts
 * Module           : src
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

/**
 * Runs once when the web process starts. Guarantee: a deployment or restart never comes up with an enrollment window open —
 * any window left open is closed here (a new one must be opened deliberately from the node shell). Configuration problems and
 * leftover legacy variables are logged by name, never by value.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("@/lib/net-defaults"); // before any outbound connection (AI providers, embeddings, Crossref)
  const { closeEnrollments } = await import("@/lib/auth/enrollment");
  const { configProblems, legacyEnvPresent } = await import("@/lib/auth/config");
  const { log } = await import("@/lib/log");
  try { const n = await closeEnrollments("server-start"); if (n) log.warn({ closed: n }, "enrollment window(s) closed at startup"); } catch (e) { log.error({ detail: String((e as Error).message).slice(0, 200) }, "could not close enrollment windows at startup"); }
  const problems = configProblems(); if (problems.length) log.error({ problems }, "passkey configuration problems");
  const legacy = legacyEnvPresent(); if (legacy.length) log.warn({ variables: legacy }, "legacy access variables are still set; they are ignored — remove them from .env");
}
