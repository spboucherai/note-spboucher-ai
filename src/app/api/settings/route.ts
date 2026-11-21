/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/settings/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-09
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
import { eq } from "drizzle-orm";
import { handler, parseBody } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";

/** GET → profile + preferences + a few workspace-level settings the Settings screen needs. */
export const GET = handler(async ({ user, ws }) => {
  const [u] = await db.select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, email: schema.users.email, preferences: schema.users.preferences, createdAt: schema.users.createdAt }).from(schema.users).where(eq(schema.users.id, user.id));
  const [budget] = await db.select().from(schema.settings).where(eq(schema.settings.key, "ai.daily_budget_usd"));
  return Response.json({ ...u, workspace: { id: ws.id, name: ws.name }, aiBudgetUsd: Number((budget?.value as any) ?? 20), sessionId: user.sessionId });
});
/** PATCH { displayName?, email?, preferences? } — preferences are shallow-merged into users.preferences. */
export const PATCH = handler(async ({ req, user }) => {
  const b = await parseBody(req, z.object({ displayName: z.string().trim().min(1).max(100).optional(), email: z.string().trim().email().max(200).nullable().or(z.literal("")).optional(), preferences: z.record(z.string(), z.unknown()).optional() }));
  const [cur] = await db.select({ preferences: schema.users.preferences }).from(schema.users).where(eq(schema.users.id, user.id));
  const set: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };
  if (b.displayName !== undefined) set.displayName = b.displayName;
  if (b.email !== undefined) set.email = b.email || null;
  if (b.preferences) set.preferences = { ...(cur?.preferences ?? {}), ...b.preferences };
  const [u] = await db.update(schema.users).set(set).where(eq(schema.users.id, user.id)).returning({ displayName: schema.users.displayName, email: schema.users.email, preferences: schema.users.preferences });
  await audit(user.id, "settings.update", undefined, { keys: Object.keys(b) });
  return Response.json(u);
});
