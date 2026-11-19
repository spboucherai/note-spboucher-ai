import { z } from "zod";
import { handler, uuid, HttpError } from "@/lib/api";
import { requestTranscription } from "@/lib/ai/transcribe";
import { audit } from "@/lib/audit";
/**
 * POST {summarize?, force?} → queue the transcription of an audio attachment (pg-boss job `transcribe`, never retried automatically).
 * 202 `{queued:true, status:"pending", …}` when a job was queued; 200 `{queued:false, …}` when a transcript already exists or is pending.
 * `summarize:true` also extracts a summary, decisions and tasks (strict JSON through the router) once the transcript exists.
 * Errors: 404 unknown attachment · 415 `not_audio` · 413 `too_large` (> 25 MB) · 503 `not_configured` | `queue_unavailable`.
 */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.safeParse(params.attachmentId); if (!id.success) throw new HttpError(400, "Invalid attachment id", "bad_id");
  const b = z.object({ summarize: z.boolean().optional(), force: z.boolean().optional() }).safeParse(await req.json().catch(() => ({}))); if (!b.success) throw new HttpError(400, "Invalid body");
  const r = await requestTranscription(ws.id, id.data, b.data);
  if (r.queued) await audit(user.id, "audio.transcribe", { type: "attachment", id: id.data }, { summarize: Boolean(b.data.summarize) });
  return Response.json(r, { status: r.queued ? 202 : 200 });
});
