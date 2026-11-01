/** suggest-links job: { workspaceId, pageId? } — one page (k=8) or a bounded workspace pass (k=5 per page). */
import { suggestLinksForPage, suggestLinksForWorkspace } from "../../lib/graph/suggest";
export async function handleSuggestLinks(d: { workspaceId: string; pageId?: string | null; k?: number; limit?: number }) {
  if (!d?.workspaceId) return { ignored: true };
  if (d.pageId) return suggestLinksForPage(d.workspaceId, d.pageId, { k: d.k ?? 8 });
  return suggestLinksForWorkspace(d.workspaceId, { limit: d.limit, k: d.k });
}
