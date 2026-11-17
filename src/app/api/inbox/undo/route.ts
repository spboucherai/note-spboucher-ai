import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { undoTriage } from "@/lib/inbox/service";
import { audit } from "@/lib/audit";
export const POST = handler(async ({ req, ws, user }) => {
  const { actionId } = await parseBody(req, z.object({ actionId: uuid }));
  const r = await undoTriage(ws.id, actionId);
  await audit(user.id, "inbox.undo", undefined, { actionId });
  return Response.json(r);
});
