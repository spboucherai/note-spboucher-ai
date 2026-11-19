import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { undoInboxAction } from "@/lib/ai/inbox";
import { audit } from "@/lib/audit";
/** POST { actionId } → reverse one journaled inbox action: a triage action (existing behaviour) or an applied set of AI suggestions. */
export const POST = handler(async ({ req, ws, user }) => {
  const { actionId } = await parseBody(req, z.object({ actionId: uuid }));
  const r = await undoInboxAction(ws.id, actionId);
  await audit(user.id, "inbox.undo", undefined, { actionId });
  return Response.json(r);
});
