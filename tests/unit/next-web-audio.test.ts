/**
 * file: tests/unit/next-web-audio.test.ts
 * description: pure helpers of the audio block (src/lib/editor/audio.ts): time formatting, transcript stamps, waveform peaks, the
 *   active transcript line and the choice of a recording container.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeLineIndex, computePeaks, extensionForMime, formatTime, pickRecordingMime, transcriptLines, transcriptStamp } from "../../src/lib/editor/audio";

test("formatTime: m:ss under an hour, h:mm:ss from an hour", () => {
  assert.equal(formatTime(0), "0:00"); assert.equal(formatTime(5), "0:05"); assert.equal(formatTime(59.9), "0:59"); assert.equal(formatTime(60), "1:00"); assert.equal(formatTime(75.4), "1:15");
  assert.equal(formatTime(600), "10:00"); assert.equal(formatTime(3599), "59:59"); assert.equal(formatTime(3600), "1:00:00"); assert.equal(formatTime(3661), "1:01:01"); assert.equal(formatTime(36000 + 62), "10:01:02");
  for (const bad of [-3, NaN, Infinity, -Infinity, undefined as any, null as any, "x" as any]) assert.equal(formatTime(bad), "0:00");
  assert.equal(formatTime("90" as any), "1:30");
});
test("transcriptStamp: [mm:ss], minutes never folded into hours", () => {
  assert.equal(transcriptStamp(0), "[00:00]"); assert.equal(transcriptStamp(7.9), "[00:07]"); assert.equal(transcriptStamp(65), "[01:05]"); assert.equal(transcriptStamp(600), "[10:00]");
  assert.equal(transcriptStamp(3723), "[62:03]"); assert.equal(transcriptStamp(6000), "[100:00]"); assert.equal(transcriptStamp(-1), "[00:00]"); assert.equal(transcriptStamp(NaN), "[00:00]");
});
test("computePeaks: one max-abs value per bucket, normalised to the loudest", () => {
  assert.deepEqual(computePeaks([0.1, -0.5, 0.2, 0.25, -1, 0.3, 0, 0], 4), [0.5, 0.25, 1, 0]);
  assert.deepEqual(computePeaks(new Float32Array([0.5, -0.25, 0.125, 0]), 2), [1, 0.25]);
  assert.deepEqual(computePeaks([0.2, 0.2, 0.2, 0.2], 2), [1, 1], "normalised: a quiet but even recording fills the height");
  assert.deepEqual(computePeaks([-2, 1], 2), [1, 0.5], "out-of-range samples still normalise to 1");
  const samples = new Float32Array(48000); for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 50) * (i / samples.length);
  const peaks = computePeaks(samples, 120); assert.equal(peaks.length, 120); assert.equal(Math.max(...peaks), 1); assert.ok(peaks.every((p) => p >= 0 && p <= 1)); assert.ok(peaks[119] > peaks[10], "the envelope follows the signal");
  assert.equal(computePeaks(samples, 7).length, 7); assert.equal(computePeaks(samples, 1).length, 1); assert.deepEqual(computePeaks(samples, 1), [1]);
});
test("computePeaks: empty, silent, short and degenerate inputs", () => {
  assert.deepEqual(computePeaks([], 4), [0, 0, 0, 0]); assert.deepEqual(computePeaks(new Float32Array(0), 3), [0, 0, 0]); assert.deepEqual(computePeaks([0, 0, 0, 0], 2), [0, 0], "silence does not divide by zero");
  assert.deepEqual(computePeaks([1, 2, 3], 0), []); assert.deepEqual(computePeaks([1, 2, 3], -2), []); assert.deepEqual(computePeaks([1, 2, 3], NaN), []); assert.equal(computePeaks([1, 2, 3], 2.9).length, 2);
  assert.deepEqual(computePeaks([0.5, 1], 4), [0.5, 0.5, 1, 1], "fewer samples than buckets: nearest sample");
  assert.deepEqual(computePeaks([NaN, 0.5, 1, NaN], 2), [0.5, 1]); assert.deepEqual(computePeaks(null as any, 2), [0, 0]);
  const input = Object.freeze([0.3, -0.6]); assert.deepEqual(computePeaks(input as any, 2), [0.5, 1]);
});
test("activeLineIndex: the line with the latest start ≤ t", () => {
  const lines = [{ t: 0, text: "a" }, { t: 4.5, text: "b" }, { t: 10, text: "c" }];
  assert.equal(activeLineIndex(lines, 0), 0); assert.equal(activeLineIndex(lines, 4.49), 0); assert.equal(activeLineIndex(lines, 4.5), 1); assert.equal(activeLineIndex(lines, 9.99), 1); assert.equal(activeLineIndex(lines, 10), 2); assert.equal(activeLineIndex(lines, 9999), 2);
  assert.equal(activeLineIndex([{ t: 3, text: "late start" }], 1), -1); assert.equal(activeLineIndex([], 5), -1); assert.equal(activeLineIndex(lines, NaN), -1); assert.equal(activeLineIndex(null as any, 1), -1);
  assert.equal(activeLineIndex([{ t: 10, text: "c" }, { t: 0, text: "a" }, { t: 4.5, text: "b" }], 5), 2, "unsorted transcripts still resolve");
  assert.equal(activeLineIndex([{ t: 2, text: "x" }, { t: 2, text: "y" }], 2), 0, "first of equal stamps");
  assert.equal(activeLineIndex([{ t: 0, text: "a" }, { t: "x" as any, text: "bad" }, null as any, { t: 3, text: "b" }], 4), 3);
  assert.deepEqual(transcriptLines([{ t: 0, text: "a" }, { t: "1", text: "b" }, null, { text: "c" }, { t: 2, text: "d", speaker: "S1" }]), [{ t: 0, text: "a" }, { t: 2, text: "d", speaker: "S1" }]); assert.deepEqual(transcriptLines(undefined), []);
});
test("pickRecordingMime: audio/mp4 first, then WebM/Opus, then WebM", () => {
  assert.deepEqual(pickRecordingMime(() => true), { mime: "audio/mp4", ext: "m4a" });
  assert.deepEqual(pickRecordingMime((m) => m.startsWith("audio/webm")), { mime: "audio/webm;codecs=opus", ext: "webm" });
  assert.deepEqual(pickRecordingMime((m) => m === "audio/webm"), { mime: "audio/webm", ext: "webm" });
  assert.deepEqual(pickRecordingMime((m) => m.startsWith("audio/ogg")), { mime: "audio/ogg;codecs=opus", ext: "ogg" });
  assert.deepEqual(pickRecordingMime(() => false), { mime: "", ext: "webm" }, "nothing declared: the browser default is used");
  assert.deepEqual(pickRecordingMime(() => { throw new Error("probe failed"); }), { mime: "", ext: "webm" });
  const asked: string[] = []; pickRecordingMime((m) => { asked.push(m); return false; }); assert.deepEqual(asked.slice(0, 3), ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]);
  const first = pickRecordingMime(() => true); first.ext = "changed"; assert.equal(pickRecordingMime(() => true).ext, "m4a", "the result is a copy");
  assert.equal(extensionForMime("audio/mp4;codecs=mp4a.40.2"), "m4a"); assert.equal(extensionForMime("audio/webm;codecs=opus"), "webm"); assert.equal(extensionForMime("audio/ogg"), "ogg"); assert.equal(extensionForMime("", "m4a"), "m4a"); assert.equal(extensionForMime("audio/flac"), "webm");
});
