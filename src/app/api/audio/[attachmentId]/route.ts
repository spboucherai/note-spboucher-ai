import { handler, uuid, HttpError } from "@/lib/api";
import { getTranscript } from "@/lib/ai/transcribe";
/**
 * GET → state of the transcription of one audio attachment (SPEC §4.13):
 * `{attachmentId, status: none|pending|done|failed, transcript:[{t,text}], text, engine, model, language, duration, segments, summary?, error}`.
 * Poll while `pending` (2–3 s). The client writes the transcript into the `audio` node itself.
 */
export const GET = handler(async ({ ws, params }) => {
  const id = uuid.safeParse(params.attachmentId); if (!id.success) throw new HttpError(400, "Invalid attachment id", "bad_id");
  return Response.json(await getTranscript(ws.id, id.data));
});
