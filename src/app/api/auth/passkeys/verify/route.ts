/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/auth/passkeys/verify/route.ts
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
import { handler } from "@/lib/api";
import { verifyRegistration, CeremonyError } from "@/lib/auth/webauthn";
import { json, body, readChallengeCookie, clearChallengeCookie, registrationResponseSchema, ceremonyError } from "@/lib/auth/http";
import { deviceLabel } from "@/lib/auth/tokens";
import { audit } from "@/lib/audit";
/** POST { response, label } → stores the additional passkey (fresh verification required). */
export const POST = handler(async ({ req, user, requestId }) => {
  const b = await body(req, z.object({ response: registrationResponseSchema, label: z.string().trim().max(60).optional() }));
  try {
    const reg = await verifyRegistration("register", await readChallengeCookie(), b.response as any, { userId: user.id, sessionId: user.sessionId, label: b.label || deviceLabel(req.headers.get("user-agent")) });
    await audit(user.id, "auth.passkey_added", { type: "passkey", id: reg.credentialId.slice(0, 16) }, { label: reg.label });
    return json({ ok: true, id: reg.credentialId, label: reg.label }, { cookies: [clearChallengeCookie()] });
  } catch (e) { if (e instanceof CeremonyError) return ceremonyError(e, requestId); throw e; }
}, { fresh: true });
