import "server-only";
import { cookies } from "next/headers";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { cache } from "react";
import { ACCESS_COOKIE, hasAccess } from "@/lib/access";
export { clientIp } from "@/lib/access";

/**
 * Single-owner access model (2026-11-09): no accounts, no login form for users, no TOTP.
 * A valid access cookie (see src/lib/access.ts) binds the request to the owner row created by `pnpm bootstrap`.
 */
export type SessionUser = { id: string; username: string; displayName: string; email: string | null; preferences: Record<string, unknown>; sessionId: string };

let ownerMemo: { at: number; u: Omit<SessionUser, "sessionId"> } | null = null;
async function owner() {
  if (ownerMemo && Date.now() - ownerMemo.at < 60_000) return ownerMemo.u;
  const [u] = await db.select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, email: schema.users.email, preferences: schema.users.preferences }).from(schema.users).orderBy(asc(schema.users.createdAt)).limit(1);
  if (!u) return null;
  ownerMemo = { at: Date.now(), u }; return u;
}
export function forgetOwnerCache() { ownerMemo = null; }

/** Resolve the current request (cached per request). Returns null without a valid access cookie. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const c = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!(await hasAccess(c))) return null;
  const u = await owner(); if (!u) return null;
  return { ...u, sessionId: "access-cookie" };
});
