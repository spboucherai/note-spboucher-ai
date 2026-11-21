/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/databases/[id]/ai/runs/route.ts
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

import { handler, uuid, HttpError } from "@/lib/api";
import { listRuns } from "@/lib/ai/properties";
/**
 * GET ?propertyId=&rowId=&status=&limit= → run log of the AI columns of a database, newest first (≤ 500):
 * `[{id, databaseId, propertyId, rowId, status: queued|running|done|failed|skipped, trigger: manual|auto, task, model, provider, inputTokens, outputTokens, costUsd, error, createdAt, startedAt, finishedAt}]`.
 */
export const GET = handler(async ({ ws, params, req }) => {
  const u = new URL(req.url).searchParams; const opt = (k: string) => { const v = u.get(k); if (!v) return null; const r = uuid.safeParse(v); if (!r.success) throw new HttpError(400, `Invalid ${k}`, "bad_id"); return r.data; };
  const status = u.get("status"); if (status && !["queued", "running", "done", "failed", "skipped"].includes(status)) throw new HttpError(400, "Invalid status");
  return Response.json(await listRuns(ws.id, params.id, { propertyId: opt("propertyId"), rowId: opt("rowId"), status, limit: Number(u.get("limit") ?? 100) || 100 }));
});
