import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie, clientIp } from "@/lib/auth/session";
import { loginAllowed, recordAttempt } from "@/lib/auth/ratelimit";
import { assertSameOrigin, jsonError } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { headers } from "next/headers";

export async function POST(req: Request) {
  try {
    await assertSameOrigin();
    const ip = clientIp(await headers());
    const body = await req.json().catch(() => ({}));
    const username = String(body.username ?? "").trim().toLowerCase().slice(0, 64);
    const password = String(body.password ?? "");
    if (!username || !password) return Response.json({ error: "Missing credentials" }, { status: 400 });
    const allowed = await loginAllowed(ip, username);
    if (!allowed.ok) return Response.json({ error: `Too many attempts. Try again in ${Math.ceil(allowed.retryAfterSec / 60)} min.` }, { status: 429, headers: { "Retry-After": String(allowed.retryAfterSec) } });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
    const ok = u ? await verifyPassword(u.passwordHash, password) : (await verifyPassword("$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", password), false);
    await recordAttempt(ip, username, ok);
    if (!ok || !u) { await audit(null, "auth.login_failed", undefined, { username }, ip); return Response.json({ error: "Invalid username or password" }, { status: 401 }); }
    const token = await createSession(u.id, { mfaPassed: !u.totpEnabled });
    await setSessionCookie(token);
    await audit(u.id, "auth.login", { type: "user", id: u.id }, {}, ip);
    return Response.json({ ok: true, mfaRequired: u.totpEnabled });
  } catch (e) { return jsonError(e); }
}
