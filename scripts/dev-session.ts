/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : scripts/dev-session.ts
 * Module           : scripts
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-18
 * Last Modified    : 2026-11-18
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
 * DEVELOPMENT ONLY — prints a session token for the owner of a scratch database, so native clients and scripts can be tested without a
 * passkey ceremony. Refuses any database whose name does not end in _dev, _test or _scratch, and any non-loopback APP_URL.
 *   set -a && . ./.env && set +a && node_modules/.bin/tsx scripts/dev-session.ts
 */
import "../tests/helpers/testdb";
import { createSession, ownerRow } from "../src/lib/auth/sessions";
import { sql } from "../src/db/index";
const host = new URL(process.env.APP_URL ?? "http://x").hostname;
if (host !== "localhost" && host !== "127.0.0.1") throw new Error(`Refusing: APP_URL host "${host}" is not loopback.`);
const u = await ownerRow(); if (!u) throw new Error("No owner row: run `pnpm run bootstrap` first.");
const s = await createSession({ userId: u.id, credentialId: null, userAgent: process.argv[2] ?? "SPNotes/dev (Macintosh; Mac OS X) native", ip: "127.0.0.1" });
console.log(s.token); await sql.end();
