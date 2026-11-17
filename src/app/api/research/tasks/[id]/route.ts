import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { updateTask, deleteTask, restoreTask } from "@/lib/research/tasks";
import { audit } from "@/lib/audit";
const patchSchema = z.object({ title: z.string().min(1).max(500).optional(), status: z.enum(["todo", "doing", "done"]).optional(), priority: z.enum(["low", "medium", "high"]).optional(), dueAt: z.string().max(40).nullable().optional(), project: z.string().max(200).nullable().optional(), pageId: uuid.optional() });
export const PATCH = handler(async ({ req, ws, params, user }) => { const id = uuid.parse(params.id); const b = await parseBody(req, patchSchema); const t = await updateTask(ws.id, id, b); if (b.status) await audit(user.id, "task.status", { type: "task", id }, { status: b.status }); return Response.json(t); });
export const DELETE = handler(async ({ ws, params, user }) => { const id = uuid.parse(params.id); await deleteTask(ws.id, id); await audit(user.id, "task.delete", { type: "task", id }); return Response.json({ ok: true }); });
/** POST ?action=restore → undo of a delete */
export const POST = handler(async ({ req, ws, params, user }) => { const id = uuid.parse(params.id); if (new URL(req.url).searchParams.get("action") !== "restore") throw new HttpError(400, "Unknown action"); const t = await restoreTask(ws.id, id); await audit(user.id, "task.restore", { type: "task", id }); return Response.json(t); });
