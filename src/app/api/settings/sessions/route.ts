import { z } from "zod";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { revokeSession, revokeAllSessions } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl/.test(ua) ? "curl" : "Browser";
  return `${br} · ${os}`;
}
/** GET → active sessions of the current user (current one flagged). */
export const GET = handler(async ({ user }) => {
  const rows = await db.select().from(schema.sessions).where(and(eq(schema.sessions.userId, user.id), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date()))).orderBy(desc(schema.sessions.lastSeenAt)).limit(50);
  return Response.json(rows.map((s) => ({ id: s.id, device: device(s.userAgent), userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, mfaPassed: s.mfaPassed, current: s.id === user.sessionId })));
});
/** DELETE { id } → revoke one session; DELETE { all: true } → revoke every other session ("sign out everywhere"). */
export const DELETE = handler(async ({ req, user }) => {
  const b = await parseBody(req, z.object({ id: uuid.optional(), all: z.boolean().optional() }));
  if (b.all) { await revokeAllSessions(user.id, user.sessionId); await audit(user.id, "auth.sessions_revoked_all"); return Response.json({ ok: true }); }
  if (!b.id) throw new HttpError(400, "id or all required");
  const [s] = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(and(eq(schema.sessions.id, b.id), eq(schema.sessions.userId, user.id)));
  if (!s) throw new HttpError(404, "Session not found");
  await revokeSession(b.id); await audit(user.id, "auth.session_revoked", { type: "session", id: b.id });
  return Response.json({ ok: true, current: b.id === user.sessionId });
});
