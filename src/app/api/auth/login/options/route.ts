/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/auth/login/options/route.ts
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

import { publicRoute, challengeCookie, json } from "@/lib/auth/http";
import { authenticationOptions } from "@/lib/auth/webauthn";
import { credentialCount } from "@/lib/auth/enrollment";
import { tooManyFailures } from "@/lib/auth/ratelimit";
import { clientIp } from "@/lib/auth/tokens";
import { HttpError } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
/** POST → WebAuthn request options for a usernameless sign-in (discoverable credential, user verification REQUIRED). */
export const POST = publicRoute("login.options", async (req) => {
  if (await tooManyFailures(clientIp(req.headers))) throw new HttpError(429, "Too many attempts. Wait a minute.", "rate_limited");
  if ((await credentialCount()) === 0) throw new HttpError(409, "No passkey is registered yet. Open an enrollment window from the server.", "not_enrolled");
  const { options, challengeId } = await authenticationOptions("login", {});
  return json({ options }, { cookies: [challengeCookie(challengeId)] });
});
