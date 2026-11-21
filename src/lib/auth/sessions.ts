/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/auth/sessions.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

/**
 * Server-side sessions (v2). The cookie carries a 256-bit random token; the database stores only its SHA-256.
 * Sessions are revocable, slide on activity (idle 30 days, hard cap 90 days) and their token is rotated at sign-in and at every step-up.
 * No Next.js imports here: used by route handlers, the proxy and the CLI alike.
 */
import { and, desc, eq, gt, isNull, ne, or, sql as dsql } from "drizzle-orm";
import { db, schema } from "../../db/index";
import { FRESH_MS, ROTATION_GRACE_MS, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "./config";
import { deviceLabel, newToken, sha256 } from "./tokens";

export type SessionRow = typeof schema.sessions.$inferSelect;
export interface ResolvedSession { id: string; userId: string; verifiedAt: Date | null; fresh: boolean; credentialId: string | null; createdAt: Date; label: string | null }

const live = () => and(isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date()), gt(schema.sessions.absoluteExpiresAt, new Date()));

export async function createSession(input: { userId: string; credentialId: string | null; userAgent: string | null; ip: string | null }): Promise<{ token: string; id: string; absoluteExpiresAt: Date }> {
  const token = newToken(); const now = Date.now();
  const absoluteExpiresAt = new Date(now + SESSION_ABSOLUTE_MS);
  const [row] = await db.insert(schema.sessions).values({ userId: input.userId, tokenHash: sha256(token), userAgent: input.userAgent?.slice(0, 300) ?? null, ip: input.ip, expiresAt: new Date(now + SESSION_IDLE_MS), absoluteExpiresAt, mfaPassed: true, credentialId: input.credentialId, label: deviceLabel(input.userAgent), verifiedAt: new Date(now) }).returning({ id: schema.sessions.id });
  return { token, id: row.id, absoluteExpiresAt };
}

/** Resolve a cookie token. Accepts the previous token for a short grace period after a rotation (requests already in flight). */
export async function resolveSession(token: string | undefined | null): Promise<ResolvedSession | null> {
  if (!token || token.length < 40 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const h = sha256(token);
  const [s] = await db.select().from(schema.sessions).where(and(live(), or(eq(schema.sessions.tokenHash, h), and(eq(schema.sessions.prevTokenHash, h), gt(schema.sessions.prevValidUntil, new Date()))))).limit(1);
  if (!s) return null;
  // Slide the idle expiry at most once every 5 minutes (keeps the hot path read-only).
  if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) {
    const next = new Date(Math.min(Date.now() + SESSION_IDLE_MS, s.absoluteExpiresAt.getTime()));
    db.update(schema.sessions).set({ lastSeenAt: new Date(), expiresAt: next }).where(eq(schema.sessions.id, s.id)).catch(() => {});
  }
  return { id: s.id, userId: s.userId, verifiedAt: s.verifiedAt, fresh: Boolean(s.verifiedAt && Date.now() - s.verifiedAt.getTime() < FRESH_MS), credentialId: s.credentialId, createdAt: s.createdAt, label: s.label };
}

/** Step-up: new token for the same session, verification time refreshed. The old token stays valid for ROTATION_GRACE_MS. */
export async function rotateSession(sessionId: string, credentialId: string | null): Promise<{ token: string; absoluteExpiresAt: Date } | null> {
  const token = newToken();
  const [row] = await db.update(schema.sessions).set({ prevTokenHash: dsql`${schema.sessions.tokenHash}`, prevValidUntil: new Date(Date.now() + ROTATION_GRACE_MS), tokenHash: sha256(token), verifiedAt: new Date(), lastSeenAt: new Date(), ...(credentialId ? { credentialId } : {}) }).where(and(eq(schema.sessions.id, sessionId), live())).returning({ abs: schema.sessions.absoluteExpiresAt });
  return row ? { token, absoluteExpiresAt: row.abs } : null;
}

export async function revokeSession(sessionId: string, reason: string) {
  const r = await db.update(schema.sessions).set({ revokedAt: new Date(), revokedReason: reason, prevTokenHash: null }).where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt))).returning({ id: schema.sessions.id });
  return r.length;
}
export async function revokeAllSessions(userId: string | null, reason: string, exceptId?: string | null) {
  const r = await db.update(schema.sessions).set({ revokedAt: new Date(), revokedReason: reason, prevTokenHash: null }).where(and(isNull(schema.sessions.revokedAt), userId ? eq(schema.sessions.userId, userId) : undefined, exceptId ? ne(schema.sessions.id, exceptId) : undefined)).returning({ id: schema.sessions.id });
  return r.length;
}
export async function revokeSessionsOfCredential(credentialId: string, reason: string) {
  const r = await db.update(schema.sessions).set({ revokedAt: new Date(), revokedReason: reason, prevTokenHash: null }).where(and(isNull(schema.sessions.revokedAt), eq(schema.sessions.credentialId, credentialId))).returning({ id: schema.sessions.id });
  return r.length;
}
export async function listSessions(userId: string) {
  return db.select({ id: schema.sessions.id, label: schema.sessions.label, userAgent: schema.sessions.userAgent, ip: schema.sessions.ip, createdAt: schema.sessions.createdAt, lastSeenAt: schema.sessions.lastSeenAt, expiresAt: schema.sessions.expiresAt, absoluteExpiresAt: schema.sessions.absoluteExpiresAt, verifiedAt: schema.sessions.verifiedAt, credentialId: schema.sessions.credentialId }).from(schema.sessions).where(and(eq(schema.sessions.userId, userId), live())).orderBy(desc(schema.sessions.lastSeenAt));
}
/** The single owner (oldest users row, created by `pnpm bootstrap`). */
export async function ownerRow() {
  const [u] = await db.select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, email: schema.users.email, preferences: schema.users.preferences }).from(schema.users).orderBy(schema.users.createdAt).limit(1);
  return u ?? null;
}
