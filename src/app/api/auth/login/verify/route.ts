/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/auth/login/verify/route.ts
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
import { publicRoute, json, body, readChallengeCookie, clearChallengeCookie, authenticationResponseSchema } from "@/lib/auth/http";
import { verifyAuthentication, CeremonyError } from "@/lib/auth/webauthn";
import { createSession } from "@/lib/auth/sessions";
import { sessionCookie } from "@/lib/auth/session";
import { recordAttempt, tooManyFailures } from "@/lib/auth/ratelimit";
import { clientIp, safeNext } from "@/lib/auth/tokens";
import { HttpError } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
export const dynamic = "force-dynamic";
/** POST { response, next? } → verifies the assertion against the single-use challenge, then opens a new server-side session (fresh random token). */
export const POST = publicRoute("login.verify", async (req) => {
  const ip = clientIp(req.headers); const ua = req.headers.get("user-agent");
  if (await tooManyFailures(ip)) throw new HttpError(429, "Too many attempts. Wait a minute.", "rate_limited");
  const b = await body(req, z.object({ response: authenticationResponseSchema, next: z.string().max(2000).optional() }));
  try {
    const v = await verifyAuthentication("login", await readChallengeCookie(), b.response as any);
    const s = await createSession({ userId: v.userId, credentialId: v.credentialId, userAgent: ua, ip });
    await recordAttempt(ip, "passkey", true);
    await audit(v.userId, "auth.login", { type: "session", id: s.id }, { passkey: v.label ?? null, ua: ua?.slice(0, 160) ?? null }, ip);
    return json({ ok: true, next: safeNext(b.next) }, { cookies: [sessionCookie(s.token, s.absoluteExpiresAt), clearChallengeCookie()] });
  } catch (e) {
    if (e instanceof CeremonyError) { await recordAttempt(ip, "passkey", false); await audit(null, "auth.login_failed", undefined, { code: e.code, ua: ua?.slice(0, 160) ?? null }, ip); }
    throw e;
  }
});
