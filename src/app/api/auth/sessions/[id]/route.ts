/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/auth/sessions/[id]/route.ts
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

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { handler, uuid, HttpError, requireFresh } from "@/lib/api";
import { revokeSession } from "@/lib/auth/sessions";
import { audit } from "@/lib/audit";
/** DELETE → revoke one session. Another device needs a fresh passkey verification; the current one is the same as "Lock this device". */
export const DELETE = handler(async ({ user, params }) => {
  const id = uuid.parse(params.id);
  if (id !== user.sessionId) requireFresh(user);
  const [s] = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, user.id)));
  if (!s) throw new HttpError(404, "Session not found");
  await revokeSession(id, "revoked-by-owner");
  await audit(user.id, "auth.session_revoked", { type: "session", id });
  return Response.json({ ok: true, current: id === user.sessionId });
});
