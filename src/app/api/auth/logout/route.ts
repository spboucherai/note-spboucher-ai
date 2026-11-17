import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { resolveSession, revokeSession } from "@/lib/auth/sessions";
import { clearSessionCookie } from "@/lib/auth/session";
import { assertSameOrigin, jsonError } from "@/lib/auth/guard";
import { json } from "@/lib/auth/http";
import { audit } from "@/lib/audit";
export const dynamic = "force-dynamic";
/** POST → "Lock this device": revokes the current server-side session and clears the cookie. Always answers 200 so a dead session can still be cleaned up. */
export async function POST() {
  try {
    await assertSameOrigin();
    const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
    if (s) { await revokeSession(s.id, "logout"); await audit(s.userId, "auth.logout", { type: "session", id: s.id }); }
    return json({ ok: true }, { cookies: [clearSessionCookie()] });
  } catch (e) { return jsonError(e); }
}
