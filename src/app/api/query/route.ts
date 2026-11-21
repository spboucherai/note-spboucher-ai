/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/query/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
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
import { handler, parseBody, uuid } from "@/lib/api";
import { QUERY_SOURCES, runQuery } from "@/lib/knowledge/query";
/**
 * POST /api/query { source, databaseId?, viewId?, pageId?, filter?, limit? } → `{source, columns, rows, total, limit, table, resolvedAt}`.
 * Read-only (POST because the body is a query): resolves a `queryView` / `chart` block at display time. Safe to repeat.
 */
export const POST = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({ source: z.enum(QUERY_SOURCES), databaseId: uuid.nullable().optional(), viewId: uuid.nullable().optional(), pageId: uuid.nullable().optional(), limit: z.number().int().min(1).max(500).optional(),
    filter: z.object({ tag: z.string().max(60).optional(), section: z.string().max(40).optional(), status: z.string().max(40).optional(), parentId: uuid.optional(), text: z.string().max(200).optional(), dueBefore: z.string().max(40).optional(), dueAfter: z.string().max(40).optional() }).optional() }));
  return Response.json(await runQuery(ws.id, b));
});
