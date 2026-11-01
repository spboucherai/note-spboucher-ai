import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, createSession, setSessionCookie, clientIp } from "@/lib/auth/session";
import { assertSameOrigin, jsonError, HttpError } from "@/lib/auth/guard";
import { rateLimit } from "@/lib/auth/ratelimit";
import { audit } from "@/lib/audit";
import { headers } from "next/headers";

const rpID = () => process.env.WEBAUTHN_RP_ID ?? "localhost";
const origin = () => process.env.WEBAUTHN_ORIGIN ?? process.env.APP_URL ?? "http://localhost:8480";
const b64 = (b: Uint8Array | string) => (typeof b === "string" ? b : Buffer.from(b).toString("base64url"));

/** GET ?step=options → authentication options (login, no session).  GET ?step=register → registration options (needs session). */
export async function GET(req: Request) {
  try {
    const step = new URL(req.url).searchParams.get("step");
    const ip = clientIp(await headers());
    if (!rateLimit(`pk:${ip}`, 20, 10 * 60_000)) throw new HttpError(429, "Too many attempts");
    if (step === "register") {
      const s = await getSession(); if (!s) throw new HttpError(401, "Unauthenticated");
      const existing = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, s.id));
      const options = await generateRegistrationOptions({ rpName: "Note SPBoucher AI", rpID: rpID(), userName: s.username, userDisplayName: s.displayName, attestationType: "none", authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" }, excludeCredentials: existing.map((c) => ({ id: c.id, transports: (c.transports ?? []) as any })) });
      const [ch] = await db.insert(schema.webauthnChallenges).values({ userId: s.id, challenge: options.challenge, kind: "register" }).returning();
      return Response.json({ challengeId: ch.id, options });
    }
    const options = await generateAuthenticationOptions({ rpID: rpID(), userVerification: "preferred" });
    const [ch] = await db.insert(schema.webauthnChallenges).values({ challenge: options.challenge, kind: "auth" }).returning();
    return Response.json({ challengeId: ch.id, options });
  } catch (e) { return jsonError(e); }
}
/** POST { challengeId, response, label? } → verify authentication (login) or registration (when session exists and challenge kind=register). */
export async function POST(req: Request) {
  try {
    await assertSameOrigin();
    const { challengeId, response, label } = await req.json();
    const [ch] = await db.select().from(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.id, String(challengeId)));
    if (!ch || Date.now() - ch.createdAt.getTime() > 5 * 60_000) throw new HttpError(400, "Challenge expired");
    await db.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.id, ch.id));
    const ip = clientIp(await headers());
    if (ch.kind === "register") {
      const s = await getSession(); if (!s || s.id !== ch.userId) throw new HttpError(401, "Unauthenticated");
      const v = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: origin(), expectedRPID: rpID() });
      if (!v.verified || !v.registrationInfo) throw new HttpError(400, "Registration failed");
      const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
      await db.insert(schema.webauthnCredentials).values({ id: credential.id, userId: s.id, publicKey: b64(credential.publicKey), counter: credential.counter, transports: credential.transports ?? [], deviceType: credentialDeviceType, backedUp: credentialBackedUp, label: String(label ?? "Passkey").slice(0, 60) });
      await audit(s.id, "auth.passkey_registered", undefined, { label }, ip);
      return Response.json({ ok: true });
    }
    const credId = String(response?.id ?? "");
    const [cred] = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.id, credId));
    if (!cred) throw new HttpError(401, "Unknown passkey");
    const v = await verifyAuthenticationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: origin(), expectedRPID: rpID(), credential: { id: cred.id, publicKey: new Uint8Array(Buffer.from(cred.publicKey, "base64url")), counter: cred.counter, transports: (cred.transports ?? []) as any } });
    if (!v.verified) { await audit(cred.userId, "auth.passkey_failed", undefined, {}, ip); throw new HttpError(401, "Passkey verification failed"); }
    await db.update(schema.webauthnCredentials).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(schema.webauthnCredentials.id, cred.id));
    const token = await createSession(cred.userId, { mfaPassed: true }); await setSessionCookie(token);
    await audit(cred.userId, "auth.login_passkey", undefined, {}, ip);
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
/** DELETE { id } → remove a passkey. */
export async function DELETE(req: Request) {
  try { await assertSameOrigin(); const s = await getSession(); if (!s) throw new HttpError(401, "Unauthenticated"); const { id } = await req.json(); await db.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.id, String(id))); await audit(s.id, "auth.passkey_removed", undefined, { id }); return Response.json({ ok: true }); } catch (e) { return jsonError(e); }
}
