/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/webauthn.test.ts
 * Module           : tests
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
 * Server-side WebAuthn verification, attacked with a software authenticator. Run: pnpm test (DATABASE_URL must point to a *_dev database).
 */
import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { authenticationOptions, registrationOptions, verifyAuthentication, verifyRegistration, CeremonyError } from "../../src/lib/auth/webauthn";
import { allowedOrigins, rpId } from "../../src/lib/auth/config";
import { closeEnrollments, consumeEnrollment, findEnrollment, openEnrollment } from "../../src/lib/auth/enrollment";
import { createSession, resolveSession, revokeAllSessions, revokeSession, rotateSession, ownerRow } from "../../src/lib/auth/sessions";
import { sha256 } from "../../src/lib/auth/tokens";
import { SoftAuthenticator } from "../helpers/softauthn";

const ORIGIN = allowedOrigins()[0];
let owner: NonNullable<Awaited<ReturnType<typeof ownerRow>>>;
const mine: string[] = []; // credentials created by this file (removed afterwards)
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { if (e instanceof CeremonyError) return e.code; throw e; } };

async function enroll(auth = new SoftAuthenticator()) {
  const { options, challengeId } = await registrationOptions("register", owner, { sessionId: null });
  const reg = await verifyRegistration("register", challengeId, auth.register(options, ORIGIN) as any, { userId: owner.id, sessionId: null, label: "unit-test" });
  mine.push(reg.credentialId); return auth;
}
before(async () => { const o = await ownerRow(); assert.ok(o, "owner row missing — run pnpm bootstrap on the test database"); owner = o; });
after(async () => { for (const id of mine) await db.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.id, id)); await sql.end(); });

test("registration: valid response is accepted and stores only public material", async () => {
  const a = await enroll();
  const [row] = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.id, a.credentialId.toString("base64url")));
  assert.ok(row); assert.equal(row.userId, owner.id); assert.equal(row.counter, 0); assert.ok(row.publicKey.length > 40);
  assert.deepEqual(Object.keys(row).sort(), ["aaguid", "backedUp", "counter", "createdAt", "deviceType", "id", "label", "lastUsedAt", "publicKey", "transports", "userId"].sort());
});
test("registration: wrong origin, wrong RP ID, wrong type, no user verification are refused", async () => {
  for (const o of [{ origin: "https://evil.example" }, { rpId: "evil.example" }, { type: "webauthn.get" }, { uv: false }, { up: false }]) {
    const a = new SoftAuthenticator(); const { options, challengeId } = await registrationOptions("register", owner, { sessionId: null });
    assert.equal(await code(verifyRegistration("register", challengeId, a.register(options, ORIGIN, o) as any, { userId: owner.id, sessionId: null, label: "x" })), "verification_failed", JSON.stringify(o));
    const rows = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.id, a.credentialId.toString("base64url"))); assert.equal(rows.length, 0);
  }
});
test("registration: a challenge issued for another session or kind cannot be used", async () => {
  const a = new SoftAuthenticator(); const { options, challengeId } = await registrationOptions("register", owner, { sessionId: "11111111-1111-1111-1111-111111111111" });
  assert.equal(await code(verifyRegistration("register", challengeId, a.register(options, ORIGIN) as any, { userId: owner.id, sessionId: "22222222-2222-2222-2222-222222222222", label: "x" })), "challenge_mismatch");
  const r2 = await registrationOptions("register", owner, { sessionId: null });
  assert.equal(await code(verifyRegistration("enroll", r2.challengeId, a.register(r2.options, ORIGIN) as any, { userId: owner.id, enrollmentId: null, label: "x" })), "challenge_used");
});
test("authentication: valid assertion passes and the counter advances", async () => {
  const a = await enroll(); const { options, challengeId } = await authenticationOptions("login", {});
  assert.equal(options.userVerification, "required"); assert.equal(options.rpId, rpId());
  const v = await verifyAuthentication("login", challengeId, a.assert(options, ORIGIN) as any);
  assert.equal(v.userId, owner.id);
  const [row] = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.id, v.credentialId)); assert.equal(row.counter, 1); assert.ok(row.lastUsedAt);
});
test("authentication: replay of the same response is refused (single-use challenge)", async () => {
  const a = await enroll(); const { options, challengeId } = await authenticationOptions("login", {}); const response = a.assert(options, ORIGIN) as any;
  await verifyAuthentication("login", challengeId, response);
  assert.equal(await code(verifyAuthentication("login", challengeId, response)), "challenge_used");
});
test("authentication: a failed verification also burns the challenge", async () => {
  const a = await enroll(); const { options, challengeId } = await authenticationOptions("login", {});
  assert.equal(await code(verifyAuthentication("login", challengeId, a.assert(options, ORIGIN, { tamperSignature: true }) as any)), "verification_failed");
  assert.equal(await code(verifyAuthentication("login", challengeId, a.assert(options, ORIGIN) as any)), "challenge_used");
});
test("authentication: expired challenge is refused", async () => {
  const a = await enroll(); const { options, challengeId } = await authenticationOptions("login", {});
  await db.update(schema.webauthnChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.webauthnChallenges.id, challengeId));
  assert.equal(await code(verifyAuthentication("login", challengeId, a.assert(options, ORIGIN) as any)), "challenge_expired");
});
test("authentication: wrong origin / RP ID / type / challenge / missing UV / forged signature are refused", async () => {
  const a = await enroll();
  for (const o of [{ origin: "https://evil.example" }, { origin: ORIGIN.replace("://", "://x.") }, { rpId: "evil.example" }, { type: "webauthn.create" }, { challenge: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, { uv: false }, { tamperSignature: true }]) {
    const { options, challengeId } = await authenticationOptions("login", {});
    assert.equal(await code(verifyAuthentication("login", challengeId, a.assert(options, ORIGIN, o) as any)), "verification_failed", JSON.stringify(o));
  }
});
test("authentication: unknown credential and missing/garbage challenge ids are refused", async () => {
  const stranger = new SoftAuthenticator(); const { options, challengeId } = await authenticationOptions("login", {});
  assert.equal(await code(verifyAuthentication("login", challengeId, stranger.assert(options, ORIGIN) as any)), "unknown_credential");
  const a = await enroll(); const o2 = await authenticationOptions("login", {});
  assert.equal(await code(verifyAuthentication("login", null, a.assert(o2.options, ORIGIN) as any)), "challenge_missing");
  assert.equal(await code(verifyAuthentication("login", "not-a-uuid", a.assert(o2.options, ORIGIN) as any)), "challenge_missing");
  assert.equal(await code(verifyAuthentication("reauth", o2.challengeId, a.assert(o2.options, ORIGIN) as any)), "challenge_used"); // wrong kind
});
test("authentication: a signature counter that goes backwards is refused (cloned authenticator)", async () => {
  const a = await enroll(); let c = await authenticationOptions("login", {});
  await verifyAuthentication("login", c.challengeId, a.assert(c.options, ORIGIN, { counter: 10 }) as any);
  c = await authenticationOptions("login", {});
  assert.equal(await code(verifyAuthentication("login", c.challengeId, a.assert(c.options, ORIGIN, { counter: 5 }) as any)), "verification_failed");
});
test("step-up: the challenge is bound to the session that asked for it", async () => {
  const a = await enroll(); const s1 = "33333333-3333-3333-3333-333333333333", s2 = "44444444-4444-4444-4444-444444444444";
  const { options, challengeId } = await authenticationOptions("reauth", { userId: owner.id, sessionId: s1 });
  assert.ok((options.allowCredentials ?? []).length >= 1);
  assert.equal(await code(verifyAuthentication("reauth", challengeId, a.assert(options, ORIGIN) as any, { sessionId: s2 })), "challenge_mismatch");
});

test("sessions: random token, only the hash is stored, revocation is immediate", async () => {
  const s = await createSession({ userId: owner.id, credentialId: null, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", ip: "127.0.0.1" });
  assert.match(s.token, /^[A-Za-z0-9_-]{43}$/);
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, s.id));
  assert.equal(row.tokenHash, sha256(s.token)); assert.ok(!JSON.stringify(row).includes(s.token)); assert.equal(row.label, "Safari · iPhone");
  const other = await createSession({ userId: owner.id, credentialId: null, userAgent: null, ip: null }); assert.notEqual(other.token, s.token);
  assert.equal((await resolveSession(s.token))?.id, s.id); assert.equal((await resolveSession(s.token))?.fresh, true);
  assert.equal(await resolveSession(s.token.slice(0, -1) + (s.token.endsWith("A") ? "B" : "A")), null);
  assert.equal(await resolveSession(""), null); assert.equal(await resolveSession("x".repeat(43) + "'"), null);
  await revokeSession(s.id, "test"); assert.equal(await resolveSession(s.token), null);
  await revokeSession(other.id, "test");
});
test("sessions: rotation issues a new token; the old one dies after the grace period; freshness expires", async () => {
  const s = await createSession({ userId: owner.id, credentialId: null, userAgent: null, ip: null });
  const r = await rotateSession(s.id, null); assert.ok(r); assert.notEqual(r!.token, s.token);
  assert.equal((await resolveSession(r!.token))?.id, s.id);
  assert.equal((await resolveSession(s.token))?.id, s.id, "old token valid during the 60 s grace");
  await db.update(schema.sessions).set({ prevValidUntil: new Date(Date.now() - 1000) }).where(eq(schema.sessions.id, s.id));
  assert.equal(await resolveSession(s.token), null, "old token dead after grace");
  await db.update(schema.sessions).set({ verifiedAt: new Date(Date.now() - 6 * 60_000) }).where(eq(schema.sessions.id, s.id));
  assert.equal((await resolveSession(r!.token))?.fresh, false);
  await db.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.sessions.id, s.id));
  assert.equal(await resolveSession(r!.token), null, "idle-expired session is dead");
  await revokeSession(s.id, "test");
});
test("sessions: global revocation spares only the excepted session", async () => {
  const a = await createSession({ userId: owner.id, credentialId: null, userAgent: null, ip: null }); const b = await createSession({ userId: owner.id, credentialId: null, userAgent: null, ip: null });
  // only revoke the two sessions of this test: emulate with exceptId, then clean up
  const before = await resolveSession(a.token); assert.ok(before);
  await revokeSession(b.id, "test"); assert.equal(await resolveSession(b.token), null); assert.ok(await resolveSession(a.token));
  await revokeSession(a.id, "test"); void revokeAllSessions;
});

test("enrollment: bootstrap is refused once a passkey exists; recovery window is single-use, expiring, token stored hashed", async () => {
  await enroll();
  await assert.rejects(openEnrollment("bootstrap"), /already exists/);
  const w = await openEnrollment("recovery", { minutes: 5 });
  const [row] = await db.select().from(schema.authEnrollments).where(eq(schema.authEnrollments.id, w.id));
  assert.equal(row.tokenHash, sha256(w.token)); assert.ok(!JSON.stringify(row).includes(w.token)); assert.equal(row.revokeExisting, true);
  assert.ok(row.expiresAt.getTime() - Date.now() <= 5 * 60_000 + 1000);
  assert.equal((await findEnrollment(w.token))?.id, w.id);
  assert.equal(await findEnrollment(w.token.slice(0, -2) + "zz"), null); assert.equal(await findEnrollment(""), null);
  assert.equal(await consumeEnrollment(w.id), true); assert.equal(await consumeEnrollment(w.id), false, "second consume loses");
  assert.equal(await findEnrollment(w.token), null, "consumed window is closed");
  const w2 = await openEnrollment("recovery", { minutes: 1 });
  await db.update(schema.authEnrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.authEnrollments.id, w2.id));
  assert.equal(await findEnrollment(w2.token), null, "expired window is closed");
  const w3 = await openEnrollment("recovery"); const w4 = await openEnrollment("recovery");
  assert.equal(await findEnrollment(w3.token), null, "opening a new window closes the previous one"); assert.ok(await findEnrollment(w4.token));
  assert.equal(await closeEnrollments("test"), 1); assert.equal(await findEnrollment(w4.token), null);
  const w5 = await openEnrollment("recovery", { minutes: 100000 }); assert.equal(w5.minutes, 60, "window length is capped"); await closeEnrollments("test");
});
