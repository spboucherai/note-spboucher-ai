/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/graph/constellation/route.ts
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

import { handler } from "@/lib/api";
import { buildConstellation } from "@/lib/graph/constellation";
export const dynamic = "force-dynamic";
/**
 * GET /api/graph/constellation[?refresh=1] → the Thought Constellation: every embedded page with a 2-D position computed from the
 * real embeddings (deterministic PCA over the page-level mean vectors, cached until the embeddings change), its cluster, project and
 * tags, plus the accepted page ↔ page links. No model is called. `stats.embedded = 0` ⇒ no point (the client shows an empty state).
 * See docs/next/API-NEXT.md §4.3 « Constellation ».
 */
export const GET = handler(async ({ req, ws }) => Response.json(await buildConstellation(ws.id, { refresh: new URL(req.url).searchParams.get("refresh") === "1" })));
