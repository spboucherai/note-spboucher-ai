import { handler, HttpError, uuid } from "@/lib/api";
import { pageNeighbourhood, linkedPages, listSuggestions } from "@/lib/graph/service";

/** GET /api/graph/neighbors?pageId=&depth=1&suggestions=1&linked=1 — page-level mini graph (+ linked page list and pending suggestions when linked=1). */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams;
  const r = uuid.safeParse(u.get("pageId")); if (!r.success) throw new HttpError(400, "pageId required");
  const depth = Math.min(3, Math.max(1, Number(u.get("depth") ?? 1) || 1));
  const g = await pageNeighbourhood(ws.id, r.data, depth, { suggestions: u.get("suggestions") !== "0" });
  if (u.get("linked") !== "1") return Response.json(g, { headers: { "cache-control": "private, no-store" } });
  const [linked, suggestions] = await Promise.all([linkedPages(ws.id, r.data), listSuggestions(ws.id, "suggested", { pageId: r.data, limit: 50 })]);
  return Response.json({ ...g, linked, suggestions }, { headers: { "cache-control": "private, no-store" } });
});
