import "server-only";
import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { cache } from "react";

export const COOKIE = process.env.NODE_ENV === "production" ? "__Host-note_session" : "note_session";
const IDLE_DAYS = 30, ABS_DAYS = 90;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(userId: string, opts: { mfaPassed?: boolean } = {}) {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  const now = new Date();
  await db.insert(schema.sessions).values({
    userId, tokenHash: sha(token), userAgent: h.get("user-agent")?.slice(0, 300) ?? null, ip: clientIp(h),
    expiresAt: new Date(now.getTime() + IDLE_DAYS * 864e5), absoluteExpiresAt: new Date(now.getTime() + ABS_DAYS * 864e5), mfaPassed: opts.mfaPassed ?? false,
  });
  return token;
}
export function clientIp(h: Headers) { return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "0.0.0.0").trim(); }

export async function setSessionCookie(token: string) {
  const c = await cookies();
  c.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: ABS_DAYS * 86400 });
}
export async function clearSessionCookie() { (await cookies()).set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 }); }

export type SessionUser = { id: string; username: string; displayName: string; email: string | null; totpEnabled: boolean; preferences: Record<string, unknown>; sessionId: string; mfaPassed: boolean };

/** Resolve the current session (cached per request). Returns null when unauthenticated. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const now = new Date();
  const rows = await db.select({ s: schema.sessions, u: schema.users }).from(schema.sessions).innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, sha(token)), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, now), gt(schema.sessions.absoluteExpiresAt, now))).limit(1);
  if (!rows.length) return null;
  const { s, u } = rows[0];
  if (now.getTime() - s.lastSeenAt.getTime() > 10 * 60_000) {
    db.update(schema.sessions).set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + IDLE_DAYS * 864e5) }).where(eq(schema.sessions.id, s.id)).catch(() => {});
  }
  return { id: u.id, username: u.username, displayName: u.displayName, email: u.email, totpEnabled: u.totpEnabled, preferences: u.preferences, sessionId: s.id, mfaPassed: s.mfaPassed };
});

export async function revokeSession(sessionId: string) { await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, sessionId)); }
export async function revokeAllSessions(userId: string, exceptId?: string) {
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt), exceptId ? lt(schema.sessions.id, exceptId) : undefined));
  if (exceptId) await db.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt), gt(schema.sessions.id, exceptId)));
}
export async function markMfaPassed(sessionId: string) { await db.update(schema.sessions).set({ mfaPassed: true }).where(eq(schema.sessions.id, sessionId)); }
