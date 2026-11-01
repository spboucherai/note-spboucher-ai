import { handler } from "@/lib/api";
import { buildGraph } from "@/lib/graph/service";
import { NODE_KINDS, type NodeKind } from "@/lib/graph/types";

/** GET /api/graph?types=page,database&section=notes&since=ISO&pageId=&depth=1&hideOrphans=1&suggestions=0 */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams;
  const types = (u.get("types") ?? "").split(",").map((s) => s.trim()).filter((s): s is NodeKind => (NODE_KINDS as string[]).includes(s));
  const since = u.get("since") ? new Date(u.get("since")!) : null;
  const pageId = u.get("pageId"); const depth = Math.min(4, Math.max(0, Number(u.get("depth") ?? 1) || 1));
  const g = await buildGraph(ws.id, {
    types: types.length ? types : undefined, section: u.get("section") || null, since: since && !isNaN(since.getTime()) ? since : null,
    pageId: pageId && /^[0-9a-f-]{36}$/.test(pageId) ? pageId : null, depth, hideOrphans: u.get("hideOrphans") === "1", suggestions: u.get("suggestions") !== "0",
  });
  return Response.json(g, { headers: { "cache-control": "private, no-store" } });
});
