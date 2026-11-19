import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { getCanvas, putCanvas } from "@/lib/canvas/service";
export const dynamic = "force-dynamic";
/** GET /api/canvases/<pageId> → `{pageId, title, data, version, rev, updatedAt}`. 404 `not_canvas` when the page is not of type `canvas`. */
export const GET = handler(async ({ ws, params }) => Response.json(await getCanvas(ws.id, uuid.parse(params.pageId))));
/** PUT /api/canvases/<pageId> { data, baseVersion } → 200 `{version, rev, updatedAt, unchanged}` | 409 `conflict` + `server: {version, data, updatedAt}`. */
export const PUT = handler(async ({ req, ws, params }) => {
  const pageId = uuid.parse(params.pageId); const b = await parseBody(req, z.object({ data: z.any(), baseVersion: z.number().int().min(0) }));
  return Response.json(await putCanvas(ws.id, pageId, b.data, b.baseVersion));
});
