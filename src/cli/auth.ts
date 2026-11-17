/**
 * Passkey administration from the node shell (the only place where access can be granted without an existing passkey).
 *   pnpm auth:status                      passkeys, live sessions, open enrollment window, configuration problems
 *   pnpm auth:open-enrollment [minutes]   FIRST passkey only (refused once a passkey exists). Prints a one-time link, default 15 min, max 60.
 *   pnpm auth:recover [minutes] [--keep-passkeys]
 *                                         every device lost: one-time link to register a new passkey. On success ALL sessions are revoked
 *                                         and (unless --keep-passkeys) every previous passkey is deleted.
 *   pnpm auth:close-enrollment            close any open window now
 *   pnpm auth:revoke-sessions             sign every device out (stolen session / lost phone)
 * The link carries the token in the URL fragment (#…): it is never sent to the server in a URL, never logged by Caddy.
 * Run with the app environment loaded:  set -a && . ./.env && set +a && pnpm auth:status
 */
import "dotenv/config";
import { count, isNull, and, gt } from "drizzle-orm";
import { db, schema, sql } from "../db/index";
import { appOrigin, configProblems, legacyEnvPresent, rpId, allowedOrigins } from "../lib/auth/config";
import { closeEnrollments, credentialCount, openEnrollment, openEnrollmentInfo } from "../lib/auth/enrollment";
import { ownerRow, revokeAllSessions } from "../lib/auth/sessions";

const [cmd, ...args] = process.argv.slice(2);
const minutes = Number(args.find((a) => /^\d+$/.test(a)) ?? NaN);
const audit = (action: string, detail: Record<string, unknown> = {}) => db.insert(schema.auditLogs).values({ userId: null, action, detail, ip: "cli" });
const fail = (m: string) => { console.error(`✗ ${m}`); process.exitCode = 1; };

async function link(purpose: "bootstrap" | "recovery") {
  const problems = configProblems(); if (problems.length) return fail(`Configuration: ${problems.join(" ")}`);
  if (!(await ownerRow())) return fail("No owner row: run `pnpm bootstrap` first.");
  const w = await openEnrollment(purpose, { minutes: Number.isFinite(minutes) ? minutes : undefined, revokeExisting: !args.includes("--keep-passkeys") });
  await audit(`auth.enrollment_opened`, { purpose, minutes: w.minutes, revokeExisting: purpose === "recovery" && !args.includes("--keep-passkeys") });
  console.log(`\n${purpose === "bootstrap" ? "First-passkey" : "Recovery"} window open for ${w.minutes} min (until ${w.expiresAt.toLocaleTimeString()}).`);
  console.log("Open this link ON THE DEVICE that will hold the passkey (single use — it closes after the first registration):\n");
  console.log(`  ${appOrigin()}/enroll#${w.token}\n`);
  if (purpose === "recovery") console.log(args.includes("--keep-passkeys") ? "Existing passkeys are KEPT; all sessions will be revoked on success." : "On success: every previous passkey is DELETED and all sessions are revoked.");
  console.log("Do not paste this link in a chat, a ticket or a screenshot. `pnpm auth:close-enrollment` cancels it.");
}

try {
  if (cmd === "status") {
    const [live] = await db.select({ n: count() }).from(schema.sessions).where(and(isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())));
    const creds = await db.select({ label: schema.webauthnCredentials.label, createdAt: schema.webauthnCredentials.createdAt, lastUsedAt: schema.webauthnCredentials.lastUsedAt, backedUp: schema.webauthnCredentials.backedUp }).from(schema.webauthnCredentials);
    const w = await openEnrollmentInfo();
    let origin = "?", rp = "?"; try { origin = allowedOrigins().join(", "); rp = rpId(); } catch { /* reported below */ }
    console.log(`origin(s): ${origin}\nRP ID:     ${rp}\npasskeys:  ${creds.length}`);
    for (const c of creds) console.log(`  - ${c.label ?? "Passkey"} · created ${c.createdAt.toISOString().slice(0, 10)} · last used ${c.lastUsedAt?.toISOString().slice(0, 16) ?? "never"}${c.backedUp ? " · synced" : ""}`);
    console.log(`sessions:  ${live.n} live\nenrollment window: ${w ? `${w.purpose}, open until ${w.expiresAt.toISOString()}` : "closed"}`);
    const problems = configProblems(); if (problems.length) console.log(`problems:  ${problems.join(" ")}`);
    const legacy = legacyEnvPresent(); if (legacy.length) console.log(`legacy variables still in the environment (remove them from .env): ${legacy.join(", ")}`);
  } else if (cmd === "open-enrollment") await link("bootstrap");
  else if (cmd === "recover") await link("recovery");
  else if (cmd === "close-enrollment") { const n = await closeEnrollments("closed-by-cli"); await audit("auth.enrollment_closed", { n }); console.log(`${n} window(s) closed.`); }
  else if (cmd === "revoke-sessions") { const n = await revokeAllSessions(null, "cli-revoke-all"); await audit("auth.sessions_revoked_all", { n, via: "cli" }); console.log(`${n} session(s) revoked. Every device must sign in again with its passkey.`); if ((await credentialCount()) === 0) console.log("Note: no passkey is registered."); }
  else { console.log("Usage: tsx src/cli/auth.ts status | open-enrollment [minutes] | recover [minutes] [--keep-passkeys] | close-enrollment | revoke-sessions"); process.exitCode = cmd ? 1 : 0; }
} catch (e) { fail((e as Error).message); }
await sql.end();
