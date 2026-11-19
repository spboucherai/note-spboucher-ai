import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decideInsight } from "@/lib/graph/insights";
/** PATCH /api/graph/insights/<id> { status: "accepted" | "dismissed" | "suggested" } → insight (+ `relationId` when accepting a contradiction created the `contradicts` relation). */
export const PATCH = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const { status } = await parseBody(req, z.object({ status: z.enum(["accepted", "dismissed", "suggested"]) }));
  const r = await decideInsight(ws.id, id, status); await audit(user.id, `graph.insight.${status}`, { type: "insight", id });
  return Response.json(r);
});
