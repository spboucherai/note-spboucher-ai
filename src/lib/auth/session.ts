import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { cookieBase, SESSION_COOKIE } from "./config";
import { ownerRow, resolveSession } from "./sessions";
export { clientIp } from "./tokens";

/** The authenticated owner for this request. `sessionId` identifies the server-side session row; `fresh` = passkey verified < 5 min ago. */
export type SessionUser = { id: string; username: string; displayName: string; email: string | null; preferences: Record<string, unknown>; sessionId: string; fresh: boolean; verifiedAt: string | null; credentialId: string | null };

/** Resolve the current request (cached per request). Null without a valid, unrevoked, unexpired session. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await resolveSession(token); if (!s) return null;
  const u = await ownerRow(); if (!u || u.id !== s.userId) return null;
  return { ...u, sessionId: s.id, fresh: s.fresh, verifiedAt: s.verifiedAt?.toISOString() ?? null, credentialId: s.credentialId };
});
export function sessionCookie(token: string, absoluteExpiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((absoluteExpiresAt.getTime() - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${cookieBase.secure ? "; Secure" : ""}`;
}
export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${cookieBase.secure ? "; Secure" : ""}`;
