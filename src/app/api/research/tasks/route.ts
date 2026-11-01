import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { listTasks, createTask, createTasks } from "@/lib/research/tasks";
import { audit } from "@/lib/audit";
const item = z.object({ title: z.string().min(1).max(500), status: z.enum(["todo", "doing", "done"]).optional(), priority: z.enum(["low", "medium", "high"]).optional(), dueAt: z.string().max(40).nullable().optional(), project: z.string().max(200).nullable().optional() });
export const GET = handler(async ({ req, ws }) => { const pageId = new URL(req.url).searchParams.get("pageId"); if (!pageId) throw new HttpError(400, "pageId required"); return Response.json(await listTasks(ws.id, uuid.parse(pageId))); });
/** POST { pageId, title, … } or { pageId, items: [...] } (bulk accept from an AI plan) */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.union([item.extend({ pageId: uuid }), z.object({ pageId: uuid, items: z.array(item).min(1).max(50) })]));
  if ("items" in b) { const rows = await createTasks(ws.id, b.pageId, b.items); await audit(user.id, "task.bulk_create", { type: "page", id: b.pageId }, { count: rows.length }); return Response.json(rows, { status: 201 }); }
  const t = await createTask(ws.id, b); await audit(user.id, "task.create", { type: "task", id: t.id }, { title: t.title }); return Response.json(t, { status: 201 });
});
