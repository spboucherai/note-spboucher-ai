import { getSession, revokeSession, clearSessionCookie, revokeAllSessions } from "@/lib/auth/session";
import { assertSameOrigin, jsonError } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
export async function POST(req: Request) {
  try {
    await assertSameOrigin();
    const s = await getSession();
    const all = new URL(req.url).searchParams.get("all") === "1";
    if (s) { if (all) await revokeAllSessions(s.id); else await revokeSession(s.sessionId); await audit(s.id, all ? "auth.logout_all" : "auth.logout"); }
    await clearSessionCookie();
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
