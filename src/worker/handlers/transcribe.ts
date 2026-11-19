/** transcribe job: { attachmentId, workspaceId, summaryOnly? } — voice-note transcription (SPEC §4.13). Paid call: never retried by the queue. */
import { runTranscription } from "../../lib/ai/transcribe";
export async function handleTranscribe(d: { attachmentId: string; workspaceId?: string; summaryOnly?: boolean }) {
  if (!d?.attachmentId) return { ignored: true };
  return runTranscription(d);
}
