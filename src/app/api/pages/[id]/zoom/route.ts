import { handler, HttpError, uuid } from "@/lib/api";
import { getPage } from "@/lib/pages/service";
import { zoomLevel1, zoomLevel2, zoomLevel3 } from "@/lib/pages/zoom";
export const dynamic = "force-dynamic";
/** GET /api/pages/<id>/zoom?level=1|2|3 — 3 = full document, 2 = outline (no model), 1 = AI synopsis (501 `not_implemented` until the AI workstream provides it). */
export const GET = handler(async ({ req, ws, params }) => {
  const id = uuid.parse(params.id); const u = new URL(req.url).searchParams; const level = u.get("level") ?? "2";
  if (!["1", "2", "3"].includes(level)) throw new HttpError(400, "level must be 1, 2 or 3", "bad_request");
  const p = await getPage(ws.id, id, { includeDeleted: true });
  return Response.json(level === "3" ? zoomLevel3(p) : level === "2" ? zoomLevel2(p) : await zoomLevel1(ws.id, p, { refresh: u.get("refresh") === "1" }));
});
