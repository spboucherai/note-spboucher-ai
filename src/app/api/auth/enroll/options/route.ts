import { z } from "zod";
import { publicRoute, challengeCookie, json, body } from "@/lib/auth/http";
import { registrationOptions } from "@/lib/auth/webauthn";
import { findEnrollment } from "@/lib/auth/enrollment";
import { ownerRow } from "@/lib/auth/sessions";
import { recordAttempt, tooManyFailures } from "@/lib/auth/ratelimit";
import { clientIp } from "@/lib/auth/tokens";
import { HttpError } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
export const dynamic = "force-dynamic";
/** POST { token } → registration options, only while an enrollment window opened from the node CLI is valid for this exact token. */
export const POST = publicRoute("enroll.options", async (req) => {
  const ip = clientIp(req.headers);
  if (await tooManyFailures(ip)) throw new HttpError(429, "Too many attempts. Wait a minute.", "rate_limited");
  const b = await body(req, z.object({ token: z.string().min(40).max(64) }));
  const w = await findEnrollment(b.token); const owner = await ownerRow();
  if (!w || !owner) { await recordAttempt(ip, "enroll", false); await audit(null, "auth.enroll_denied", undefined, { stage: "options" }, ip); throw new HttpError(403, "This enrollment link is invalid, expired or already used.", "enrollment_closed"); }
  const { options, challengeId } = await registrationOptions("enroll", owner, { enrollmentId: w.id });
  return json({ options, purpose: w.purpose, revokeExisting: w.revokeExisting, expiresAt: w.expiresAt }, { cookies: [challengeCookie(challengeId)] });
});
