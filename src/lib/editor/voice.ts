/**
 * file: src/lib/editor/voice.ts
 * description: pure logic of the voice-note flows (SPEC §2 `audio`, §4.13): what the server's transcription state writes into the node,
 *   the wording of the limits and failures (25 MB, not audio, not configured…), the AI blocks inserted from a summary ("Insert
 *   summary", "Insert as tasks" — always an `aiBlock` with `action` and `sources`, tasks as `taskItem`s), the transcript lines that
 *   match a search, and a pause-aware recording clock. No DOM, no network: unit-tested in tests/unit/next-p-cv-voice.test.ts.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import type { AudioAttrs, AudioSummary, TranscriptLine } from "./next-node-defs";
import type { PMNode } from "./text";

/** Answer of `GET /api/audio/<id>` and `POST /api/audio/<id>/transcribe` (docs/next/API-NEXT-AI.md §6). */
export interface TranscriptView { attachmentId: string; status: "none" | "pending" | "done" | "failed"; transcript: TranscriptLine[]; text: string; engine: string | null; model: string | null; language: string | null; duration: number | null; segments: boolean | null; summary: AudioSummary | null; error: string | null; queued?: boolean }

export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;
/** `openai:whisper-1` — the value written to `audio.transcriptEngine`. */
export const engineLabel = (engine: string | null | undefined, model: string | null | undefined): string | null => (engine && model ? `${engine}:${model}` : model || engine || null);

const sameLines = (a: unknown, b: TranscriptLine[]) => Array.isArray(a) && a.length === b.length && a.every((l, i) => l && (l as TranscriptLine).t === b[i].t && (l as TranscriptLine).text === b[i].text);
const sameSummary = (a: AudioSummary | null | undefined, b: AudioSummary | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/**
 * What the server state changes in the node (null = nothing to write, so no empty transaction and no new page version).
 * `done` copies the transcript, the engine and the summary; `failed` only marks the failure (a transcript already in the node is kept);
 * `none` while the node says `pending` means the request never reached this server: back to `none`. `pending` marks the node pending.
 */
export function patchFromServer(attrs: Pick<AudioAttrs, "transcript" | "transcriptStatus" | "transcriptEngine" | "summary">, v: TranscriptView): Partial<AudioAttrs> | null {
  if (v.status === "done") {
    const transcript = (Array.isArray(v.transcript) ? v.transcript : []).filter((l) => l && Number.isFinite(l.t) && typeof l.text === "string").slice(0, 20_000).map((l) => ({ t: l.t, text: l.text.slice(0, 5000) }));
    const engine = engineLabel(v.engine, v.model); const summary = v.summary && typeof v.summary === "object" && typeof v.summary.text === "string" ? v.summary : null;
    const patch: Partial<AudioAttrs> = {};
    if (!sameLines(attrs.transcript, transcript)) patch.transcript = transcript;
    if (attrs.transcriptStatus !== "done") patch.transcriptStatus = "done";
    if ((attrs.transcriptEngine ?? null) !== engine) patch.transcriptEngine = engine;
    if (!sameSummary(attrs.summary, summary) && (summary || !attrs.summary)) patch.summary = summary; // a summary already in the node is never erased by a transcript without one
    return Object.keys(patch).length ? patch : null;
  }
  if (v.status === "failed") return attrs.transcriptStatus === "failed" ? null : { transcriptStatus: "failed" };
  if (v.status === "pending") return attrs.transcriptStatus === "pending" ? null : { transcriptStatus: "pending" };
  return attrs.transcriptStatus === "pending" ? { transcriptStatus: "none" } : null;
}

export interface VoiceProblem { /** shown in the block */ message: string; /** the server cannot transcribe at all (older server): hide the action */ unavailable?: boolean; /** worth offering "Retry" */ retry: boolean }
/** Wording of a refused or failed transcription request, from the API error (`status`, `code`, `message`). */
export function transcribeProblem(e: { status?: number; code?: string; message?: string } | null | undefined): VoiceProblem {
  const status = e?.status ?? 0; const code = e?.code;
  if (code === "too_large" || status === 413) return { message: "This recording is larger than 25 MB, the most the transcription engine accepts. It stays playable here; split it or export a lighter file to transcribe it.", retry: false };
  if (code === "not_audio" || status === 415) return { message: "This file is not an audio recording the transcription engine can read (webm, m4a, mp3, wav, ogg or flac).", retry: false };
  if (code === "not_configured") return { message: "Transcription is not configured on this server (no transcription provider key).", retry: false };
  if (code === "queue_unavailable") return { message: "The job queue is unavailable: nothing was sent to the transcription engine. Try again in a moment.", retry: true };
  if (status === 404 && /attachment not found/i.test(e?.message ?? "")) return { message: "The audio file no longer exists on the server, so it cannot be transcribed.", retry: false };
  if (status === 404 || status === 405 || status === 501) return { message: "Transcription is not available on this server yet", unavailable: true, retry: false };
  if (status === 0) return { message: "No connection: the transcription was not requested.", retry: true };
  return { message: e?.message ? `Transcription could not be started: ${e.message}` : "Transcription could not be started.", retry: true };
}

export interface VoiceSource { pageId: string | null; blockId: string | null; title: string }
const p = (text: string): PMNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const clean = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean) : []);
const aiAttrs = (summary: AudioSummary, action: string, prompt: string, source: VoiceSource, at: Date) => ({ model: typeof summary.model === "string" && summary.model ? summary.model : "ai", prompt, at: at.toISOString(), action, sources: source.pageId ? [{ pageId: source.pageId, blockId: source.blockId ?? undefined, title: source.title || "Voice note" }] : null });
/** "Insert summary": an AI block (action `summary`, source = the voice note) with the summary and, when there are any, the decisions. Null when there is no text. */
export function summaryBlock(summary: AudioSummary | null | undefined, source: VoiceSource, at = new Date()): PMNode | null {
  const text = typeof summary?.text === "string" ? summary.text.trim() : ""; if (!summary || !text) return null;
  const decisions = clean(summary.decisions);
  return { type: "aiBlock", attrs: aiAttrs(summary, "summary", "Summary of the voice note", source, at), content: [...text.split(/\n{2,}/).map((x) => p(x.replace(/\s+/g, " ").trim())).filter((n) => n.content?.[0]?.text), ...(decisions.length ? [p("Decisions"), { type: "bulletList", content: decisions.map((d) => ({ type: "listItem", content: [p(d)] })) }] : [])] };
}
/** "Insert as tasks": an AI block (action `tasks`) holding one unchecked `taskItem` per task of the summary. Null when there is none. */
export function tasksBlock(summary: AudioSummary | null | undefined, source: VoiceSource, at = new Date()): PMNode | null {
  const tasks = clean(summary?.tasks); if (!summary || !tasks.length) return null;
  return { type: "aiBlock", attrs: aiAttrs(summary, "tasks", "Tasks from the voice note", source, at), content: [{ type: "taskList", content: tasks.map((t) => ({ type: "taskItem", attrs: { checked: false }, content: [p(t.slice(0, 500))] })) }] };
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Search words of a `?hl=` parameter (words of 3 letters or more, like the page deep link). */
export const searchTerms = (hl: string | null | undefined): string[] => fold(hl ?? "").split(/\s+/).filter((w) => w.length > 2).slice(0, 8);
/** Indexes of the transcript lines that contain at least one of the words (accent- and case-insensitive). */
export function matchingLines(lines: readonly TranscriptLine[], terms: readonly string[]): number[] {
  if (!terms.length) return [];
  const out: number[] = []; lines.forEach((l, i) => { const t = fold(l.text); if (terms.some((w) => t.includes(w))) out.push(i); }); return out;
}

/** Recording clock that does not count the pauses. Times are `performance.now()`-style milliseconds. */
export interface RecClock { startedAt: number; pausedAt: number | null; pausedTotal: number }
export const startClock = (now: number): RecClock => ({ startedAt: now, pausedAt: null, pausedTotal: 0 });
export const pauseClock = (c: RecClock, now: number): RecClock => (c.pausedAt == null ? { ...c, pausedAt: now } : c);
export const resumeClock = (c: RecClock, now: number): RecClock => (c.pausedAt == null ? c : { ...c, pausedAt: null, pausedTotal: c.pausedTotal + Math.max(0, now - c.pausedAt) });
/** Seconds actually recorded so far. */
export const clockSeconds = (c: RecClock, now: number): number => Math.max(0, ((c.pausedAt ?? now) - c.startedAt - c.pausedTotal) / 1000);
