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
