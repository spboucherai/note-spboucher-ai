import { handler } from "@/lib/api";
import { authenticationOptions } from "@/lib/auth/webauthn";
import { challengeCookie, json } from "@/lib/auth/http";
/** POST → options for a step-up verification by the signed-in owner (any registered passkey, user verification required). */
export const POST = handler(async ({ user }) => {
  const { options, challengeId } = await authenticationOptions("reauth", { userId: user.id, sessionId: user.sessionId });
  return json({ options }, { cookies: [challengeCookie(challengeId)] });
});
