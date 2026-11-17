/**
 * WebAuthn ceremonies (SimpleWebAuthn server 14). No hand-rolled crypto: the library checks the challenge, origin, RP ID hash,
 * ceremony type, signature, user presence and user verification; this file owns challenge storage (random, single use, 5 minutes,
 * bound to the requesting browser by an HttpOnly cookie) and the credential table.
 * Stored per passkey: credential id, COSE public key, signature counter, transports, device type, backup flag, AAGUID, label. Nothing biometric
 * ever reaches the server — the authenticator only asserts "user verified".
 */
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON, WebAuthnCredential } from "@simplewebauthn/server";
type AuthenticatorTransportFuture = NonNullable<WebAuthnCredential["transports"]>[number];
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "../../db/index";
import { allowedOrigins, CHALLENGE_TTL_MS, RP_NAME, rpId } from "./config";

export type CeremonyKind = "login" | "reauth" | "register" | "enroll";
export class CeremonyError extends Error { constructor(public code: string, message: string) { super(message); } }

async function saveChallenge(kind: CeremonyKind, challenge: string, ctx: { userId?: string | null; sessionId?: string | null; enrollmentId?: string | null }) {
  if (Math.random() < 0.1) await db.delete(schema.webauthnChallenges).where(lt(schema.webauthnChallenges.expiresAt, new Date())).catch(() => {});
  const [row] = await db.insert(schema.webauthnChallenges).values({ kind, challenge, userId: ctx.userId ?? null, sessionId: ctx.sessionId ?? null, enrollmentId: ctx.enrollmentId ?? null, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) }).returning({ id: schema.webauthnChallenges.id });
  return row.id;
}
/** Atomic single use: the row is deleted by the same statement that reads it. Expired, unknown, wrong-kind or replayed ids yield a CeremonyError. */
async function takeChallenge(id: string | null | undefined, kind: CeremonyKind) {
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new CeremonyError("challenge_missing", "No pending passkey request for this browser. Start again.");
  const [row] = await db.delete(schema.webauthnChallenges).where(and(eq(schema.webauthnChallenges.id, id), eq(schema.webauthnChallenges.kind, kind))).returning();
  if (!row) throw new CeremonyError("challenge_used", "This passkey request was already used or does not exist. Start again.");
  if (!row.expiresAt || row.expiresAt.getTime() < Date.now()) throw new CeremonyError("challenge_expired", "This passkey request expired. Start again.");
  return row;
}
const toUint8 = (b64url: string) => new Uint8Array(Buffer.from(b64url, "base64url"));

// ---------- authentication (sign-in and step-up)
export async function authenticationOptions(kind: "login" | "reauth", ctx: { userId?: string | null; sessionId?: string | null }) {
  const creds = kind === "reauth" ? await db.select({ id: schema.webauthnCredentials.id, transports: schema.webauthnCredentials.transports }).from(schema.webauthnCredentials) : [];
  const options = await generateAuthenticationOptions({ rpID: rpId(), userVerification: "required", timeout: 120_000, allowCredentials: creds.map((c) => ({ id: c.id, transports: (c.transports ?? []) as AuthenticatorTransportFuture[] })) });
  const challengeId = await saveChallenge(kind, options.challenge, ctx);
  return { options, challengeId };
}
export async function verifyAuthentication(kind: "login" | "reauth", challengeId: string | null | undefined, response: AuthenticationResponseJSON, expect: { sessionId?: string | null } = {}) {
  const ch = await takeChallenge(challengeId, kind);
  if (kind === "reauth" && ch.sessionId !== (expect.sessionId ?? null)) throw new CeremonyError("challenge_mismatch", "This passkey request belongs to another session.");
  if (!response || typeof response.id !== "string") throw new CeremonyError("bad_response", "Malformed passkey response.");
  const [cred] = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.id, response.id)).limit(1);
  if (!cred) throw new CeremonyError("unknown_credential", "This passkey is not registered for this site.");
  let result;
  try {
    result = await verifyAuthenticationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: allowedOrigins(), expectedRPID: rpId(), expectedType: "webauthn.get", requireUserVerification: true, credential: { id: cred.id, publicKey: toUint8(cred.publicKey), counter: cred.counter, transports: (cred.transports ?? []) as AuthenticatorTransportFuture[] } });
  } catch (e) { throw new CeremonyError("verification_failed", (e as Error).message); }
  if (!result.verified || !result.authenticationInfo.userVerified) throw new CeremonyError("verification_failed", "The passkey signature could not be verified.");
  await db.update(schema.webauthnCredentials).set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date(), backedUp: result.authenticationInfo.credentialBackedUp, deviceType: result.authenticationInfo.credentialDeviceType }).where(eq(schema.webauthnCredentials.id, cred.id));
  return { credentialId: cred.id, userId: cred.userId, label: cred.label };
}

// ---------- registration (bootstrap / recovery window, or a signed-in owner with a fresh verification)
export async function registrationOptions(kind: "register" | "enroll", owner: { id: string; username: string; displayName: string }, ctx: { sessionId?: string | null; enrollmentId?: string | null }) {
  const existing = await db.select({ id: schema.webauthnCredentials.id, transports: schema.webauthnCredentials.transports }).from(schema.webauthnCredentials);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: rpId(), userName: owner.username, userDisplayName: owner.displayName, userID: new Uint8Array(Buffer.from(owner.id.replace(/-/g, ""), "hex")),
    attestationType: "none", timeout: 120_000,
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: (c.transports ?? []) as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
  });
  const challengeId = await saveChallenge(kind, options.challenge, { userId: owner.id, ...ctx });
  return { options, challengeId };
}
export async function verifyRegistration(kind: "register" | "enroll", challengeId: string | null | undefined, response: RegistrationResponseJSON, expect: { userId: string; sessionId?: string | null; enrollmentId?: string | null; label: string }) {
  const ch = await takeChallenge(challengeId, kind);
  if (ch.userId !== expect.userId) throw new CeremonyError("challenge_mismatch", "This passkey request belongs to another context.");
  if (kind === "register" && ch.sessionId !== (expect.sessionId ?? null)) throw new CeremonyError("challenge_mismatch", "This passkey request belongs to another session.");
  if (kind === "enroll" && ch.enrollmentId !== (expect.enrollmentId ?? null)) throw new CeremonyError("challenge_mismatch", "This passkey request belongs to another enrollment window.");
  let result;
  try {
    result = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: allowedOrigins(), expectedRPID: rpId(), expectedType: "webauthn.create", requireUserPresence: true, requireUserVerification: true });
  } catch (e) { throw new CeremonyError("verification_failed", (e as Error).message); }
  if (!result.verified || !result.registrationInfo?.userVerified) throw new CeremonyError("verification_failed", "The new passkey could not be verified.");
  const info = result.registrationInfo;
  const row = { id: info.credential.id, userId: expect.userId, publicKey: Buffer.from(info.credential.publicKey).toString("base64url"), counter: info.credential.counter, transports: (info.credential.transports ?? response.response?.transports ?? []) as string[], deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp, aaguid: info.aaguid, label: expect.label.trim().slice(0, 60) || "Passkey" };
  const inserted = await db.insert(schema.webauthnCredentials).values(row).onConflictDoNothing().returning({ id: schema.webauthnCredentials.id });
  if (!inserted.length) throw new CeremonyError("duplicate_credential", "This passkey is already registered.");
  return { credentialId: row.id, label: row.label };
}
export async function listPasskeys(userId: string) {
  return db.select({ id: schema.webauthnCredentials.id, label: schema.webauthnCredentials.label, createdAt: schema.webauthnCredentials.createdAt, lastUsedAt: schema.webauthnCredentials.lastUsedAt, deviceType: schema.webauthnCredentials.deviceType, backedUp: schema.webauthnCredentials.backedUp, transports: schema.webauthnCredentials.transports }).from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, userId)).orderBy(schema.webauthnCredentials.createdAt);
}
