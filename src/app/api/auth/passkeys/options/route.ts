import { handler } from "@/lib/api";
import { registrationOptions } from "@/lib/auth/webauthn";
import { challengeCookie, json } from "@/lib/auth/http";
/** POST → registration options for an ADDITIONAL passkey. Requires a passkey verification younger than 5 minutes. */
export const POST = handler(async ({ user }) => {
  const { options, challengeId } = await registrationOptions("register", user, { sessionId: user.sessionId });
  return json({ options }, { cookies: [challengeCookie(challengeId)] });
}, { fresh: true });
