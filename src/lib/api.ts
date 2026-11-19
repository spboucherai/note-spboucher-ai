import { z } from "zod";
import { and, eq, lt } from "drizzle-orm";
import { requireUser, getWorkspace, jsonError, HttpError, requireFresh } from "@/lib/auth/guard";
import type { SessionUser } from "@/lib/auth/session";
import { db, schema } from "@/db";
import { log, newRequestId } from "@/lib/log";
import { withActor } from "@/lib/events/context";
import { deviceLabel } from "@/lib/auth/tokens";
import { clientError, uuid, optUuid, optDate } from "@/lib/http-input";

export interface Ctx { req: Request; user: SessionUser; ws: { id: string; ownerId: string; name: string }; params: Record<string, string>; requestId: string }
const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;
const MAX_STORED = 512 * 1024;

/**
 * Standard handler wrapper: same-origin check + session + workspace + error mapping, plus
 *  - a correlation id (`x-request-id`, generated or taken from the client) on every response and log line;
 *  - idempotency: a mutating request carrying `Idempotency-Key` runs at most once per session — a retry after a timeout
 *    gets the stored response (`idempotent-replay: true`) instead of creating a second page/row/task;
 *  - one structured log line per request: ids, method, path, status, duration. Never bodies.
 * `opts.fresh` demands a passkey verification younger than 5 minutes (step-up).
 */
export function handler(fn: (ctx: Ctx) => Promise<Response>, opts: { fresh?: boolean } = {}) {
  return async (req: Request, routeCtx?: { params: Promise<Record<string, string>> }) => {
    const t0 = Date.now(); const given = req.headers.get("x-request-id");
    const requestId = given && /^[A-Za-z0-9_-]{8,64}$/.test(given) ? given : newRequestId();
    const path = new URL(req.url).pathname; let sid = "-"; let res: Response;
    try {
      const user = await requireUser(req); sid = user.sessionId.slice(0, 8);
      if (opts.fresh) requireFresh(user);
      const ws = await getWorkspace(user.id); const params = routeCtx ? await routeCtx.params : {};
      const key = MUTATING.has(req.method) ? req.headers.get("idempotency-key") : null;
      // journal events written while serving this request are stamped with the user and the device label of the session
      const run = () => withActor({ actor: "user", device: deviceLabel(req.headers.get("user-agent")) }, () => fn({ req, user, ws, params, requestId }));
      res = key ? await idempotent(key, user.sessionId, req.method, path, run) : await run();
    } catch (raw) {
      const e = clientError(raw);
      if (!(e instanceof HttpError)) log.error({ rid: requestId, sid, method: req.method, path, err: (e as Error)?.name, detail: String((e as Error)?.message ?? e).slice(0, 300), stack: (e as Error)?.stack?.split("\n").slice(1, 4).join(" | ") }, "handler error");
      res = jsonError(e, requestId);
    }
    try { res.headers.set("x-request-id", requestId); if (!res.headers.has("cache-control")) res.headers.set("cache-control", "private, no-store"); } catch { /* immutable headers (redirect) */ }
    log.info({ rid: requestId, sid, method: req.method, path, status: res.status, ms: Date.now() - t0 }, "req");
    return res;
  };
}

async function idempotent(key: string, sessionId: string, method: string, path: string, run: () => Promise<Response>): Promise<Response> {
  if (!KEY_RE.test(key)) throw new HttpError(400, "Invalid Idempotency-Key", "bad_idempotency_key");
  if (Math.random() < 0.02) db.delete(schema.idempotencyKeys).where(lt(schema.idempotencyKeys.createdAt, new Date(Date.now() - 48 * 3600_000))).catch(() => {});
  for (let attempt = 0; attempt < 2; attempt++) {
    const ins = await db.insert(schema.idempotencyKeys).values({ key, sessionId, method, path }).onConflictDoNothing().returning({ key: schema.idempotencyKeys.key });
    if (ins.length) break;
    const [row] = await db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, key));
    if (!row) continue; // deleted in between: try to claim it again
    if (row.method !== method || row.path !== path) throw new HttpError(422, "Idempotency-Key was used for a different request", "idempotency_mismatch");
    if (row.status != null) return Response.json(row.response ?? null, { status: row.status, headers: { "idempotent-replay": "true" } });
    if (Date.now() - row.createdAt.getTime() < 60_000) throw new HttpError(409, "The same request is still being processed", "in_progress");
    await db.delete(schema.idempotencyKeys).where(and(eq(schema.idempotencyKeys.key, key))); // stale claim (process died): take it over
  }
  const release = () => db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, key)).catch(() => {});
  let res: Response;
  try { res = await run(); } catch (e) { await release(); throw e; }
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (res.status >= 200 && res.status < 300 && isJson) {
    const text = await res.clone().text();
    if (text.length <= MAX_STORED) { await db.update(schema.idempotencyKeys).set({ status: res.status, response: JSON.parse(text) }).where(eq(schema.idempotencyKeys.key, key)); return res; }
  }
  await release(); // errors and streams are not replayable: let a retry run again
  return res;
}

export async function parseBody<T extends z.ZodTypeAny>(req: Request, s: T): Promise<z.infer<T>> {
  const j = await req.json().catch(() => { throw new HttpError(400, "Invalid JSON body"); });
  const r = s.safeParse(j); if (!r.success) throw new HttpError(400, "Validation: " + r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; "));
  return r.data;
}
export { clientError, uuid, optUuid, optDate };
export { HttpError, requireFresh };
