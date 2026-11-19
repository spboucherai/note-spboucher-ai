/**
 * OPT-IN live checks against the real providers (costs a fraction of a cent; never part of a normal `pnpm test`):
 *   AI_LIVE=1 node_modules/.bin/tsx --test --test-force-exit tests/unit/ai-live.test.ts
 *  1. one real end-to-end transcription: speech synthesized on the node (`say` + `afconvert`), stored as an attachment, queued, run by
 *     the job handler with the discovered OpenAI transcription model, read back — the words and the segment timestamps are asserted;
 *  2. the strict-JSON paths on a cheap model (claude-haiku-5-5): Smart Inbox suggestions and a `classify` database property.
 * What is asserted is what was actually returned; the measured numbers are printed, and the spend is read from `ai_usage`.
 */
import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, gte, inArray, sql as dsql } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { storeFile } from "../../src/lib/files/storage";
import { createPage } from "../../src/lib/pages/service";
import { capture } from "../../src/lib/inbox/service";
import { ensureDatabase, createProperty, createRow } from "../../src/lib/databases/service";
import { requestTranscription, getTranscript, listTranscriptionModels, pickTranscriptionModel, timestampSupport } from "../../src/lib/ai/transcribe";
import { handleTranscribe } from "../../src/worker/handlers/transcribe";
import { suggest } from "../../src/lib/ai/inbox";
import { setAiConfig, queueAiProperty, listRuns } from "../../src/lib/ai/properties";
import { handleAiProperty } from "../../src/worker/handlers/ai-property";

const LIVE = process.env.AI_LIVE === "1"; const opts = { skip: LIVE ? false : "set AI_LIVE=1 to call the real providers" };
const TAG = `live${Date.now().toString(36)}`; const t0 = new Date(); let ws = ""; const made: string[] = []; const atts: string[] = []; const rows: string[] = [];
before(async () => { if (!LIVE) return; const [w] = await db.select().from(schema.workspaces).limit(1); assert.ok(w); ws = w.id; });
after(async () => {
  if (LIVE) {
    const use = await db.select({ task: schema.aiUsage.task, model: schema.aiUsage.model, n: dsql<number>`count(*)::int`, cost: dsql<number>`coalesce(sum(cost_usd),0)::float8`, unpriced: dsql<number>`count(*) filter (where cost_usd is null)::int` }).from(schema.aiUsage).where(gte(schema.aiUsage.createdAt, t0)).groupBy(schema.aiUsage.task, schema.aiUsage.model);
    console.log("# ai_usage of this run:", JSON.stringify(use), "total USD (priced calls):", use.reduce((a, u) => a + Number(u.cost), 0).toFixed(6));
    if (atts.length) { await sql`delete from pgboss.job where name = 'transcribe' and data->>'attachmentId' in ${sql(atts)}`.catch(() => {}); await db.delete(schema.attachments).where(inArray(schema.attachments.id, atts)); }
    if (rows.length) await sql`delete from pgboss.job where name = 'ai-property' and data->>'rowId' in ${sql(rows)}`.catch(() => {});
    if (made.length) { await db.delete(schema.pages).where(inArray(schema.pages.parentId, made)); await db.delete(schema.pages).where(inArray(schema.pages.id, made)); }
  }
  await sql.end();
});

test("LIVE transcription: synthesized speech → attachment → job → transcript with segment timestamps, engine and model reported", opts, async () => {
  assert.equal(os.platform(), "darwin", "the audio is synthesized with macOS `say`");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spn-voice-")); const aiff = path.join(dir, "v.aiff"); const m4a = path.join(dir, "v.m4a");
  const said = "The meeting is on Monday morning. We keep the fixed rate for five years. Please send the signed documents to the bank.";
  execFileSync("say", ["-o", aiff, said]); execFileSync("afconvert", ["-f", "m4af", "-d", "aac", aiff, m4a]);
  const buf = fs.readFileSync(m4a); const st = await storeFile(buf, `voice-${TAG}.m4a`);
  const [a] = await db.insert(schema.attachments).values({ workspaceId: ws, filename: `voice-${TAG}.m4a`, mime: "audio/mp4", size: buf.length, sha256: st.sha256, storagePath: st.storagePath }).returning(); atts.push(a.id);
  const exposed = await listTranscriptionModels(true); const chosen = pickTranscriptionModel(exposed);
  console.log("# transcription models exposed by the account:", exposed.join(", "), "→ chosen:", chosen, `(${timestampSupport(chosen ?? "")})`);
  assert.ok(chosen, "the account exposes a transcription model");
  const q = await requestTranscription(ws, a.id); assert.equal(q.queued, true); assert.equal(q.status, "pending");
  const started = Date.now(); await handleTranscribe({ attachmentId: a.id, workspaceId: ws }); const ms = Date.now() - started;
  const t = await getTranscript(ws, a.id);
  console.log("# measured:", JSON.stringify({ bytes: buf.length, ms, status: t.status, engine: t.engine, model: t.model, language: t.language, duration: t.duration, segments: t.transcript.length, transcript: t.transcript, error: t.error }));
  assert.equal(t.status, "done", t.error ?? ""); assert.equal(t.engine, "openai"); assert.equal(t.model, chosen);
  const heard = t.text.toLowerCase(); for (const w of ["monday", "fixed rate", "bank"]) assert.ok(heard.includes(w), `"${w}" was transcribed (got: ${t.text})`);
  assert.ok(t.transcript.length >= 1); assert.ok(t.transcript[0].t >= 0); assert.ok(t.transcript.every((s, i, all) => i === 0 || s.t >= all[i - 1].t), "segment times are non-decreasing");
  if (timestampSupport(chosen!) !== "none") { assert.equal(t.segments, true); assert.ok(t.duration! > 3 && t.duration! < 30, `plausible duration (${t.duration})`); assert.ok(t.transcript.at(-1)!.t < t.duration!); }
  const [u] = await db.select().from(schema.aiUsage).where(and(eq(schema.aiUsage.task, "transcribe"), eq(schema.aiUsage.refId, a.id))); assert.ok(u && u.ok, "the call is in the usage log"); assert.equal(u.model, chosen);
});

test("LIVE strict JSON on claude-haiku-5-5: Smart Inbox suggestions validate; a classify property returns one of its choices", opts, async () => {
  const proj = await createPage(ws, { title: `Rénovation cuisine ${TAG}`, section: "projects", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Budget, soumissions et échéancier de la rénovation de la cuisine." }] }] } }); made.push(proj.id);
  const cap = await capture(ws, { kind: "note", text: `soumission plombier ${TAG}\nLe plombier propose 4 200 $ pour déplacer l'évier ; réponse attendue avant le 5 décembre.` }); made.push(cap.id);
  const r = await suggest(ws, cap.id, { model: "claude-haiku-5-5" });
  console.log("# inbox suggestions:", JSON.stringify({ model: r.model, costUsd: r.costUsd, suggestions: r.suggestions }));
  assert.equal(r.status, "ready"); assert.equal(r.ai, true); assert.equal(r.model, "claude-haiku-5-5"); assert.ok(typeof r.suggestions.summary === "string" && r.suggestions.summary.length > 10);
  assert.ok(r.suggestions.tags.every((t) => t.name === t.name.toLowerCase() && typeof t.existing === "boolean"));
  for (const rel of r.suggestions.relations) assert.equal((await db.select().from(schema.pages).where(eq(schema.pages.id, rel.pageId))).length, 1, "a suggested relation is a real page");
  if (r.suggestions.destination?.parentId) assert.equal((await db.select().from(schema.pages).where(eq(schema.pages.id, r.suggestions.destination.parentId))).length, 1, "a suggested destination is a real page");
  const host = await createPage(ws, { title: `Base live ${TAG}`, type: "database", section: "databases" }); made.push(host.id); const d = await ensureDatabase(ws, host.id);
  const prop = await createProperty(ws, d.id, { name: "Urgence", type: "ai" }); const note = await createProperty(ws, d.id, { name: "Note", type: "text" });
  await setAiConfig(ws, d.id, prop.id, { task: "classify", choices: ["Urgent", "Peut attendre"], model: "claude-haiku-5-5" });
  const row = await createRow(ws, d.id, { title: "Fuite d'eau sous l'évier", values: { [note.id]: "L'eau coule sur le plancher depuis ce matin." } }); rows.push(row.id);
  const q = await queueAiProperty(ws, d.id, row.id, prop.id); await handleAiProperty({ rowId: row.id, propertyId: prop.id, workspaceId: ws, runId: q.runId });
  const [run] = await listRuns(ws, d.id, { rowId: row.id }); const value = (await db.select({ v: schema.databaseRows.values }).from(schema.databaseRows).where(eq(schema.databaseRows.id, row.id)))[0].v[prop.id];
  console.log("# classify:", JSON.stringify({ value, status: run.status, model: run.model, inputTokens: run.inputTokens, outputTokens: run.outputTokens, costUsd: run.costUsd, error: run.error }));
  assert.equal(run.status, "done", run.error ?? ""); assert.ok(["Urgent", "Peut attendre"].includes(value as string), `one of the choices (got ${JSON.stringify(value)})`); assert.equal(run.model, "claude-haiku-5-5");
});
