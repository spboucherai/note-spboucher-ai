/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-p-cv-voice.test.ts
 * Description      : voice-note flows (SPEC §2 `audio`, §4.13). Pure logic:
 *                    what a server state writes into the node, the wording of
 *                    limits and failures, the AI blocks made from a summary,
 *                    transcript lines matching a search, the pause-aware clock.
 *                    Then the whole path on the scratch database with the
 *                    INJECTED transcription engine (no provider, no cost):
 *                    request → job → transcript → node patch → saved page →
 *                    indexed → found by a keyword search at the audio block.
 * Module           : tests
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

import "../helpers/testdb";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { capture } from "../../src/lib/inbox/service";
import { getPage, updatePage } from "../../src/lib/pages/service";
import { storeFile } from "../../src/lib/files/storage";
import { indexSource, removeSource, hybridSearch } from "../../src/lib/search/index";
import { requestTranscription, runTranscription, getTranscript, toEngineResult, TRANSCRIBE_MAX_BYTES as SERVER_MAX, type Transcriber } from "../../src/lib/ai/transcribe";
import type { PMNode } from "../../src/lib/editor/text";
import type { AudioAttrs, AudioSummary } from "../../src/lib/editor/next-node-defs";
import { clockSeconds, engineLabel, matchingLines, patchFromServer, pauseClock, resumeClock, searchTerms, startClock, summaryBlock, tasksBlock, transcribeProblem, TRANSCRIBE_MAX_BYTES, type TranscriptView } from "../../src/lib/editor/voice";

const TAG = `pcvv${Date.now().toString(36)}`; const made: string[] = []; const atts: string[] = [];
const NONE: Pick<AudioAttrs, "transcript" | "transcriptStatus" | "transcriptEngine" | "summary"> = { transcript: [], transcriptStatus: "none", transcriptEngine: null, summary: null };
const view = (o: Partial<TranscriptView>): TranscriptView => ({ attachmentId: "a", status: "none", transcript: [], text: "", engine: null, model: null, language: null, duration: null, segments: null, summary: null, error: null, ...o });
const SUM: AudioSummary = { text: "Le taux fixe est retenu.", decisions: ["Retenir le taux fixe"], tasks: ["Marie : envoyer le contrat lundi", "  ", "Appeler le notaire"], model: "gpt-test", at: "2026-11-19T10:00:00.000Z" };
const find = (n: PMNode | undefined, type: string): PMNode[] => [...(n?.type === type ? [n] : []), ...((n?.content ?? []) as PMNode[]).flatMap((c) => find(c, type))];
after(async () => {
  if (atts.length) { await sql`delete from pgboss.job where name = 'transcribe' and data->>'attachmentId' in ${sql(atts)}`.catch(() => {}); await db.delete(schema.aiUsage).where(inArray(schema.aiUsage.refId, atts)); await db.delete(schema.audioTranscripts).where(inArray(schema.audioTranscripts.attachmentId, atts)); }
  for (const id of made) await removeSource("page", id);
  if (made.length) { await db.delete(schema.attachments).where(inArray(schema.attachments.pageId, made)); await db.delete(schema.knowledgeEvents).where(inArray(schema.knowledgeEvents.pageId, made)); await db.delete(schema.pages).where(inArray(schema.pages.id, made)); await db.delete(schema.syncTombstones).where(inArray(schema.syncTombstones.id, made)); }
  if (atts.length) await db.delete(schema.attachments).where(inArray(schema.attachments.id, atts));
  await sql.end();
});

test("node patch: done copies transcript, engine and summary once; an unchanged state writes nothing", () => {
  const done = view({ status: "done", transcript: [{ t: 0, text: "Bonjour." }, { t: 4.4, text: "Au revoir." }], engine: "openai", model: "whisper-1", summary: SUM });
  const patch = patchFromServer({ ...NONE, transcriptStatus: "pending" }, done)!;
  assert.deepEqual(patch, { transcript: [{ t: 0, text: "Bonjour." }, { t: 4.4, text: "Au revoir." }], transcriptStatus: "done", transcriptEngine: "openai:whisper-1", summary: SUM });
  assert.equal(patchFromServer({ ...NONE, ...patch } as typeof NONE, done), null, "polling a finished transcript again creates no transaction");
  assert.deepEqual(patchFromServer({ ...NONE, ...patch } as typeof NONE, { ...done, summary: null }), null, "a summary already in the node is not erased by a state without one");
  assert.deepEqual(patchFromServer({ ...NONE, transcript: patch.transcript!, transcriptStatus: "done", transcriptEngine: "openai:whisper-1" }, done), { summary: SUM }, "summary produced later: only the summary is written");
  assert.deepEqual(patchFromServer(NONE, view({ status: "done", transcript: [{ t: NaN, text: "x" } as any, { t: 1, text: "ok" }], model: "m" })), { transcript: [{ t: 1, text: "ok" }], transcriptStatus: "done", transcriptEngine: "m" }, "malformed segments are dropped");
  assert.equal(engineLabel("openai", "whisper-1"), "openai:whisper-1"); assert.equal(engineLabel(null, null), null);
});
test("node patch: failed marks the failure and keeps an earlier transcript; pending/none keep the node in step with the server", () => {
  assert.deepEqual(patchFromServer({ ...NONE, transcriptStatus: "pending" }, view({ status: "failed", error: "boom" })), { transcriptStatus: "failed" });
  assert.equal(patchFromServer({ ...NONE, transcriptStatus: "failed" }, view({ status: "failed" })), null);
  assert.deepEqual(patchFromServer({ ...NONE, transcript: [{ t: 0, text: "kept" }], transcriptStatus: "pending" }, view({ status: "failed" })), { transcriptStatus: "failed" }, "the patch never touches the transcript on failure");
  assert.deepEqual(patchFromServer(NONE, view({ status: "pending" })), { transcriptStatus: "pending" }); assert.equal(patchFromServer({ ...NONE, transcriptStatus: "pending" }, view({ status: "pending" })), null);
  assert.deepEqual(patchFromServer({ ...NONE, transcriptStatus: "pending" }, view({ status: "none" })), { transcriptStatus: "none" }, "the server never heard of it: back to none"); assert.equal(patchFromServer(NONE, view({ status: "none" })), null);
  assert.equal(patchFromServer({ ...NONE, transcript: [{ t: 0, text: "x" }], transcriptStatus: "done" }, view({ status: "none" })), null, "a transcript written by another client is left alone");
});
test("limits and failures are explained: 25 MB, not audio, not configured, queue, missing file, older server", () => {
  assert.equal(TRANSCRIBE_MAX_BYTES, SERVER_MAX, "the client limit is the server's");
  assert.match(transcribeProblem({ status: 413, code: "too_large" }).message, /larger than 25 MB/); assert.equal(transcribeProblem({ status: 413, code: "too_large" }).retry, false);
  assert.match(transcribeProblem({ status: 415, code: "not_audio" }).message, /not an audio recording/); assert.match(transcribeProblem({ status: 503, code: "not_configured" }).message, /not configured/);
  assert.equal(transcribeProblem({ status: 503, code: "queue_unavailable" }).retry, true); assert.match(transcribeProblem({ status: 404, message: "Attachment not found" }).message, /no longer exists/);
  assert.equal(transcribeProblem({ status: 404, message: "HTTP 404" }).unavailable, true); assert.equal(transcribeProblem({ status: 405 }).unavailable, true); assert.equal(transcribeProblem({ status: 0 }).retry, true);
  assert.match(transcribeProblem({ status: 500, message: "boom" }).message, /boom/);
});
test("AI output → page content: always an aiBlock with action and source; tasks are unchecked taskItems", () => {
  const src = { pageId: "33333333-3333-4333-8333-333333333333", blockId: "blkAudio1", title: "Réunion" }; const at = new Date("2026-11-19T12:00:00Z");
  const s = summaryBlock(SUM, src, at)!;
  assert.equal(s.type, "aiBlock"); assert.deepEqual(s.attrs, { model: "gpt-test", prompt: "Summary of the voice note", at: "2026-11-19T12:00:00.000Z", action: "summary", sources: [{ pageId: src.pageId, blockId: "blkAudio1", title: "Réunion" }] });
  assert.equal(s.content![0].content![0].text, "Le taux fixe est retenu."); assert.equal(find(s, "listItem").length, 1);
  const t = tasksBlock(SUM, src, at)!; assert.equal(t.type, "aiBlock"); assert.equal(t.attrs!.action, "tasks"); const items = find(t, "taskItem");
  assert.deepEqual(items.map((i) => [i.attrs!.checked, i.content![0].content![0].text]), [[false, "Marie : envoyer le contrat lundi"], [false, "Appeler le notaire"]], "blank tasks are dropped");
  assert.equal(tasksBlock({ ...SUM, tasks: [] }, src), null); assert.equal(summaryBlock({ ...SUM, text: " " }, src), null); assert.equal(summaryBlock(null, src), null);
  assert.equal(summaryBlock(SUM, { pageId: null, blockId: null, title: "" })!.attrs!.sources, null, "no page → no source chip, still an AI block");
});
test("search words are matched in the transcript without accents or case; the recording clock ignores pauses", () => {
  const lines = [{ t: 0, text: "Réunion du 19 novembre." }, { t: 4, text: "Nous retenons le taux fixe." }, { t: 9, text: "Marie envoie les documents." }];
  assert.deepEqual(searchTerms("Reunion  le TAUX fixe"), ["reunion", "taux", "fixe"]); assert.deepEqual(searchTerms(null), []);
  assert.deepEqual(matchingLines(lines, searchTerms("reunion taux")), [0, 1]); assert.deepEqual(matchingLines(lines, searchTerms("DOCUMENTS")), [2]); assert.deepEqual(matchingLines(lines, []), []); assert.deepEqual(matchingLines(lines, searchTerms("absent")), []);
  let c = startClock(1000); assert.equal(clockSeconds(c, 3000), 2);
  c = pauseClock(c, 3000); assert.equal(clockSeconds(c, 9000), 2, "time does not run while paused"); assert.equal(pauseClock(c, 5000), c, "pausing twice changes nothing");
  c = resumeClock(c, 9000); assert.equal(clockSeconds(c, 10_500), 3.5); assert.equal(resumeClock(c, 11_000), c); c = pauseClock(c, 11_000); c = resumeClock(c, 12_000); assert.equal(clockSeconds(c, 13_000), 5);
});

test("whole path with the injected engine: voice capture → transcript → node → saved page → search finds the words at the audio block", async () => {
  const [w] = await db.select().from(schema.workspaces).limit(1); assert.ok(w); const ws = w.id; const word = `zythum${TAG}`;
  const buf = Buffer.from(`fake audio ${TAG}`); const st = await storeFile(buf, `voice-memo-${TAG}.webm`);
  const [a] = await db.insert(schema.attachments).values({ workspaceId: ws, filename: `voice-memo-${TAG}.webm`, mime: "audio/webm", size: buf.length, sha256: st.sha256, storagePath: st.storagePath }).returning(); atts.push(a.id);
  const cap = await capture(ws, { kind: "audio", attachmentIds: [a.id] }); made.push(cap.id);
  const node = find(cap.content as unknown as PMNode, "audio")[0]; assert.equal(node.attrs!.attachmentId, a.id); const blockId = node.attrs!.id as string; assert.ok(blockId);
  const had = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "sk-test-not-a-real-key"; // makes the provider "configured"; the engine below is injected, nothing leaves this process
  try {
    const q = await requestTranscription(ws, a.id); assert.equal(q.queued, true); assert.deepEqual(patchFromServer(node.attrs as any, q as unknown as TranscriptView), { transcriptStatus: "pending" });
    let calls = 0; const engine: Transcriber = async (_f, model) => { calls++; return toEngineResult({ text: `Nous parlons du ${word}. La décision est prise.`, language: "french", duration: 5, segments: [{ start: 0, end: 2.5, text: `Nous parlons du ${word}.` }, { start: 2.5, end: 5, text: "La décision est prise." }] }, model); };
    await runTranscription({ attachmentId: a.id }, { transcriber: engine, model: "whisper-1" }); assert.equal(calls, 1);
  } finally { if (had === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = had; }
  const v = (await getTranscript(ws, a.id)) as unknown as TranscriptView; assert.equal(v.status, "done");
  const patch = patchFromServer({ ...(node.attrs as any), transcriptStatus: "pending" }, v)!; assert.equal(patch.transcriptStatus, "done"); assert.equal(patch.transcriptEngine, "openai:whisper-1"); assert.equal(patch.transcript!.length, 2);
  // what the editor does: write the patch into the node and save the page normally
  const doc = cap.content as unknown as PMNode; const next: PMNode = { ...doc, content: doc.content!.map((n) => (n.type === "audio" ? { ...n, attrs: { ...n.attrs, ...patch } } : n)) };
  const saved = await updatePage(ws, cap.id, { content: next }, { baseVersion: cap.version }); assert.equal(saved.version, cap.version + 1); assert.match((await getPage(ws, cap.id)).plainText ?? "", new RegExp(word));
  await indexSource(ws, "page", cap.id, saved.title, { doc: saved.content }, cap.id).catch(() => {});
  const hits = await hybridSearch(ws, word, { semantic: false, limit: 5 }); const hit = hits.find((h) => h.pageId === cap.id);
  assert.ok(hit, "the transcript is found by a keyword search"); assert.equal(hit!.blockId, blockId, "the result opens at the audio block"); assert.match(hit!.content, /^Audio: /);
  assert.deepEqual(matchingLines(patch.transcript!, searchTerms(word)), [0], "and the block marks the matching line");
});
