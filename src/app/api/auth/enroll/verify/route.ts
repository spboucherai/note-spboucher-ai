import { z } from "zod";
import { ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { publicRoute, json, body, readChallengeCookie, clearChallengeCookie, registrationResponseSchema } from "@/lib/auth/http";
import { verifyRegistration, CeremonyError } from "@/lib/auth/webauthn";
import { consumeEnrollment, findEnrollment } from "@/lib/auth/enrollment";
import { createSession, ownerRow, revokeAllSessions } from "@/lib/auth/sessions";
import { sessionCookie } from "@/lib/auth/session";
import { recordAttempt, tooManyFailures } from "@/lib/auth/ratelimit";
import { clientIp, deviceLabel } from "@/lib/auth/tokens";
import { HttpError } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
export const dynamic = "force-dynamic";
/**
 * POST { token, response, label? } → registers the passkey of an enrollment window, closes the window (single use) and signs this device in.
 * Recovery windows additionally revoke every session and, unless opened with --keep-passkeys, delete every previous passkey.
 */
export const POST = publicRoute("enroll.verify", async (req) => {
  const ip = clientIp(req.headers); const ua = req.headers.get("user-agent");
  if (await tooManyFailures(ip)) throw new HttpError(429, "Too many attempts. Wait a minute.", "rate_limited");
  const b = await body(req, z.object({ token: z.string().min(40).max(64), response: registrationResponseSchema, label: z.string().trim().max(60).optional() }));
  const w = await findEnrollment(b.token); const owner = await ownerRow();
  if (!w || !owner) { await recordAttempt(ip, "enroll", false); await audit(null, "auth.enroll_denied", undefined, { stage: "verify" }, ip); throw new HttpError(403, "This enrollment link is invalid, expired or already used.", "enrollment_closed"); }
  try {
    // Claim the window BEFORE writing the credential: two racing registrations cannot both succeed.
    if (!(await consumeEnrollment(w.id))) throw new HttpError(403, "This enrollment link was just used.", "enrollment_closed");
    const reg = await verifyRegistration("enroll", await readChallengeCookie(), b.response as any, { userId: owner.id, enrollmentId: w.id, label: b.label || deviceLabel(ua) });
    let removed = 0, revoked = 0;
    if (w.purpose === "recovery") {
      revoked = await revokeAllSessions(owner.id, "recovery");
      if (w.revokeExisting) removed = (await db.delete(schema.webauthnCredentials).where(ne(schema.webauthnCredentials.id, reg.credentialId)).returning({ id: schema.webauthnCredentials.id })).length;
    }
    const s = await createSession({ userId: owner.id, credentialId: reg.credentialId, userAgent: ua, ip });
    await recordAttempt(ip, "enroll", true);
    await audit(owner.id, w.purpose === "recovery" ? "auth.recovery_completed" : "auth.passkey_bootstrap", { type: "passkey", id: reg.credentialId.slice(0, 16) }, { label: reg.label, passkeysRemoved: removed, sessionsRevoked: revoked }, ip);
    return json({ ok: true, purpose: w.purpose, label: reg.label }, { cookies: [sessionCookie(s.token, s.absoluteExpiresAt), clearChallengeCookie()] });
  } catch (e) {
    if (e instanceof CeremonyError) { await recordAttempt(ip, "enroll", false); await audit(null, "auth.enroll_failed", undefined, { code: e.code }, ip); }
    throw e;
  }
});
