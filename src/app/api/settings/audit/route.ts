/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/settings/audit/route.ts
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

import { desc, eq, or, isNull } from "drizzle-orm";
import { handler } from "@/lib/api";
import { db, schema } from "@/db";
/** GET ?limit=50 → most recent audit log entries of the owner, plus anonymous access-gate events (userId null). */
export const GET = handler(async ({ req, user }) => {
  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 50)));
  const rows = await db.select({ id: schema.auditLogs.id, action: schema.auditLogs.action, targetType: schema.auditLogs.targetType, targetId: schema.auditLogs.targetId, detail: schema.auditLogs.detail, ip: schema.auditLogs.ip, createdAt: schema.auditLogs.createdAt }).from(schema.auditLogs).where(or(eq(schema.auditLogs.userId, user.id), isNull(schema.auditLogs.userId))).orderBy(desc(schema.auditLogs.createdAt)).limit(limit);
  return Response.json(rows);
});
