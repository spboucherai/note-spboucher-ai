/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/auth/passkeys/[id]/route.ts
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
import { and, count, eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";
import { handler, parseBody, HttpError } from "@/lib/api";
import { revokeSessionsOfCredential } from "@/lib/auth/sessions";
import { audit } from "@/lib/audit";
const idOf = (p: Record<string, string>) => { const id = decodeURIComponent(p.id ?? ""); if (!/^[A-Za-z0-9_-]{8,1024}$/.test(id)) throw new HttpError(400, "Bad passkey id"); return id; };
/** PATCH { label } → rename (fresh verification required). */
export const PATCH = handler(async ({ req, user, params }) => {
  const id = idOf(params); const b = await parseBody(req, z.object({ label: z.string().trim().min(1).max(60) }));
  const r = await db.update(schema.webauthnCredentials).set({ label: b.label }).where(and(eq(schema.webauthnCredentials.id, id), eq(schema.webauthnCredentials.userId, user.id))).returning({ id: schema.webauthnCredentials.id });
  if (!r.length) throw new HttpError(404, "Passkey not found");
  await audit(user.id, "auth.passkey_renamed", { type: "passkey", id: id.slice(0, 16) }, { label: b.label });
  return Response.json({ ok: true });
}, { fresh: true });
/** DELETE → revoke a passkey and every session it opened. The last passkey can never be removed (there is no other way in). */
export const DELETE = handler(async ({ user, params }) => {
  const id = idOf(params);
  const removed = await db.transaction(async (tx) => {
    // Serialise concurrent revocations so two requests cannot each delete "the other" last passkey.
    await tx.execute(dsql`select pg_advisory_xact_lock(761001)`);
    const [{ n }] = await tx.select({ n: count() }).from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, user.id));
    if (n <= 1) throw new HttpError(409, "This is your only passkey. Add another one before removing it.", "last_passkey");
    return tx.delete(schema.webauthnCredentials).where(and(eq(schema.webauthnCredentials.id, id), eq(schema.webauthnCredentials.userId, user.id))).returning({ label: schema.webauthnCredentials.label });
  });
  if (!removed.length) throw new HttpError(404, "Passkey not found");
  const sessions = await revokeSessionsOfCredential(id, "passkey-revoked");
  await audit(user.id, "auth.passkey_revoked", { type: "passkey", id: id.slice(0, 16) }, { label: removed[0].label, sessionsRevoked: sessions });
  return Response.json({ ok: true, sessionsRevoked: sessions, signedOut: id === user.credentialId });
}, { fresh: true });
