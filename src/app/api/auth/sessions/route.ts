import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { listSessions, revokeAllSessions } from "@/lib/auth/sessions";
import { clearSessionCookie } from "@/lib/auth/session";
import { json } from "@/lib/auth/http";
import { audit } from "@/lib/audit";
/** GET → live sessions (device label, first/last activity, expiry). Tokens are never returned — only their hash exists server-side. */
export const GET = handler(async ({ user }) => {
  const rows = await listSessions(user.id);
  return Response.json(rows.map((s) => ({ id: s.id, label: s.label ?? "Device", ip: s.ip, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt < s.absoluteExpiresAt ? s.expiresAt : s.absoluteExpiresAt, current: s.id === user.sessionId })));
});
/** DELETE { includeCurrent } → global revocation (fresh verification required). */
export const DELETE = handler(async ({ req, user }) => {
  const b = await parseBody(req, z.object({ includeCurrent: z.boolean().default(false) }));
  const n = await revokeAllSessions(user.id, "revoke-all", b.includeCurrent ? null : user.sessionId);
  await audit(user.id, "auth.sessions_revoked_all", undefined, { n, includeCurrent: b.includeCurrent });
  return json({ ok: true, revoked: n }, { cookies: b.includeCurrent ? [clearSessionCookie()] : [] });
}, { fresh: true });
