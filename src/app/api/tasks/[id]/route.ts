import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteTask, getTask, restoreTask, taskOut, updateTask } from "@/lib/tasks/service";
import { taskPatch } from "@/lib/tasks/schema";

/** GET /api/tasks/<id> → the task, in any state (a deleted task answers with `deletedAt`). */
export const GET = handler(async ({ ws, params }) => Response.json(taskOut(await getTask(ws.id, uuid.parse(params.id), { includeDeleted: true }))));
/** PATCH /api/tasks/<id> { title?, status?, priority?, dueAt? | due?, project?, pageId?, blockId? } → the task. */
export const PATCH = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const b = await parseBody(req, taskPatch);
  const { due, dueAt, ...patch } = b; const d = dueAt !== undefined ? dueAt : due;
  const t = await updateTask(ws.id, id, { ...patch, ...(d !== undefined ? { dueAt: d } : {}) });
  if (patch.status !== undefined) await audit(user.id, patch.status === "done" ? "task.complete" : patch.status === "todo" ? "task.reopen" : "task.update", { type: "task", id });
  return Response.json(taskOut(t));
});
/** DELETE /api/tasks/<id> → soft delete. Idempotent: deleting an already deleted task answers 200 `{ok:true, deleted:false}`; an unknown id → 404. */
export const DELETE = handler(async ({ ws, params, user }) => {
  const id = uuid.parse(params.id); await getTask(ws.id, id, { includeDeleted: true });
  const deleted = await deleteTask(ws.id, id);
  if (deleted) await audit(user.id, "task.delete", { type: "task", id });
  return Response.json({ ok: true, deleted });
});
/**
 * POST /api/tasks/<id>?action=restore → the task, live again (undo of a delete; same contract as /api/research/tasks/<id>). Idempotent:
 * restoring a task that is not deleted answers 200 with the task untouched; an unknown id → 404; another action → 400.
 */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); if (new URL(req.url).searchParams.get("action") !== "restore") throw new HttpError(400, "Unknown action", "bad_action");
  const before = await getTask(ws.id, id, { includeDeleted: true }); if (!before.deletedAt) return Response.json(taskOut(before));
  const t = await restoreTask(ws.id, id); await audit(user.id, "task.restore", { type: "task", id });
  return Response.json(taskOut(t));
});
