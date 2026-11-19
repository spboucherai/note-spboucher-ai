import { z } from "zod";
import { handler, uuid, HttpError } from "@/lib/api";
import { aiSynopsis } from "@/lib/ai/zoom";
export const maxDuration = 120;
/**
 * Semantic zoom level 1 (SPEC §4.9) — AI synopsis of a page, cached by content hash, always marked `ai:true` with `model` + `generatedAt`.
 * GET  ?cachedOnly=1 → never calls a provider (`status:"missing"` when there is no valid synopsis); without it, generates when missing.
 * POST {model?}      → regenerates (owner pressed "Regenerate"), optionally with a chosen model.
 * The foundation route `GET /api/pages/<id>/zoom?level=1` delegates to the same function (`aiSynopsis`).
 */
export const GET = handler(async ({ req, ws, params }) => {
  const id = uuid.safeParse(params.id); if (!id.success) throw new HttpError(400, "Invalid page id", "bad_id");
  const u = new URL(req.url).searchParams; const model = u.get("model");
  return Response.json(await aiSynopsis(ws.id, id.data, { generate: u.get("cachedOnly") !== "1", model: model && model.length <= 200 ? model : null, signal: req.signal }));
});
export const POST = handler(async ({ req, ws, params }) => {
  const id = uuid.safeParse(params.id); if (!id.success) throw new HttpError(400, "Invalid page id", "bad_id");
  const b = z.object({ model: z.string().max(200).nullable().optional() }).safeParse(await req.json().catch(() => ({}))); if (!b.success) throw new HttpError(400, "Invalid body");
  return Response.json(await aiSynopsis(ws.id, id.data, { force: true, model: b.data.model ?? null, signal: req.signal }));
});
