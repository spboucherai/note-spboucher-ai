/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/search/index-state/route.ts
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

import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { indexStats, indexHealth } from "@/lib/search";
import { enqueue, QUEUES } from "@/lib/jobs";
import { audit } from "@/lib/audit";
/** GET → counters + what is pending / failed in the index. */
export const GET = handler(async ({ ws }) => { const [stats, health] = await Promise.all([indexStats(ws.id), indexHealth(ws.id)]); return Response.json({ ...stats, health }); });
/**
 * POST { scope?: "all" | "pending" } → "all" rebuilds the whole index (unchanged content is skipped by hash); "pending" (re)queues only
 * the sources that are not indexed or failed. Jobs are de-duplicated per source (singleton key), so pressing twice does not double the work.
 */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ scope: z.enum(["all", "pending"]).default("all") }).default({ scope: "all" }));
  if (b.scope === "all") { await enqueue(QUEUES.reindexAll, { workspaceId: ws.id }, { singletonKey: `reindex:${ws.id}`, singletonSeconds: 120 }); await audit(user.id, "search.reindex", undefined, { scope: "all" }); return Response.json({ ok: true, queued: 1 }); }
  const h = await indexHealth(ws.id); let n = 0;
  for (const p of h.pending) { await enqueue(QUEUES.index, { sourceType: "page", sourceId: p.id, workspaceId: ws.id }, { singletonKey: `page:${p.id}`, singletonSeconds: 20 }); n++; }
  for (const f of h.failed) if (f.sourceType === "attachment" && f.sourceId) { await enqueue(QUEUES.index, { sourceType: "attachment", sourceId: f.sourceId, workspaceId: ws.id }, { singletonKey: `attachment:${f.sourceId}`, singletonSeconds: 20 }); n++; }
  await audit(user.id, "search.reindex", undefined, { scope: "pending", queued: n });
  return Response.json({ ok: true, queued: n });
});
