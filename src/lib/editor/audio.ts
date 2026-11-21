/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/editor/audio.ts
 * Description      : pure helpers of the `audio` block (voice note, SPEC §2):
 *                    time formatting, transcript stamps (`[mm:ss]`, the same as
 *                    the Markdown export), waveform peaks, the transcript line
 *                    being spoken, and the choice of a recording container. No
 *                    browser API here.
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

import type { TranscriptLine } from "./next-node-defs";

const whole = (seconds: unknown) => { const n = Number(seconds); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
const two = (n: number) => String(n).padStart(2, "0");

/** `m:ss`, or `h:mm:ss` from one hour. Negative, NaN and Infinity read as 0:00. */
export function formatTime(seconds: number): string {
  const s = whole(seconds); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}
/** `[mm:ss]` — minutes are not folded into hours (a line at 1 h 02 min 03 s is `[62:03]`), as in the text export. */
export function transcriptStamp(seconds: number): string {
  const s = whole(seconds);
  return `[${two(Math.floor(s / 60))}:${two(s % 60)}]`;
}
/**
 * Waveform envelope: `buckets` values in 0..1, each the largest absolute sample of its slice, normalised by the loudest slice.
 * Silence or an empty input gives zeros; `buckets` ≤ 0 gives []. When there are fewer samples than buckets, the nearest sample is used.
 */
export function computePeaks(samples: Float32Array | number[], buckets: number): number[] {
  const n = Number.isFinite(buckets) ? Math.floor(buckets) : 0;
  if (n <= 0) return [];
  const len = samples?.length ?? 0; const peaks = new Array<number>(n).fill(0);
  if (len === 0) return peaks;
  let top = 0;
  for (let b = 0; b < n; b++) {
    const start = Math.floor((b * len) / n); const end = Math.max(start + 1, Math.floor(((b + 1) * len) / n));
    let max = 0;
    for (let i = start; i < end && i < len; i++) { const v = Math.abs(samples[i]); if (v > max) max = v; }
    if (!Number.isFinite(max)) max = 0;
    peaks[b] = max; if (max > top) top = max;
  }
  if (top <= 0) return peaks;
  for (let b = 0; b < n; b++) peaks[b] = Math.min(1, peaks[b] / top);
  return peaks;
}
/** Only well-formed lines (`{t: seconds ≥ 0, text}`), in the stored order. */
export const transcriptLines = (transcript: unknown): TranscriptLine[] => (Array.isArray(transcript) ? (transcript.filter((l) => l && typeof l === "object" && Number.isFinite((l as TranscriptLine).t) && typeof (l as TranscriptLine).text === "string") as TranscriptLine[]) : []);
/** Index of the line being spoken at time `t`: the one with the latest start ≤ t (first of equals), or -1 before the first line. */
export function activeLineIndex(transcript: readonly TranscriptLine[], t: number): number {
  if (!Array.isArray(transcript) || !Number.isFinite(t)) return -1;
  let best = -1; let bestT = -Infinity;
  for (let i = 0; i < transcript.length; i++) { const lt = Number(transcript[i]?.t); if (Number.isFinite(lt) && lt <= t && lt > bestT) { best = i; bestT = lt; } }
  return best;
}
export interface RecordingFormat { /** value for MediaRecorder's `mimeType` ("" = let the browser choose) */ mime: string; /** file extension without the dot */ ext: string }
const RECORDING_FORMATS: RecordingFormat[] = [
  { mime: "audio/mp4", ext: "m4a" }, { mime: "audio/webm;codecs=opus", ext: "webm" }, { mime: "audio/webm", ext: "webm" }, { mime: "audio/ogg;codecs=opus", ext: "ogg" },
];
/** First container the browser can record: audio/mp4 (.m4a, plays everywhere incl. the native apps), then WebM/Opus, WebM, Ogg/Opus. */
export function pickRecordingMime(isSupported: (mime: string) => boolean): RecordingFormat {
  for (const f of RECORDING_FORMATS) { try { if (isSupported(f.mime)) return { ...f }; } catch { /* a throwing probe means "no" */ } }
  return { mime: "", ext: "webm" };
}
/** Extension for a recorded blob whose real type is known afterwards (the recorder may not honour the request). */
export function extensionForMime(mime: string, fallback = "webm"): string {
  const base = String(mime ?? "").split(";")[0].trim().toLowerCase();
  return base === "audio/mp4" || base === "audio/x-m4a" || base === "audio/aac" ? "m4a" : base === "audio/webm" ? "webm" : base === "audio/ogg" ? "ogg" : base === "audio/mpeg" ? "mp3" : base === "audio/wav" || base === "audio/x-wav" ? "wav" : fallback;
}
