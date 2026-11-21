/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/auth/session.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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
