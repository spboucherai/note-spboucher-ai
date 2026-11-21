/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/auth/enroll/options/route.ts
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
import { publicRoute, challengeCookie, json, body } from "@/lib/auth/http";
import { registrationOptions } from "@/lib/auth/webauthn";
import { findEnrollment } from "@/lib/auth/enrollment";
import { ownerRow } from "@/lib/auth/sessions";
import { recordAttempt, tooManyFailures } from "@/lib/auth/ratelimit";
import { clientIp } from "@/lib/auth/tokens";
import { HttpError } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
export const dynamic = "force-dynamic";
/** POST { token } → registration options, only while an enrollment window opened from the node CLI is valid for this exact token. */
export const POST = publicRoute("enroll.options", async (req) => {
  const ip = clientIp(req.headers);
  if (await tooManyFailures(ip)) throw new HttpError(429, "Too many attempts. Wait a minute.", "rate_limited");
  const b = await body(req, z.object({ token: z.string().min(40).max(64) }));
  const w = await findEnrollment(b.token); const owner = await ownerRow();
  if (!w || !owner) { await recordAttempt(ip, "enroll", false); await audit(null, "auth.enroll_denied", undefined, { stage: "options" }, ip); throw new HttpError(403, "This enrollment link is invalid, expired or already used.", "enrollment_closed"); }
  const { options, challengeId } = await registrationOptions("enroll", owner, { enrollmentId: w.id });
  return json({ options, purpose: w.purpose, revokeExisting: w.revokeExisting, expiresAt: w.expiresAt }, { cookies: [challengeCookie(challengeId)] });
});
