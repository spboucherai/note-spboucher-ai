import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { triage } from "@/lib/inbox/service";
import { audit } from "@/lib/audit";
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep"), section: z.enum(["notes", "documents", "projects", "research"]).optional(), parentId: uuid.nullable().optional() }),
  z.object({ action: z.literal("task"), dueAt: z.string().datetime({ offset: true }).nullable().optional(), priority: z.enum(["low", "medium", "high"]).optional() }),
  z.object({ action: z.literal("database"), databaseId: uuid }),
  z.object({ action: z.literal("reference") }), z.object({ action: z.literal("archive") }), z.object({ action: z.literal("trash") }),
]);
/** POST → triage one capture. The answer carries `actionId`, which POST /api/inbox/undo reverses. */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const b = await parseBody(req, body);
  const r = await triage(ws.id, id, b);
  await audit(user.id, `inbox.${b.action}`, { type: "page", id }, { actionId: r.actionId });
  return Response.json(r);
});
