import { z } from "zod";
import { requireUser, getWorkspace, jsonError, HttpError } from "@/lib/auth/guard";
import type { SessionUser } from "@/lib/auth/session";
/** Standard handler wrapper: auth + workspace + error mapping. */
export function handler(fn: (ctx: { req: Request; user: SessionUser; ws: { id: string; ownerId: string; name: string }; params: Record<string, string> }) => Promise<Response>) {
  return async (req: Request, routeCtx?: { params: Promise<Record<string, string>> }) => {
    try { const user = await requireUser(req); const ws = await getWorkspace(user.id); const params = routeCtx ? await routeCtx.params : {}; return await fn({ req, user, ws, params }); }
    catch (e) { return jsonError(e); }
  };
}
export async function parseBody<T extends z.ZodTypeAny>(req: Request, s: T): Promise<z.infer<T>> {
  const j = await req.json().catch(() => { throw new HttpError(400, "Invalid JSON body"); });
  const r = s.safeParse(j); if (!r.success) throw new HttpError(400, "Validation: " + r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; "));
  return r.data;
}
export const uuid = z.string().uuid();
export { HttpError };
