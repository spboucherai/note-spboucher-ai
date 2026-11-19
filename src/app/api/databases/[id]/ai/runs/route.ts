import { handler, uuid, HttpError } from "@/lib/api";
import { listRuns } from "@/lib/ai/properties";
/**
 * GET ?propertyId=&rowId=&status=&limit= → run log of the AI columns of a database, newest first (≤ 500):
 * `[{id, databaseId, propertyId, rowId, status: queued|running|done|failed|skipped, trigger: manual|auto, task, model, provider, inputTokens, outputTokens, costUsd, error, createdAt, startedAt, finishedAt}]`.
 */
export const GET = handler(async ({ ws, params, req }) => {
  const u = new URL(req.url).searchParams; const opt = (k: string) => { const v = u.get(k); if (!v) return null; const r = uuid.safeParse(v); if (!r.success) throw new HttpError(400, `Invalid ${k}`, "bad_id"); return r.data; };
  const status = u.get("status"); if (status && !["queued", "running", "done", "failed", "skipped"].includes(status)) throw new HttpError(400, "Invalid status");
  return Response.json(await listRuns(ws.id, params.id, { propertyId: opt("propertyId"), rowId: opt("rowId"), status, limit: Number(u.get("limit") ?? 100) || 100 }));
});
