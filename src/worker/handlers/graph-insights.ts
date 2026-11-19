/** graph-insights job: { workspaceId, pageIds?, limit? } — deterministic insights refreshed, then one model analysis pass (SPEC §4.3). Never retried automatically (paid call). */
import { refreshDeterministicInsights, runGraphInsights } from "../../lib/graph/insights";
import { withActor } from "../../lib/events/context";
export async function handleGraphInsights(d: { workspaceId: string; pageIds?: string[]; limit?: number }) {
  if (!d?.workspaceId) return { ignored: true };
  return withActor({ actor: "ai" }, async () => { const det = await refreshDeterministicInsights(d.workspaceId); const ai = await runGraphInsights(d.workspaceId, { pageIds: d.pageIds, limit: d.limit }); return { deterministic: det.created, ...ai }; });
}
