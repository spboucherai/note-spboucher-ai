import { handler, HttpError } from "@/lib/api";
import { knowledgeHealth } from "@/lib/knowledge/health";
export const dynamic = "force-dynamic";
/** GET /api/health/knowledge?inactiveDays=30 → knowledge health (authenticated, unlike the public liveness probe /api/health). */
export const GET = handler(async ({ req, ws }) => {
  const d = new URL(req.url).searchParams.get("inactiveDays"); if (d !== null && !/^\d{1,4}$/.test(d)) throw new HttpError(400, "inactiveDays must be an integer", "bad_request");
  return Response.json(await knowledgeHealth(ws.id, { inactiveDays: d ? Number(d) : undefined }));
});
