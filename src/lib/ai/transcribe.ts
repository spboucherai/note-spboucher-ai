/**
 * Voice notes — server transcription (SPEC §4.13). `POST /api/audio/<attachmentId>/transcribe` queues a pg-boss job `transcribe`;
 * the worker sends the audio attachment to the OpenAI transcription API and stores the result in `audio_transcripts`;
 * `GET /api/audio/<attachmentId>` returns `{status, transcript:[{t,text}], engine, summary?}`. The editor then writes the transcript into
 * the `audio` node of the page (client side, through a normal versioned save).
 *
 * Engine choice: the transcription model ids the account exposes are discovered live (`models.list()`), never assumed. Preference goes
 * to a model that returns SEGMENT TIMESTAMPS: `whisper-1` (verbose_json + segment granularity), then a diarising model (diarized_json);
 * a text-only model is used last and yields one segment at t=0 (reported as `segments:false`). The engine and model actually used are
 * stored with the transcript. The paid call is never retried automatically (queue policy), and a transcript is never fabricated: on any
 * failure the row is `failed` with the provider's error.
 *
 * Cost: transcription prices are not in the catalogue (the benchmark never probed audio models), so `cost_usd` is computed only when the
 * owner has set `settings['ai.transcription_usd_per_minute']`; otherwise it is null and the audio duration is what is recorded.
 */
import fs from "node:fs/promises";
import OpenAI, { toFile } from "openai";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "@/lib/errors";
import { absPath } from "@/lib/files/storage";
import { enqueue, QUEUES } from "@/lib/jobs";
import { callAI } from "./providers";
import { route } from "./router";
import { recordUsage } from "./usage";
import { providerConfigured } from "./registry";
import { INJECTION_GUARD } from "./prompts";

export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024; // documented limit of the OpenAI transcription endpoint
export const AUDIO_EXT: Record<string, string> = { "audio/webm": "webm", "video/webm": "webm", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "audio/flac": "flac", "audio/x-flac": "flac", "audio/aac": "m4a" };
const ACCEPTED_EXT = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"]);
export interface Segment { t: number; text: string }
export interface EngineResult { segments: Segment[]; text: string; language: string | null; duration: number | null; hasSegments: boolean }
export type Transcriber = (file: { path: string; name: string }, model: string, language?: string | null) => Promise<EngineResult>;
export interface TranscriptSummary { text: string; decisions: string[]; tasks: string[]; model: string; at: string }

// ---------- engine discovery
const isTranscriptionModel = (id: string) => /(whisper|transcribe)/.test(id) && !/(realtime|live)/.test(id);
/** Kind of timestamps a transcription model can return. */
export const timestampSupport = (id: string): "segments" | "diarized" | "none" => (/^whisper-1/.test(id) ? "segments" : /diarize/.test(id) ? "diarized" : "none");
/** Best model among the ids the account exposes: segment timestamps first, then diarised segments, then text only. Dated snapshots last. */
export function pickTranscriptionModel(ids: string[]): string | null {
  const c = ids.filter(isTranscriptionModel); if (!c.length) return null;
  const rank = (id: string) => ({ segments: 0, diarized: 1, none: 2 })[timestampSupport(id)] * 10 + (/\d{4}-\d{2}-\d{2}$/.test(id) ? 1 : 0);
  return [...c].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0];
}
/** Transcription model ids exposed by the OpenAI account, discovered live and remembered for a day (`settings['ai.transcription_models']`). */
export async function listTranscriptionModels(force = false): Promise<string[]> {
  const KEY = "ai.transcription_models";
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, KEY));
  const cached = row?.value as { at?: string; ids?: string[] } | undefined;
  if (!force && cached?.ids?.length && cached.at && Date.now() - new Date(cached.at).getTime() < 864e5) return cached.ids;
  const ids: string[] = []; for await (const m of new OpenAI().models.list() as any) if (isTranscriptionModel(m.id)) ids.push(m.id);
  ids.sort(); const value = { at: new Date().toISOString(), ids };
  await db.insert(schema.settings).values({ key: KEY, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
  return ids;
}
/** Model to use: the owner's setting `ai.transcription_model` when it is still exposed, else the best discovered one. */
export async function transcriptionModel(): Promise<string> {
  const ids = await listTranscriptionModels();
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, "ai.transcription_model"));
  const chosen = typeof row?.value === "string" ? row.value : null;
  const model = chosen && ids.includes(chosen) ? chosen : pickTranscriptionModel(ids);
  if (!model) throw new Error("The OpenAI account exposes no transcription model.");
  return model;
}

// ---------- engine call
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
/** Map an OpenAI transcription response to `[{t, text}]`. Pure (the response shapes are the documented ones). */
export function toEngineResult(resp: any, model: string): EngineResult {
  const text = clean(resp?.text); const kind = timestampSupport(model);
  const raw: any[] = Array.isArray(resp?.segments) ? resp.segments : [];
  const segs: Segment[] = raw.map((s) => ({ t: Math.max(0, Math.round(Number(s.start ?? 0) * 100) / 100), text: kind === "diarized" && s.speaker ? `${clean(s.speaker)}: ${clean(s.text)}` : clean(s.text) })).filter((s) => s.text && Number.isFinite(s.t));
  const d = typeof resp?.duration === "number" ? resp.duration : typeof resp?.usage?.seconds === "number" ? resp.usage.seconds : raw.length ? Number(raw[raw.length - 1].end ?? 0) || null : null;
  const duration = d == null ? null : Math.round(d * 100) / 100;
  if (segs.length) return { segments: segs, text: text || segs.map((s) => s.text).join(" "), language: resp?.language ?? null, duration, hasSegments: true };
  return { segments: text ? [{ t: 0, text }] : [], text, language: resp?.language ?? null, duration, hasSegments: false };
}
export const openaiTranscriber: Transcriber = async (file, model, language) => {
  const kind = timestampSupport(model); const client = new OpenAI({ maxRetries: 0, timeout: 10 * 60_000 });
  const body: any = { file: await toFile(await fs.readFile(file.path), file.name), model, ...(language ? { language } : {}) };
  if (kind === "segments") { body.response_format = "verbose_json"; body.timestamp_granularities = ["segment"]; }
  else if (kind === "diarized") { body.response_format = "diarized_json"; body.chunking_strategy = "auto"; }
  else body.response_format = "json";
  return toEngineResult(await client.audio.transcriptions.create(body), model);
};

// ---------- summary (optional, through the router, strict JSON)
export const SUMMARY_SCHEMA = { type: "object", properties: { text: { type: "string" }, decisions: { type: "array", items: { type: "string" } }, tasks: { type: "array", items: { type: "string" } } }, required: ["text", "decisions", "tasks"], additionalProperties: false } as const;
const SUMMARY_SYSTEM = `You summarise the transcript of a voice note or a meeting recorded by the owner of a private knowledge workspace. Return JSON: "text" (a summary of two to five sentences), "decisions" (decisions that were actually stated — empty list when none), "tasks" (concrete actions to do, imperative, with the person and date when stated — empty list when none). Use only what the transcript says, in its language. A transcript may contain recognition errors: do not invent names, numbers or dates to repair them.
${INJECTION_GUARD}`;
export function validateSummary(raw: unknown, model: string, at = new Date()): TranscriptSummary | null {
  const r = raw as { text?: unknown; decisions?: unknown; tasks?: unknown } | null; if (!r || typeof r.text !== "string" || !r.text.trim()) return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 30).map((s) => s.slice(0, 500)) : []);
  return { text: r.text.replace(/\s+/g, " ").trim().slice(0, 3000), decisions: list(r.decisions), tasks: list(r.tasks), model, at: at.toISOString() };
}
export async function summariseTranscript(workspaceId: string, attachmentId: string, text: string, model?: string | null): Promise<TranscriptSummary> {
  const dec = await route({ task: "extract", schema: true, preferred: model ?? null, estTokens: Math.ceil(text.length / 3.6) + 800 });
  const res = await callAI({ model: dec.model.id, provider: dec.provider, system: SUMMARY_SYSTEM, effort: "low", maxTokens: 1500, timeoutMs: 120_000, jsonSchema: { name: "voice_summary", schema: SUMMARY_SCHEMA as unknown as Record<string, unknown> }, messages: [{ role: "user", content: `<workspace kind="transcript">\n${text.slice(0, 60_000)}\n</workspace>` }] });
  let raw: unknown = null; try { raw = JSON.parse(res.text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { /* handled below */ }
  const s = res.refusal ? null : validateSummary(raw, dec.model.id);
  await recordUsage({ workspaceId, provider: dec.provider, model: dec.model.id, task: "transcribe_summary", usage: res.usage, costUsd: res.costUsd, latencyMs: res.totalMs, ttftMs: res.ttftMs, ok: Boolean(s), error: s ? null : res.refusal ?? "invalid JSON", refId: attachmentId });
  if (!s) throw new Error(res.refusal ? "the model declined to summarise" : "the model did not return a valid summary");
  return s;
}

// ---------- request / read / run
const T = schema.audioTranscripts;
export const isAudio = (mime: string) => mime.startsWith("audio/") || mime === "video/webm" || mime === "video/mp4";
async function attachment(workspaceId: string, id: string) {
  const [a] = await db.select().from(schema.attachments).where(and(eq(schema.attachments.id, id), eq(schema.attachments.workspaceId, workspaceId), isNull(schema.attachments.deletedAt)));
  if (!a) throw new HttpError(404, "Attachment not found");
  return a;
}
export function view(attachmentId: string, r: typeof T.$inferSelect | undefined) {
  if (!r) return { attachmentId, status: "none" as const, transcript: [] as Segment[], text: "", engine: null, model: null, language: null, duration: null, segments: null, summary: null, error: null, costUsd: null, requestedAt: null, finishedAt: null };
  return { attachmentId, status: r.status as "pending" | "done" | "failed", transcript: r.transcript, text: r.text, engine: r.engine, model: r.model, language: r.language, duration: r.duration, segments: r.status === "done" && r.model ? timestampSupport(r.model) !== "none" : null,
    summary: r.summary ?? null, error: r.error, costUsd: r.costUsd, requestedAt: r.requestedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null };
}
export async function getTranscript(workspaceId: string, attachmentId: string) {
  await attachment(workspaceId, attachmentId);
  const [r] = await db.select().from(T).where(and(eq(T.attachmentId, attachmentId), eq(T.workspaceId, workspaceId)));
  return view(attachmentId, r);
}
/** Queue a transcription. Idempotent: an attachment already transcribed (or pending) is returned as is unless `force`. */
export async function requestTranscription(workspaceId: string, attachmentId: string, opts: { summarize?: boolean; force?: boolean } = {}) {
  const a = await attachment(workspaceId, attachmentId);
  if (!isAudio(a.mime)) throw new HttpError(415, "This attachment is not an audio recording", "not_audio");
  if (a.size > TRANSCRIBE_MAX_BYTES) throw new HttpError(413, "This recording is larger than the 25 MB the transcription engine accepts", "too_large");
  if (!providerConfigured("openai")) throw new HttpError(503, "Transcription is not configured on this server: OPENAI_API_KEY is not set.", "not_configured");
  const [ex] = await db.select().from(T).where(eq(T.attachmentId, attachmentId));
  const fresh = ex?.status === "pending" && Date.now() - ex.requestedAt.getTime() < 20 * 60_000;
  if (ex && !opts.force && (fresh || (ex.status === "done" && !(opts.summarize && !ex.summary)))) return { queued: false, ...view(attachmentId, ex) };
  const summaryOnly = Boolean(ex && ex.status === "done" && !opts.force && opts.summarize && !ex.summary);
  const now = new Date();
  if (summaryOnly) await db.update(T).set({ wantSummary: true, status: "pending", error: null, requestedAt: now }).where(eq(T.attachmentId, attachmentId));
  else await db.insert(T).values({ attachmentId, workspaceId, status: "pending", wantSummary: Boolean(opts.summarize), requestedAt: now })
    .onConflictDoUpdate({ target: T.attachmentId, set: { status: "pending", wantSummary: Boolean(opts.summarize), error: null, transcript: [], text: "", summary: null, engine: null, model: null, language: null, duration: null, costUsd: null, requestedAt: now, startedAt: null, finishedAt: null } });
  const job = await enqueue(QUEUES.transcribe, { attachmentId, workspaceId, summaryOnly }); // de-duplication = the pending row checked above
  if (!job) { await db.update(T).set({ status: "failed", error: "The job queue is unavailable; nothing was sent to the transcription engine.", finishedAt: new Date() }).where(eq(T.attachmentId, attachmentId)); throw new HttpError(503, "The job queue is unavailable", "queue_unavailable"); }
  const [r] = await db.select().from(T).where(eq(T.attachmentId, attachmentId));
  return { queued: true, jobId: job, ...view(attachmentId, r) };
}
/** Worker side. `engine` / `model` are injectable for tests; production uses the OpenAI transcription API and the discovered model. */
export async function runTranscription(d: { attachmentId: string; workspaceId?: string; summaryOnly?: boolean }, deps: { transcriber?: Transcriber; model?: string; summaryModel?: string | null } = {}) {
  const [row] = await db.select().from(T).where(eq(T.attachmentId, d.attachmentId)); if (!row) return { ignored: true };
  const [a] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, d.attachmentId));
  const fail = async (msg: string) => { await db.update(T).set({ status: "failed", error: msg.slice(0, 500), finishedAt: new Date() }).where(eq(T.attachmentId, d.attachmentId)); return { failed: true }; };
  if (!a || a.deletedAt) return fail("The attachment no longer exists.");
  await db.update(T).set({ startedAt: new Date() }).where(eq(T.attachmentId, d.attachmentId));
  let text = row.text; let n = row.transcript.length;
  if (!d.summaryOnly || !row.text) {
    let model: string; const t0 = Date.now();
    try { model = deps.model ?? (await transcriptionModel()); } catch (e) { return fail(`No transcription model: ${String((e as Error).message)}`); }
    const extFromName = (a.filename.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? "").toLowerCase(); const ext = ACCEPTED_EXT.has(extFromName) ? extFromName : AUDIO_EXT[a.mime.split(";")[0]] ?? null;
    if (!ext) return fail(`Unsupported audio format (${a.mime}).`);
    try {
      const r = await (deps.transcriber ?? openaiTranscriber)({ path: absPath(a.storagePath), name: `audio.${ext}` }, model);
      const [price] = await db.select().from(schema.settings).where(eq(schema.settings.key, "ai.transcription_usd_per_minute"));
      const perMin = typeof price?.value === "number" ? price.value : null; const cost = perMin != null && r.duration != null ? (r.duration / 60) * perMin : null;
      await recordUsage({ workspaceId: row.workspaceId, provider: "openai", model, task: "transcribe", costUsd: cost, latencyMs: Date.now() - t0, ok: true, refId: d.attachmentId });
      if (!r.text) return fail("The engine returned an empty transcript (no speech recognised).");
      await db.update(T).set({ engine: "openai", model, language: r.language, duration: r.duration, transcript: r.segments, text: r.text, costUsd: cost }).where(eq(T.attachmentId, d.attachmentId));
      text = r.text; n = r.segments.length;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).replace(/\s+/g, " ");
      await recordUsage({ workspaceId: row.workspaceId, provider: "openai", model, task: "transcribe", latencyMs: Date.now() - t0, ok: false, error: msg, refId: d.attachmentId });
      return fail(`Transcription failed: ${msg}`);
    }
  }
  let summaryError: string | null = null; let summary: TranscriptSummary | null = row.summary ?? null;
  if (row.wantSummary || d.summaryOnly) { try { summary = await summariseTranscript(row.workspaceId, d.attachmentId, text, deps.summaryModel); } catch (e) { summaryError = `Summary not produced: ${String((e as Error)?.message ?? e).slice(0, 300)}`; } }
  await db.update(T).set({ status: "done", summary, error: summaryError, finishedAt: new Date() }).where(eq(T.attachmentId, d.attachmentId));
  return { segments: n, chars: text.length, summary: Boolean(summary) };
}
