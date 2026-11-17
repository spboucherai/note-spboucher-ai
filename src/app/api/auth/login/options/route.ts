import { publicRoute, challengeCookie, json } from "@/lib/auth/http";
import { authenticationOptions } from "@/lib/auth/webauthn";
import { credentialCount } from "@/lib/auth/enrollment";
import { tooManyFailures } from "@/lib/auth/ratelimit";
import { clientIp } from "@/lib/auth/tokens";
import { HttpError } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
/** POST → WebAuthn request options for a usernameless sign-in (discoverable credential, user verification REQUIRED). */
export const POST = publicRoute("login.options", async (req) => {
  if (await tooManyFailures(clientIp(req.headers))) throw new HttpError(429, "Too many attempts. Wait a minute.", "rate_limited");
  if ((await credentialCount()) === 0) throw new HttpError(409, "No passkey is registered yet. Open an enrollment window from the server.", "not_enrolled");
  const { options, challengeId } = await authenticationOptions("login", {});
  return json({ options }, { cookies: [challengeCookie(challengeId)] });
});
