import { z } from "zod";
import { publicRoute, json, body, readChallengeCookie, clearChallengeCookie, authenticationResponseSchema } from "@/lib/auth/http";
import { verifyAuthentication, CeremonyError } from "@/lib/auth/webauthn";
import { createSession } from "@/lib/auth/sessions";
import { sessionCookie } from "@/lib/auth/session";
import { recordAttempt, tooManyFailures } from "@/lib/auth/ratelimit";
import { clientIp, safeNext } from "@/lib/auth/tokens";
import { HttpError } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
export const dynamic = "force-dynamic";
/** POST { response, next? } → verifies the assertion against the single-use challenge, then opens a new server-side session (fresh random token). */
export const POST = publicRoute("login.verify", async (req) => {
  const ip = clientIp(req.headers); const ua = req.headers.get("user-agent");
  if (await tooManyFailures(ip)) throw new HttpError(429, "Too many attempts. Wait a minute.", "rate_limited");
  const b = await body(req, z.object({ response: authenticationResponseSchema, next: z.string().max(2000).optional() }));
  try {
    const v = await verifyAuthentication("login", await readChallengeCookie(), b.response as any);
    const s = await createSession({ userId: v.userId, credentialId: v.credentialId, userAgent: ua, ip });
    await recordAttempt(ip, "passkey", true);
    await audit(v.userId, "auth.login", { type: "session", id: s.id }, { passkey: v.label ?? null, ua: ua?.slice(0, 160) ?? null }, ip);
    return json({ ok: true, next: safeNext(b.next) }, { cookies: [sessionCookie(s.token, s.absoluteExpiresAt), clearChallengeCookie()] });
  } catch (e) {
    if (e instanceof CeremonyError) { await recordAttempt(ip, "passkey", false); await audit(null, "auth.login_failed", undefined, { code: e.code, ua: ua?.slice(0, 160) ?? null }, ip); }
    throw e;
  }
});
