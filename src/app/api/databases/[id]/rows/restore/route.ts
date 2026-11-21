/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/databases/[id]/rows/restore/route.ts
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
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { handler, parseBody, uuid } from "@/lib/api";
import { ensureDatabase } from "@/lib/databases/service";
import { restorePage } from "@/lib/pages/service";
import { audit } from "@/lib/audit";

/**
 * POST { ids: [rowId] } — undo a row deletion (the "Undo" action of the delete toast).
 * Deleting a row soft-deletes both the row and its page; this brings both back. Rows of another database are ignored.
 */
export const POST = handler(async ({ ws, params, req, user }) => {
  const body = await parseBody(req, z.object({ ids: z.array(uuid).min(1).max(500) }));
  const database = await ensureDatabase(ws.id, params.id);
  const rows = await db
    .select({ id: schema.databaseRows.id, pageId: schema.databaseRows.pageId })
    .from(schema.databaseRows)
    .where(and(eq(schema.databaseRows.databaseId, database.id), inArray(schema.databaseRows.id, body.ids), isNotNull(schema.databaseRows.deletedAt)));
  if (rows.length) {
    await db.update(schema.databaseRows).set({ deletedAt: null }).where(inArray(schema.databaseRows.id, rows.map((r) => r.id)));
    for (const r of rows) await restorePage(ws.id, r.pageId);
  }
  await audit(user.id, "database.row.restore", { type: "database", id: database.id }, { count: rows.length });
  return Response.json({ ok: true, restored: rows.length });
});
