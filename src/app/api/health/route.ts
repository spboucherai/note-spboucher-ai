/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/health/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

import { sql } from "@/db";
import { configProblems } from "@/lib/auth/config";
import { serverVersion } from "@/lib/meta";
import { pgIso } from "@/lib/pg-values";
export const dynamic = "force-dynamic";
/** Public liveness probe (mld heal). Booleans and a version only — nothing about the content or the owner. */
export async function GET() {
  try {
    const [r] = await sql`select now() as now, (select count(*) from pg_extension where extname='vector') as vec, (select (value->>'at')::timestamptz from settings where key = 'worker.heartbeat') as beat`;
    const worker = r.beat ? Date.now() - new Date(r.beat).getTime() < 120_000 : false;
    return Response.json({ ok: true, db: true, pgvector: Number(r.vec) > 0, worker, passkeys: configProblems().length === 0, time: pgIso(r.now), version: serverVersion() }, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ ok: false, db: false }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
