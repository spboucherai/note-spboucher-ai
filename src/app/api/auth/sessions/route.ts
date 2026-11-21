/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/auth/sessions/route.ts
 * Module           : app
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
