import { handler } from "@/lib/api";
import { allowedOrigins, FRESH_MS, legacyEnvPresent, rpId, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "@/lib/auth/config";
import { openEnrollmentInfo } from "@/lib/auth/enrollment";
/** GET → what Settings → Security shows about the current session and the server configuration (no secrets). */
export const GET = handler(async ({ user }) => Response.json({
  sessionId: user.sessionId, fresh: user.fresh, verifiedAt: user.verifiedAt, freshWindowMs: FRESH_MS, idleDays: SESSION_IDLE_MS / 86_400_000, absoluteDays: SESSION_ABSOLUTE_MS / 86_400_000,
  rpId: rpId(), origins: allowedOrigins(), legacyEnv: legacyEnvPresent(), enrollmentOpen: await openEnrollmentInfo(),
}));
