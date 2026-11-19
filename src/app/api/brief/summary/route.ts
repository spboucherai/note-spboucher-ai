import { z } from "zod";
import { handler, HttpError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { summariseBrief } from "@/lib/knowledge/brief";
/** POST /api/brief/summary [{ tz? }] → `{ai: true, text, model, at, costUsd}` — explicit request only; one short model call over titles and counts. */
export const POST = handler(async ({ req, ws, user }) => {
  const b = z.object({ tz: z.string().max(64).optional() }).safeParse(await req.json().catch(() => ({}))); if (!b.success) throw new HttpError(400, "Validation: tz must be a string", "bad_request");
  const s = await summariseBrief(ws.id, { tz: b.data.tz }); await audit(user.id, "brief.summary", undefined, { model: s.model });
  return Response.json(s);
});
