import { handler, HttpError } from "@/lib/api";
import { computeIntelligence } from "@/lib/graph/intelligence";
import { INSIGHT_KINDS, listInsights } from "@/lib/graph/insights";
export const dynamic = "force-dynamic";
/**
 * GET /api/graph/insights?status=suggested|accepted|dismissed|all&kind=&limit=&intelligence=0
 * → `{ intelligence, insights, counts }`. `intelligence` is computed from the data at each call, without any model (central pages by
 * PageRank, central concepts, orphans, clusters, recurring topics, exact duplicates); `insights` are the stored findings awaiting a
 * decision (deterministic ones after a run, and the model ones produced by the `graph-insights` job).
 */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams; const status = u.get("status"); const kind = u.get("kind"); const lim = u.get("limit");
  if (status && !["suggested", "accepted", "dismissed", "all"].includes(status)) throw new HttpError(400, "Unknown status", "bad_request");
  if (kind && !(INSIGHT_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, "Unknown kind", "bad_request");
  if (lim !== null && !/^\d{1,3}$/.test(lim)) throw new HttpError(400, "limit must be an integer", "bad_request");
  // `limit` (clamped to 1..100) caps every list of `intelligence` AND `insights`; without it: 20 per intelligence list, 200 insights
  const n = lim === null ? undefined : Math.min(100, Math.max(1, Number(lim)));
  const [intelligence, stored] = await Promise.all([u.get("intelligence") === "0" ? null : computeIntelligence(ws.id, { limit: n ?? 20 }), listInsights(ws.id, { status, kind, limit: n })]);
  return Response.json({ intelligence, ...stored });
});
