import { handler, HttpError, optDate, optUuid } from "@/lib/api";
import { stateAt } from "@/lib/timemachine/service";
export const dynamic = "force-dynamic";
/**
 * GET /api/timemachine?at=<ISO>&pageId=<id> | &projectId=<id> [&content=0|1]
 * → `{at, scope, pages, relations, references, removedSince, journalSince}`: the state at that date. Page content is included for
 * `pageId` (and for `projectId` only with `content=1`). To bring a page back to a listed version:
 * `POST /api/pages/<id>/versions/<versionId>/restore`.
 */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams; const at = optDate(u.get("at"), "at"); if (!at) throw new HttpError(400, "at is required (ISO date)", "bad_request");
  const pageId = optUuid(u.get("pageId")); const projectId = optUuid(u.get("projectId"));
  if (Boolean(pageId) === Boolean(projectId)) throw new HttpError(400, "Give exactly one of pageId or projectId", "bad_request");
  const c = u.get("content");
  return Response.json(await stateAt(ws.id, at, { pageId, projectId }, { content: c === null ? undefined : c === "1" }));
});
