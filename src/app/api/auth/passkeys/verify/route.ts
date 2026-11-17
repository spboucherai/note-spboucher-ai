import { z } from "zod";
import { handler } from "@/lib/api";
import { verifyRegistration, CeremonyError } from "@/lib/auth/webauthn";
import { json, body, readChallengeCookie, clearChallengeCookie, registrationResponseSchema, ceremonyError } from "@/lib/auth/http";
import { deviceLabel } from "@/lib/auth/tokens";
import { audit } from "@/lib/audit";
/** POST { response, label } → stores the additional passkey (fresh verification required). */
export const POST = handler(async ({ req, user, requestId }) => {
  const b = await body(req, z.object({ response: registrationResponseSchema, label: z.string().trim().max(60).optional() }));
  try {
    const reg = await verifyRegistration("register", await readChallengeCookie(), b.response as any, { userId: user.id, sessionId: user.sessionId, label: b.label || deviceLabel(req.headers.get("user-agent")) });
    await audit(user.id, "auth.passkey_added", { type: "passkey", id: reg.credentialId.slice(0, 16) }, { label: reg.label });
    return json({ ok: true, id: reg.credentialId, label: reg.label }, { cookies: [clearChallengeCookie()] });
  } catch (e) { if (e instanceof CeremonyError) return ceremonyError(e, requestId); throw e; }
}, { fresh: true });
