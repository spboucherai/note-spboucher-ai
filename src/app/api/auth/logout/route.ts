/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/auth/logout/route.ts
 * Module           : app
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

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { resolveSession, revokeSession } from "@/lib/auth/sessions";
import { clearSessionCookie } from "@/lib/auth/session";
import { assertSameOrigin, jsonError } from "@/lib/auth/guard";
import { json } from "@/lib/auth/http";
import { audit } from "@/lib/audit";
export const dynamic = "force-dynamic";
/** POST → "Lock this device": revokes the current server-side session and clears the cookie. Always answers 200 so a dead session can still be cleaned up. */
export async function POST() {
  try {
    await assertSameOrigin();
    const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
    if (s) { await revokeSession(s.id, "logout"); await audit(s.userId, "auth.logout", { type: "session", id: s.id }); }
    return json({ ok: true }, { cookies: [clearSessionCookie()] });
  } catch (e) { return jsonError(e); }
}
