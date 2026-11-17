import { z } from "zod";
import { handler, HttpError } from "@/lib/api";
import { verifyAuthentication, CeremonyError } from "@/lib/auth/webauthn";
import { rotateSession } from "@/lib/auth/sessions";
import { sessionCookie } from "@/lib/auth/session";
import { json, body, readChallengeCookie, clearChallengeCookie, authenticationResponseSchema, ceremonyError } from "@/lib/auth/http";
import { FRESH_MS } from "@/lib/auth/config";
import { audit } from "@/lib/audit";
/** POST { response } → step-up: on success the session token is ROTATED (old one valid 60 s for requests in flight) and marked fresh for 5 minutes. */
export const POST = handler(async ({ req, user, requestId }) => {
  const b = await body(req, z.object({ response: authenticationResponseSchema }));
  try {
    const v = await verifyAuthentication("reauth", await readChallengeCookie(), b.response as any, { sessionId: user.sessionId });
    const r = await rotateSession(user.sessionId, v.credentialId); if (!r) throw new HttpError(401, "Session ended", "unauthenticated");
    await audit(user.id, "auth.step_up", { type: "session", id: user.sessionId }, { passkey: v.label ?? null });
    return json({ ok: true, freshForMs: FRESH_MS }, { cookies: [sessionCookie(r.token, r.absoluteExpiresAt), clearChallengeCookie()] });
  } catch (e) { if (e instanceof CeremonyError) { await audit(user.id, "auth.step_up_failed", undefined, { code: e.code }); return ceremonyError(e, requestId); } throw e; }
});
