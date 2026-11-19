"use client";
/**
 * file: src/components/editor/nodes/AudioView.tsx
 * description: node view of the `audio` block (voice note, SPEC §2 and §4.13). Without an attachment it is a recorder (microphone →
 *   MediaRecorder → upload → attrs; the microphone tracks are always released, a failed upload keeps the recording for a retry) or an
 *   audio-file picker. With an attachment it is a compact player (play/pause, keyboard-friendly scrubber, rate, editable title), a
 *   waveform decoded lazily and only for small files, the transcript as seek buttons, the transcription request (feature-detected:
 *   an older server simply shows "not available") and the AI summary, always labelled as AI and never produced or changed here.
 *   Nothing touches the microphone, an AudioContext or the network before the user asks.
 *   Voice flows (SPEC §4.13): recording with pause/resume; "Transcribe" (optionally with an AI summary) queues the server job, the
 *   block then polls `GET /api/audio/<id>` while it is pending and writes the result into the node itself (the server never edits
 *   the page); failures say why and offer a retry; the 25 MB limit and a missing configuration are explained; the summary offers
 *   "Insert summary" / "Insert as tasks" (AI blocks with their source); search words (`?hl=`) are marked in the transcript; once
 *   transcribed, the original audio can be kept or deleted (the transcript stays).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { AudioLines, Captions, FileAudio, ListTodo, ListPlus, Mic, Pause, Play, RotateCw, Sparkles, Square, Trash2, Upload, X } from "lucide-react";
import type { AudioAttrs, AudioSummary } from "@/lib/editor/next-node-defs";
import { activeLineIndex, computePeaks, extensionForMime, formatTime, pickRecordingMime, transcriptLines, transcriptStamp } from "@/lib/editor/audio";
import { fileUrl, uploadFile } from "@/lib/client/upload";
import { api, ApiError } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { clockSeconds, matchingLines, patchFromServer, pauseClock, resumeClock, searchTerms, startClock, summaryBlock, tasksBlock, transcribeProblem, type RecClock, type TranscriptView, type VoiceSource } from "@/lib/editor/voice";
import { NodeButton, NodeFrame, NodeState, useDebounced, type LeafViewProps } from "./frame";

/** The waveform needs the whole file decoded in memory: only for attachments up to 25 MB, and (when the length is known) 45 minutes. */
const MAX_WAVE_BYTES = 25 * 1024 * 1024;
const MAX_WAVE_SECONDS = 45 * 60;
const WAVE_BUCKETS = 160;
const RATES = [1, 1.25, 1.5, 2];
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const stopTracks = (stream: MediaStream | null | undefined) => { stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already ended */ } }); };
function microphoneError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access was refused. Allow the microphone for this site in the browser settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this device.";
  if (name === "NotReadableError" || name === "AbortError") return "The microphone is in use by another application or could not be started.";
  return "The microphone could not be opened.";
}
const stamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;

export function AudioView(props: LeafViewProps<AudioAttrs>) {
  const { attrs, editable, selected } = props;
  const title = typeof attrs.title === "string" ? attrs.title : "";
  return (
    <NodeFrame kind="audio" label="Voice note" icon={<Mic />} title={attrs.attachmentId && editable ? undefined : title} selected={selected}>
      {attrs.attachmentId ? <Player key={attrs.attachmentId} {...props} attachmentId={attrs.attachmentId} />
        : (Array.isArray(attrs.transcript) && attrs.transcript.length > 0) || attrs.summary ? <Player key="transcript-only" {...props} attachmentId={null} /> // the audio was deleted, the transcript kept
        : editable ? <Recorder {...props} />
        : <NodeState icon={<Mic />} title="No recording yet" />}
    </NodeFrame>
  );
}

interface Session { stream: MediaStream; recorder: MediaRecorder; chunks: Blob[]; clock: RecClock; startedIso: string; mime: string; discard: boolean; context: AudioContext | null; raf: number; timer: ReturnType<typeof setInterval> | null }
interface Take { blob: Blob; duration: number; recordedAt: string }

function Recorder({ attrs, update, pageId }: LeafViewProps<AudioAttrs>) {
  const [phase, setPhase] = React.useState<"idle" | "asking" | "recording" | "uploading">("idle");
  const [problem, setProblem] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  /** A recording whose upload failed: kept in memory so it is not lost. */
  const [kept, setKept] = React.useState<Take | null>(null);
  const session = React.useRef<Session | null>(null); const meter = React.useRef<HTMLSpanElement>(null); const input = React.useRef<HTMLInputElement>(null);
  const abort = React.useRef<AbortController | null>(null); const alive = React.useRef(true);
  const titleRef = React.useRef(attrs.title); titleRef.current = attrs.title;

  const release = (s: Session) => {
    stopTracks(s.stream);
    if (s.timer) { clearInterval(s.timer); s.timer = null; }
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
    if (s.context) { void s.context.close().catch(() => {}); s.context = null; }
    if (session.current === s) session.current = null;
  };
  React.useEffect(() => {
    alive.current = true;
    return () => { // unmount: the microphone is released whatever the state, nothing is uploaded
      alive.current = false; abort.current?.abort();
      const s = session.current; if (s) { s.discard = true; try { if (s.recorder.state !== "inactive") s.recorder.stop(); } catch { /* not started */ } release(s); }
    };
  }, []);

  const send = async (take: Take | { file: File }) => {
    const controller = new AbortController(); abort.current = controller; setPhase("uploading"); setProgress(0); setProblem(null);
    try {
      if ("file" in take) {
        const up = await uploadFile(take.file, pageId, { onProgress: (f) => { if (alive.current) setProgress(f); }, signal: controller.signal });
        if (alive.current) update({ attachmentId: up.id, title: titleRef.current || take.file.name.replace(/\.[^.]+$/, "") });
      } else {
        const when = new Date(take.recordedAt); const type = (take.blob.type || "audio/webm").split(";")[0];
        const file = new File([take.blob], `voice-note-${stamp(when)}.${extensionForMime(type)}`, { type });
        const up = await uploadFile(file, pageId, { onProgress: (f) => { if (alive.current) setProgress(f); }, signal: controller.signal });
        if (alive.current) { setKept(null); update({ attachmentId: up.id, duration: take.duration, recordedAt: take.recordedAt, title: titleRef.current || `Voice note ${when.toLocaleDateString(undefined, { dateStyle: "medium" })}` }); }
      }
    } catch (e) {
      if (!alive.current) return;
      if (!("file" in take)) setKept(take);
      setProblem((e as Error)?.name === "AbortError" ? "Upload cancelled." : (e as Error)?.message || "Upload failed");
    } finally { if (abort.current === controller) abort.current = null; if (alive.current) setPhase("idle"); }
  };

  const start = async () => {
    if (phase !== "idle") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setProblem(typeof window !== "undefined" && !window.isSecureContext ? "The microphone needs a secure (https) page. You can still upload an audio file." : "Recording is not available in this browser. You can still upload an audio file."); return; }
    setPhase("asking"); setProblem(null);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { if (alive.current) { setPhase("idle"); setProblem(microphoneError(e)); } return; }
    if (!alive.current) { stopTracks(stream); return; }
    const format = pickRecordingMime((m) => MediaRecorder.isTypeSupported(m));
    let recorder: MediaRecorder;
    try { recorder = format.mime ? new MediaRecorder(stream, { mimeType: format.mime }) : new MediaRecorder(stream); }
    catch { try { recorder = new MediaRecorder(stream); } catch { stopTracks(stream); setPhase("idle"); setProblem("This browser cannot record audio."); return; } }
    const s: Session = { stream, recorder, chunks: [], clock: startClock(performance.now()), startedIso: new Date().toISOString(), mime: format.mime, discard: false, context: null, raf: 0, timer: null };
    session.current = s;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) s.chunks.push(e.data); };
    recorder.onerror = () => { s.discard = true; try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* ignore */ } release(s); if (alive.current) { setPhase("idle"); setProblem("The recording was interrupted."); } };
    recorder.onstop = () => {
      const duration = Math.round(clockSeconds(s.clock, performance.now()) * 10) / 10; // pauses are not part of the recording
      release(s);
      if (s.discard || !alive.current) { if (alive.current) setPhase("idle"); return; }
      const blob = new Blob(s.chunks, { type: recorder.mimeType || s.mime || "audio/webm" });
      if (blob.size === 0) { setPhase("idle"); setProblem("Nothing was recorded."); return; }
      void send({ blob, duration, recordedAt: s.startedIso });
    };
    // The track can end on its own (device unplugged, permission revoked): finish with what was captured.
    stream.getAudioTracks().forEach((t) => t.addEventListener("ended", () => { try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* ignore */ } }));
    try { recorder.start(1000); } catch { release(s); setPhase("idle"); setProblem("This browser cannot record audio."); return; }
    s.clock = startClock(performance.now()); setElapsed(0); setPaused(false);
    s.timer = setInterval(() => { if (alive.current) setElapsed(clockSeconds(s.clock, performance.now())); }, 250);
    if (!reducedMotion()) { // live level meter: written straight to the element, no React render per frame
      try {
        const Ctx: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const context = new Ctx(); s.context = context;
          const analyser = context.createAnalyser(); analyser.fftSize = 256; context.createMediaStreamSource(stream).connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const tick = () => {
            analyser.getByteTimeDomainData(data); let sum = 0;
            for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
            if (meter.current) meter.current.style.transform = `scaleX(${Math.min(1, Math.sqrt(sum / data.length) * 3.2).toFixed(3)})`;
            s.raf = requestAnimationFrame(tick);
          };
          s.raf = requestAnimationFrame(tick);
        }
      } catch { /* the meter is optional */ }
    }
    setPhase("recording");
  };
  const stop = (discard: boolean) => { const s = session.current; if (!s) return; s.discard = discard; try { if (s.recorder.state !== "inactive") s.recorder.stop(); else { release(s); setPhase("idle"); } } catch { release(s); setPhase("idle"); } };
  /** Pause keeps the microphone open and records nothing; resume continues the same recording (one file). */
  const togglePause = () => {
    const s = session.current; if (!s) return;
    try {
      if (s.recorder.state === "recording") { s.recorder.pause(); s.clock = pauseClock(s.clock, performance.now()); setPaused(true); }
      else if (s.recorder.state === "paused") { s.recorder.resume(); s.clock = resumeClock(s.clock, performance.now()); setPaused(false); }
    } catch { setProblem("This browser cannot pause a recording."); }
  };
  const pick = (file: File | undefined) => {
    if (!file || phase !== "idle") return;
    if (!file.type.startsWith("audio/") && !/\.(m4a|mp3|wav|ogg|oga|opus|webm|aac|flac|aiff?|caf)$/i.test(file.name)) { setProblem("Choose an audio file."); return; }
    if (file.size > MAX_AUDIO_BYTES) { setProblem("File too large (200 MB max)."); return; }
    if (file.size > MAX_WAVE_BYTES) toast("Large recording", { description: "It is kept and playable, but it is over the 25 MB a transcription accepts." });
    void send({ file });
  };

  if (phase === "recording") return (
    <div className="au-rec" role="group" aria-label="Recording" data-paused={paused ? "true" : undefined}>
      <span className="au-rec-dot" aria-hidden />
      <span className="au-rec-time" role="timer" aria-label="Elapsed time">{formatTime(elapsed)}</span>
      {paused ? <span className="nb-meta au-paused">Paused</span> : <span className="au-meter" aria-hidden><span ref={meter} className="au-meter-fill" /></span>}
      <span className="sr-only" role="status">{paused ? "Recording paused" : "Recording in progress"}</span>
      <span className="au-rec-actions">
        <NodeButton label="Discard recording" tone="danger" onClick={() => stop(true)}><Trash2 /></NodeButton>
        <NodeButton label={paused ? "Resume recording" : "Pause recording"} text onClick={togglePause}>{paused ? <Mic /> : <Pause />}</NodeButton>
        <NodeButton label="Stop recording" tone="accent" text onClick={() => stop(false)}><Square /></NodeButton>
      </span>
    </div>
  );
  if (phase === "uploading") return (
    <NodeState icon={<Upload />} title={`Uploading… ${Math.round(progress * 100)} %`} hint={<progress className="au-progress" max={1} value={progress} aria-label="Upload progress" />}>
      <NodeButton label="Cancel upload" text onClick={() => abort.current?.abort()}><X /></NodeButton>
    </NodeState>
  );
  return (
    <NodeState icon={<Mic />} tone={problem ? "danger" : "neutral"} title={phase === "asking" ? "Waiting for the microphone…" : problem ?? "Record a voice note"}
      hint={phase === "asking" ? "Answer the browser's permission prompt." : kept ? `Your recording (${formatTime(kept.duration)}) is still here — nothing was lost.` : problem ? undefined : "The microphone is used only while you record."}>
      <input ref={input} type="file" accept="audio/*" hidden aria-hidden tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pick(f); }} />
      {kept ? (
        <>
          <NodeButton label="Retry upload" tone="accent" text onClick={() => void send(kept)}><RotateCw /></NodeButton>
          <NodeButton label="Discard recording" tone="danger" text onClick={() => { setKept(null); setProblem(null); }}><Trash2 /></NodeButton>
        </>
      ) : (
        <>
          <NodeButton label="Start recording" tone="accent" text disabled={phase !== "idle"} onClick={() => void start()}><Mic /></NodeButton>
          <NodeButton label="Upload audio file" text disabled={phase !== "idle"} onClick={() => input.current?.click()}><FileAudio /></NodeButton>
        </>
      )}
    </NodeState>
  );
}

function Player({ attrs, update, editable, attachmentId, editor, getPos, pageId }: LeafViewProps<AudioAttrs> & { /** null = the original audio was deleted: transcript and summary only */ attachmentId: string | null }) {
  const audio = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [mediaDuration, setMediaDuration] = React.useState(0);
  const [rate, setRate] = React.useState(1);
  const [mediaError, setMediaError] = React.useState<string | null>(null);
  const storedDuration = Number.isFinite(attrs.duration) && attrs.duration > 0 ? attrs.duration : 0;
  const total = mediaDuration > 0 ? mediaDuration : storedDuration;
  const alive = React.useRef(true);
  const waveAbort = React.useRef<AbortController | null>(null);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; waveAbort.current?.abort(); audio.current?.pause(); }; }, []);

  // ---- duration: filled once from the media metadata when the node does not know it ----
  const filled = React.useRef(false);
  const onDuration = () => {
    const d = audio.current?.duration ?? 0; if (!Number.isFinite(d) || d <= 0) return;
    setMediaDuration(d);
    if (editable && storedDuration === 0 && !filled.current) { filled.current = true; update({ duration: Math.round(d * 10) / 10 }); }
  };

  // ---- waveform: fetched + decoded on first play or on request, small files only ----
  const [wave, setWave] = React.useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [peaks, setPeaks] = React.useState<number[] | null>(null);
  const loadWave = React.useCallback(async () => {
    if (wave !== "idle") return;
    if (total > MAX_WAVE_SECONDS) { setWave("unavailable"); return; }
    const controller = new AbortController(); waveAbort.current = controller; setWave("loading");
    try {
      if (!attachmentId) { setWave("unavailable"); return; }
      const res = await fetch(fileUrl(attachmentId), { credentials: "same-origin", signal: controller.signal });
      const length = Number(res.headers.get("content-length") ?? NaN);
      if (!res.ok || !Number.isFinite(length) || length <= 0 || length > MAX_WAVE_BYTES) { controller.abort(); if (alive.current) setWave("unavailable"); return; }
      const data = await res.arrayBuffer();
      if (data.byteLength > MAX_WAVE_BYTES) throw new Error("too large");
      const Offline: typeof OfflineAudioContext | undefined = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
      if (!Offline) throw new Error("no decoder");
      // An offline context decodes without an audio device or autoplay permission; a low sample rate keeps the decoded copy small.
      let context: OfflineAudioContext | null = null;
      for (const sampleRate of [8000, 22050, 44100]) { try { context = new Offline(1, 1, sampleRate); break; } catch { /* rate not supported: try the next */ } }
      if (!context) throw new Error("no decoder");
      const decoded = await context.decodeAudioData(data);
      const result = computePeaks(decoded.getChannelData(0), WAVE_BUCKETS);
      if (alive.current) { setPeaks(result); setWave("ready"); }
    } catch { if (alive.current) setWave("unavailable"); }
  }, [wave, total, attachmentId]);

  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [waveWidth, setWaveWidth] = React.useState(0);
  React.useEffect(() => {
    const el = canvas.current; if (!el || wave !== "ready") return;
    const measure = () => setWaveWidth(Math.floor(el.clientWidth)); measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, [wave]);
  const fraction = total > 0 ? Math.min(1, Math.max(0, time / total)) : 0;
  React.useEffect(() => {
    const el = canvas.current; if (!el || !peaks || waveWidth <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3); const h = el.clientHeight || 48;
    const w = Math.floor(waveWidth * dpr), hh = Math.floor(h * dpr); if (el.width !== w) el.width = w; if (el.height !== hh) el.height = hh;
    const ctx = el.getContext("2d"); if (!ctx) return;
    const css = getComputedStyle(el); const played = css.getPropertyValue("--accent").trim() || "#3b5bdb"; const rest = css.getPropertyValue("--line-strong").trim() || "#9aa0a6";
    ctx.clearRect(0, 0, w, hh);
    const n = peaks.length; const step = w / n; const bar = Math.max(1, Math.floor(step * 0.62)); const mid = hh / 2;
    for (let i = 0; i < n; i++) {
      const amp = Math.max(1 * dpr, peaks[i] * (hh - 2 * dpr)); const x = Math.floor(i * step + (step - bar) / 2);
      ctx.fillStyle = (i + 0.5) / n <= fraction ? played : rest; ctx.fillRect(x, Math.round(mid - amp / 2), bar, Math.round(amp));
    }
  }, [peaks, waveWidth, fraction]);

  // ---- transport ----
  const seek = (t: number) => { const el = audio.current; if (!el) return; const to = Math.max(0, total > 0 ? Math.min(t, total) : t); try { el.currentTime = to; } catch { /* not seekable yet */ } setTime(to); };
  const play = () => { const el = audio.current; if (!el) return; el.playbackRate = rate; setMediaError(null); void loadWave(); el.play().catch((e) => { if ((e as Error)?.name !== "AbortError") setMediaError("This recording cannot be played here."); }); };
  const toggle = () => { const el = audio.current; if (!el) return; if (el.paused) play(); else el.pause(); };
  const changeRate = (r: number) => { setRate(r); if (audio.current) audio.current.playbackRate = r; };
  const onWavePointer = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); if (r.width > 0 && total > 0) seek(((e.clientX - r.left) / r.width) * total); };

  // ---- title ----
  const storedTitle = typeof attrs.title === "string" ? attrs.title : "";
  const [title, setTitle] = React.useState(storedTitle);
  const writtenTitle = React.useRef(storedTitle);
  React.useEffect(() => { if (storedTitle !== writtenTitle.current) { writtenTitle.current = storedTitle; setTitle(storedTitle); } }, [storedTitle]);
  const saveTitle = useDebounced((v: string) => { if (v !== writtenTitle.current) { writtenTitle.current = v; update({ title: v }); } }, 400);

  // ---- transcript / transcription ----
  const lines = React.useMemo(() => transcriptLines(attrs.transcript), [attrs.transcript]);
  const activeLine = playing ? activeLineIndex(lines, time) : -1;
  const status = attrs.transcriptStatus === "pending" || attrs.transcriptStatus === "done" || attrs.transcriptStatus === "failed" ? attrs.transcriptStatus : "none";
  const [unavailable, setUnavailable] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  /** Why the last request was refused or failed (limit, configuration, engine error): shown in the block until the next attempt. */
  const [problem, setProblem] = React.useState<{ message: string; retry: boolean } | null>(null);
  const attrsRef = React.useRef(attrs); attrsRef.current = attrs; const updateRef = React.useRef(update); updateRef.current = update;
  /** Write the server's state into the node — only what differs, so a poll that changes nothing creates no transaction. */
  const applyServer = React.useCallback((v: TranscriptView) => {
    const patch = patchFromServer(attrsRef.current, v); if (patch) updateRef.current(patch);
    if (v.status === "failed") setProblem({ message: v.error || "The transcription engine failed.", retry: true });
    else if (v.status === "done") setProblem(v.error ? { message: v.error, retry: false } : null); // done + error = the summary could not be produced
  }, []);
  const transcribe = async (opts: { summarize?: boolean; force?: boolean } = {}) => {
    if (!editable || asking || !attachmentId) return; setAsking(true); setProblem(null);
    try {
      const r = await api<TranscriptView>(`/api/audio/${encodeURIComponent(attachmentId)}/transcribe`, { method: "POST", json: opts });
      if (!alive.current) return;
      if (r && typeof r === "object" && typeof r.status === "string") applyServer(r); else update({ transcriptStatus: "pending" });
    } catch (e) {
      if (!alive.current) return;
      const p = transcribeProblem(e as ApiError);
      if (p.unavailable) setUnavailable(true); // older server: nothing is changed in the node
      else setProblem({ message: p.message, retry: p.retry });
    } finally { if (alive.current) setAsking(false); }
  };
  /** Ask the server where the job stands; the result is written into the node (the server never edits the page, docs/next/API-NEXT-AI.md §6.2). */
  const check = React.useCallback(async (announce: boolean) => {
    if (!attachmentId) return;
    try {
      const r = await api<TranscriptView>(`/api/audio/${encodeURIComponent(attachmentId)}`);
      if (!alive.current) return; applyServer(r);
      if (announce && r.status === "pending") toast("Transcription still in progress");
    } catch (e) { if (alive.current && announce) { const p = transcribeProblem(e as ApiError); if (p.unavailable) setUnavailable(true); else toast("Could not check the transcription", { description: (e as Error)?.message, tone: "danger" }); } }
  }, [attachmentId, applyServer]);
  // While the node says "pending" the block polls (the request was the user's; reopening the page resumes the wait). Read-only pages never poll: they could not write the result.
  React.useEffect(() => {
    if (status !== "pending" || !editable || !attachmentId || unavailable) return;
    void check(false); const t = setInterval(() => { if (document.visibilityState === "visible") void check(false); }, 2500);
    return () => clearInterval(t);
  }, [status, editable, attachmentId, unavailable, check]);
  const refresh = async () => { if (asking) return; setAsking(true); try { await check(true); } finally { if (alive.current) setAsking(false); } };
  // ---- search hits: words of the result that opened the page (`?hl=`) are marked in the transcript and the first one is brought into view
  const terms = React.useMemo(() => (typeof window === "undefined" ? [] : searchTerms(new URLSearchParams(window.location.search).get("hl"))), []);
  const hits = React.useMemo(() => matchingLines(lines, terms), [lines, terms]);
  const listRef = React.useRef<HTMLOListElement>(null);
  React.useEffect(() => { const list = listRef.current; if (!list || !hits.length) return; const el = list.children[hits[0]] as HTMLElement | undefined; if (el) list.scrollTop = Math.max(0, el.offsetTop - list.offsetTop - 8); }, [hits]);
  // ---- AI summary → page content, only on request, always as an AI block that names its source
  const source = (): VoiceSource => ({ pageId, blockId: (attrs.id as string | null | undefined) ?? null, title: storedTitle || "Voice note" });
  const insertAfter = (block: ReturnType<typeof summaryBlock>, done: string) => {
    if (!block || !editable) return; const pos = getPos(); if (typeof pos !== "number") return;
    const node = editor.state.doc.nodeAt(pos); const at = pos + (node?.nodeSize ?? 1);
    if (editor.chain().insertContentAt(at, block as never).run()) toast(done, { description: "Marked as AI, with this voice note as its source.", tone: "ai" });
  };
  // ---- original audio: kept by default; deleting it is an explicit, confirmed choice and leaves the transcript
  const [confirmDelete, setConfirmDelete] = React.useState(false); const [deleting, setDeleting] = React.useState(false);
  const deleteAudio = async () => {
    if (!attachmentId || deleting) return; setDeleting(true);
    try { audio.current?.pause(); await api(`/api/attachments?id=${encodeURIComponent(attachmentId)}`, { method: "DELETE" }); if (alive.current) { update({ attachmentId: null }); toast("Original audio deleted", { description: "The transcript stays in the page." }); } }
    catch (e) { if (alive.current) toast("The audio could not be deleted", { description: (e as Error)?.message, tone: "danger" }); }
    finally { if (alive.current) { setDeleting(false); setConfirmDelete(false); } }
  };
  const summary = attrs.summary && typeof attrs.summary === "object" ? attrs.summary : null;

  return (
    <div className="au">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the transcript below is the text alternative */}
      {attachmentId && <audio ref={audio} src={fileUrl(attachmentId)} preload={storedDuration > 0 ? "none" : "metadata"} hidden
        onLoadedMetadata={onDuration} onDurationChange={onDuration} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onError={() => { setPlaying(false); setMediaError("The audio file could not be loaded — it may have been deleted or its format is not supported by this browser."); }} />}
      {editable && <input className="nb-field au-title" aria-label="Title" placeholder="Title" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); saveTitle(e.target.value); }} onBlur={() => saveTitle.flush()} />}
      {!attachmentId && <p className="au-note nb-meta" role="note"><FileAudio aria-hidden />The original audio was deleted — the transcript is kept.</p>}
      {attachmentId && <div className="au-player" role="group" aria-label="Audio player">
        <NodeButton label={playing ? "Pause" : "Play"} tone="accent" className="au-play" onClick={toggle}>{playing ? <Pause /> : <Play />}</NodeButton>
        <span className="au-time nb-meta" aria-hidden>{formatTime(time)}</span>
        <input className="au-seek" type="range" aria-label="Seek" min={0} max={total > 0 ? total : 1} step={total > 60 ? 1 : 0.1} value={Math.min(time, total > 0 ? total : 1)} disabled={total <= 0}
          aria-valuetext={`${formatTime(time)} of ${formatTime(total)}`} style={{ "--au-p": `${fraction * 100}%` } as React.CSSProperties} onChange={(e) => seek(Number(e.target.value))} />
        <span className="au-time nb-meta" aria-label="Duration">{formatTime(total)}</span>
        <select className="nb-field au-rate" aria-label="Playback speed" value={rate} onChange={(e) => changeRate(Number(e.target.value))}>
          {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
      </div>}
      {mediaError && <NodeState tone="danger" icon={<FileAudio />} title="Playback problem" hint={mediaError} />}
      {wave === "ready" && <canvas ref={canvas} className="au-wave" aria-hidden onPointerDown={onWavePointer} />}
      {attachmentId && wave === "idle" && !mediaError && total <= MAX_WAVE_SECONDS && <button type="button" className="au-wave-load nb-meta" onMouseDown={(e) => e.preventDefault()} onClick={() => void loadWave()}><AudioLines aria-hidden />Show waveform</button>}
      {wave === "loading" && <div className="au-wave-load nb-meta" role="status"><AudioLines aria-hidden />Loading waveform…</div>}

      {hits.length > 0 && <p className="au-note nb-meta" role="status" data-testid="au-hits"><Captions aria-hidden />{hits.length} transcript line{hits.length > 1 ? "s" : ""} match{hits.length > 1 ? "" : "es"} your search</p>}
      {lines.length > 0 && (
        <ol ref={listRef} className="au-transcript" aria-label="Transcript">
          {lines.map((l, i) => (
            <li key={`${l.t}-${i}`}>
              <button type="button" className={cn("au-line", i === activeLine && "is-active", hits.includes(i) && "is-hit")} aria-current={i === activeLine ? "true" : undefined} data-hit={hits.includes(i) ? "true" : undefined} disabled={!attachmentId} title={attachmentId ? `Play from ${formatTime(l.t)}` : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => { seek(l.t); play(); }}>
                <span className="au-stamp">{transcriptStamp(l.t)}</span><span className="au-line-text">{l.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {attachmentId && (editable || status === "done" || status === "pending" || status === "failed") && (
        <div className="au-tr nb-meta" data-status={status}>
          <Captions aria-hidden />
          {unavailable ? <span role="status">Transcription is not available on this server yet</span>
            : status === "none" ? (editable && <><NodeButton label="Transcribe" text disabled={asking} onClick={() => void transcribe()} /><NodeButton label="Transcript + AI summary" tone="ai" text disabled={asking} onClick={() => void transcribe({ summarize: true })}><Sparkles /></NodeButton><span className="au-hint">Sends the recording to the transcription engine (25 MB max).</span></>)
            : status === "pending" ? <><span role="status" className="au-pending"><span className="au-spin" aria-hidden />Transcription in progress…</span>{editable && <NodeButton label="Refresh" text disabled={asking} onClick={() => void refresh()}><RotateCw /></NodeButton>}</>
            : status === "failed" ? <><span role="status" className="au-failed">Transcription failed</span>{editable && <NodeButton label="Retry transcription" text disabled={asking} onClick={() => void transcribe({ force: true })}><RotateCw /></NodeButton>}</>
            : <><span>Transcribed{attrs.transcriptEngine ? ` with ${attrs.transcriptEngine}` : ""}{lines.length === 0 ? " — no speech detected" : ""}</span>{editable && !summary && lines.length > 0 && <NodeButton label="Summarise" tone="ai" text disabled={asking} onClick={() => void transcribe({ summarize: true })}><Sparkles /></NodeButton>}</>}
        </div>
      )}
      {problem && !unavailable && <p className="au-problem" role="alert">{problem.message}</p>}
      {attachmentId && editable && status === "done" && (
        <div className="au-keep nb-meta" role="group" aria-label="Original audio">
          <FileAudio aria-hidden />
          {confirmDelete ? <><span>Delete the audio file? The transcript and the summary stay.</span><NodeButton label="Delete audio" tone="danger" text disabled={deleting} onClick={() => void deleteAudio()}><Trash2 /></NodeButton><NodeButton label="Keep audio" text disabled={deleting} onClick={() => setConfirmDelete(false)} /></>
            : <><span>The original audio is kept.</span><NodeButton label="Delete original audio…" text onClick={() => setConfirmDelete(true)}><Trash2 /></NodeButton></>}
        </div>
      )}
      {summary && <SummaryBox summary={summary} onInsertSummary={editable ? () => insertAfter(summaryBlock(summary, source()), "Summary inserted below") : undefined} onInsertTasks={editable ? () => insertAfter(tasksBlock(summary, source()), "Tasks inserted below") : undefined} />}
    </div>
  );
}

/** AI-made summary: displayed as stored, always labelled, never generated or edited by this component (SPEC §0 rule 10). */
function SummaryBox({ summary, onInsertSummary, onInsertTasks }: { summary: AudioSummary; /** undefined in read-only pages */ onInsertSummary?: () => void; onInsertTasks?: () => void }) {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
  const decisions = list(summary.decisions), tasks = list(summary.tasks);
  const at = typeof summary.at === "string" ? new Date(summary.at) : null; const when = at && !Number.isNaN(at.getTime()) ? at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
  return (
    <section className="au-summary" aria-label="AI summary">
      <header className="au-summary-head"><span className="au-ai-mark"><Sparkles aria-hidden />AI summary</span><span className="nb-meta">{[typeof summary.model === "string" ? summary.model : "", when].filter(Boolean).join(" · ")}</span></header>
      {typeof summary.text === "string" && summary.text && <p className="au-summary-text">{summary.text}</p>}
      {decisions.length > 0 && <><h4 className="au-summary-h">Decisions</h4><ul className="au-summary-list">{decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
      {tasks.length > 0 && <><h4 className="au-summary-h">Tasks</h4><ul className="au-summary-list">{tasks.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
      {(onInsertSummary || onInsertTasks) && <div className="au-summary-actions">
        {onInsertSummary && typeof summary.text === "string" && summary.text.trim() !== "" && <NodeButton label="Insert summary" tone="ai" text onClick={onInsertSummary}><ListPlus /></NodeButton>}
        {onInsertTasks && tasks.length > 0 && <NodeButton label="Insert as tasks" tone="ai" text onClick={onInsertTasks}><ListTodo /></NodeButton>}
      </div>}
    </section>
  );
}
