/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/auth/reauth/verify/route.ts
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
import { handler, HttpError } from "@/lib/api";
import { verifyAuthentication, CeremonyError } from "@/lib/auth/webauthn";
import { rotateSession } from "@/lib/auth/sessions";
import { sessionCookie } from "@/lib/auth/session";
import { json, body, readChallengeCookie, clearChallengeCookie, authenticationResponseSchema, ceremonyError } from "@/lib/auth/http";
import { FRESH_MS } from "@/lib/auth/config";
import { audit } from "@/lib/audit";
/** POST { response } → step-up: on success the session token is ROTATED (old one valid 60 s for requests in flight) and marked fresh for 5 minutes. */
export const POST = handler(async ({ req, user, requestId }) => {
  const b = await body(req, z.object({ response: authenticationResponseSchema }));
  try {
    const v = await verifyAuthentication("reauth", await readChallengeCookie(), b.response as any, { sessionId: user.sessionId });
    const r = await rotateSession(user.sessionId, v.credentialId); if (!r) throw new HttpError(401, "Session ended", "unauthenticated");
    await audit(user.id, "auth.step_up", { type: "session", id: user.sessionId }, { passkey: v.label ?? null });
    return json({ ok: true, freshForMs: FRESH_MS }, { cookies: [sessionCookie(r.token, r.absoluteExpiresAt), clearChallengeCookie()] });
  } catch (e) { if (e instanceof CeremonyError) { await audit(user.id, "auth.step_up_failed", undefined, { code: e.code }); return ceremonyError(e, requestId); } throw e; }
});
