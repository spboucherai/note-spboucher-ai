/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/worker/handlers/graph-insights.ts
 * Module           : worker
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

/** graph-insights job: { workspaceId, pageIds?, limit? } — deterministic insights refreshed, then one model analysis pass (SPEC §4.3). Never retried automatically (paid call). */
import { refreshDeterministicInsights, runGraphInsights } from "../../lib/graph/insights";
import { withActor } from "../../lib/events/context";
export async function handleGraphInsights(d: { workspaceId: string; pageIds?: string[]; limit?: number }) {
  if (!d?.workspaceId) return { ignored: true };
  return withActor({ actor: "ai" }, async () => { const det = await refreshDeterministicInsights(d.workspaceId); const ai = await runGraphInsights(d.workspaceId, { pageIds: d.pageIds, limit: d.limit }); return { deterministic: det.created, ...ai }; });
}
