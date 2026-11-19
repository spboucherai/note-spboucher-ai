import { handler, uuid, HttpError } from "@/lib/api";
import { suggest } from "@/lib/ai/inbox";
export const maxDuration = 120;
/**
 * GET → AI suggestions for one capture of the inbox (SPEC §4.12): title, tags, destination, related pages, summary — validated against
 * the workspace, cached by content hash, marked `ai:true`. SUGGESTIONS ONLY: this route changes nothing in the workspace.
 * `?refresh=1` regenerates; `?cachedOnly=1` never calls a provider (404 `not_generated` when nothing is cached); `?model=` chooses the model.
 */
export const GET = handler(async ({ req, ws, params }) => {
  const id = uuid.safeParse(params.id); if (!id.success) throw new HttpError(400, "Invalid id", "bad_id");
  const u = new URL(req.url).searchParams; const model = u.get("model");
  return Response.json(await suggest(ws.id, id.data, { refresh: u.get("refresh") === "1", generate: u.get("cachedOnly") !== "1", model: model && model.length <= 200 ? model : null, signal: req.signal }));
});
