/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/ai-features.test.ts
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

/**
 * NEXT-AI features on the service layer: semantic zoom level 1 (cached AI synopsis), Smart Inbox (validated suggestions, journaled apply,
 * undo), voice transcription (engine choice, job path, summary) and smart database properties (config, run log, hand-edit protection,
 * auto-run). Hermetic: real provider keys are removed from this process; the model is a local fake OpenAI-compatible server and the
 * transcription engine is injected. The one real transcription lives in ai-live.test.ts (opt-in).
 */
import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { startFakeLLM, registerFakeProvider, type FakeLLM } from "../helpers/fake-llm";
import { createPage, getPage, updatePage } from "../../src/lib/pages/service";
import { capture, triage, pageTags, setPageTags } from "../../src/lib/inbox/service";
import { indexSource, removeSource } from "../../src/lib/search/index";
import { storeFile } from "../../src/lib/files/storage";
import { ensureDatabase, createProperty, createRow, updateRow, getDatabase, queryRows } from "../../src/lib/databases/service";
import type { PMNode } from "../../src/lib/editor/text";
import { aiSynopsis, synopsisHash } from "../../src/lib/ai/zoom";
import { suggest, applySuggestions, undoInboxAction, validateSuggestion, type Candidate } from "../../src/lib/ai/inbox";
import { pickTranscriptionModel, timestampSupport, toEngineResult, validateSummary, requestTranscription, runTranscription, getTranscript, isAudio, TRANSCRIBE_MAX_BYTES, type Transcriber } from "../../src/lib/ai/transcribe";
import { aiConfigOf, configProblem, taskSpec, isoDate, setAiConfig, listAiConfig, listRuns, queueAiProperty, autoRunForRow, isUserEdited, AI_TASKS } from "../../src/lib/ai/properties";
import { handleAiProperty } from "../../src/worker/handlers/ai-property";
import { QUEUES, QUEUE_POLICY } from "../../src/lib/jobs/queues";

delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY; // nothing in this file may reach a real provider
const P = `fakefeat_${Date.now().toString(36)}`; const MODEL = `${P}:echo`; const TAG = `feat${Date.now().toString(36)}`;
let fake: FakeLLM; let cleanup: () => Promise<void>; let ws: string; const made: string[] = []; const atts: string[] = []; const rowsMade: string[] = [];
const para = (text: string): PMNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...t: string[]): PMNode => ({ type: "doc", content: t.map(para) });
const status = async (p: Promise<unknown>) => { try { await p; return { status: 200, code: null as string | null }; } catch (e: any) { return { status: e.status ?? 500, code: e.code ?? null }; } };
const count = async (table: any) => (await db.select({ n: dsql<number>`count(*)::int` }).from(table))[0].n;

before(async () => {
  const [w] = await db.select().from(schema.workspaces).limit(1); assert.ok(w, "workspace missing"); ws = w.id;
  fake = await startFakeLLM();
  cleanup = (await registerFakeProvider(fake, P, [{ id: "echo", capabilities: { tools: true, structured_output: true }, inputPrice: 1, outputPrice: 2, contextWindow: 200_000 }, { id: "err-401" }])).cleanup;
});
after(async () => {
  // jobs queued by these tests were executed by calling the handlers directly: remove them so no worker picks them up later
  if (atts.length) await sql`delete from pgboss.job where name = 'transcribe' and data->>'attachmentId' in ${sql(atts)}`.catch(() => {});
  if (rowsMade.length) await sql`delete from pgboss.job where name = 'ai-property' and data->>'rowId' in ${sql(rowsMade)}`.catch(() => {});
  // the injected engine is logged like the real one (provider "openai", task "transcribe"): remove those rows so the usage log only holds real calls
  if (atts.length) await db.delete(schema.aiUsage).where(inArray(schema.aiUsage.refId, atts));
  if (atts.length) await db.delete(schema.attachments).where(inArray(schema.attachments.id, atts));
  for (const id of made) await removeSource("page", id);
  const all = made.length ? await db.execute<{ id: string }>(dsql`with recursive t as (select id from pages where id in ${made} union select p.id from pages p join t on p.parent_id = t.id) select id from t`) : [];
  const ids = [...new Set([...made, ...[...all].map((r) => r.id)])];
  if (ids.length) { await db.delete(schema.knowledgeEdges).where(inArray(schema.knowledgeEdges.fromId, ids)); await db.delete(schema.pages).where(inArray(schema.pages.id, ids)); await db.delete(schema.syncTombstones).where(inArray(schema.syncTombstones.id, ids)); }
  await db.delete(schema.tags).where(and(eq(schema.tags.workspaceId, ws), dsql`${schema.tags.name} like ${`%${TAG}%`}`));
  await db.delete(schema.aiUsage).where(eq(schema.aiUsage.provider, P));
  await cleanup(); await fake.close(); await sql.end();
});

// =====================================================================================================================
// Semantic zoom level 1
// =====================================================================================================================
test("zoom: the synopsis is generated once, marked AI with model and date, and served from the cache while the page is unchanged", async () => {
  const p = await createPage(ws, { title: `Zoom ${TAG}`, content: doc("Premier paragraphe sur les taux.", "Second paragraphe sur les pénalités.") }); made.push(p.id);
  fake.requests.length = 0; fake.reply = () => "  La note traite des taux et des pénalités.  ";
  const a = await aiSynopsis(ws, p.id, { model: MODEL });
  assert.equal(a.status, "ready"); assert.equal(a.ai, true); assert.equal(a.synopsis, "La note traite des taux et des pénalités."); assert.equal(a.model, MODEL); assert.equal(a.provider, P); assert.equal(a.cached, false); assert.equal(a.level, 1);
  assert.ok(Math.abs(Date.parse(a.generatedAt!) - Date.now()) < 10_000); const [use] = await db.select().from(schema.aiUsage).where(and(eq(schema.aiUsage.task, "zoom"), eq(schema.aiUsage.refId, p.id)));
  assert.equal(use.ok, true); assert.equal(a.costUsd, (120 * 1 + use.outputTokens * 2) / 1e6, "cost = catalogue price × measured tokens"); assert.equal(use.costUsd, a.costUsd);
  assert.equal(fake.requests.length, 1); const sent = fake.requests[0].body.messages.at(-1).content as string; assert.match(sent, /<workspace kind="current-page"/); assert.ok(sent.includes("Second paragraphe"));
  const b = await aiSynopsis(ws, p.id, { model: MODEL }); assert.equal(b.cached, true); assert.equal(b.synopsis, a.synopsis); assert.equal(b.generatedAt, a.generatedAt); assert.equal(b.contentHash, a.contentHash); assert.equal(fake.requests.length, 1, "no second provider call");
  assert.equal((await aiSynopsis(ws, p.id, { generate: false })).cached, true);
});
test("zoom: an edit or a rename invalidates the synopsis; cachedOnly never calls a provider; regenerate replaces the row", async () => {
  const p = await createPage(ws, { title: `Zoom edit ${TAG}`, content: doc("Version un.") }); made.push(p.id);
  fake.reply = () => "Synopsis v1."; const a = await aiSynopsis(ws, p.id, { model: MODEL });
  await updatePage(ws, p.id, { content: doc("Version deux, bien différente.") }, { baseVersion: p.version });
  fake.requests.length = 0; const miss = await aiSynopsis(ws, p.id, { generate: false });
  assert.equal(miss.status, "missing"); assert.equal(miss.ai, false); assert.equal(miss.synopsis, null); assert.notEqual(miss.contentHash, a.contentHash); assert.equal(fake.requests.length, 0);
  fake.reply = () => "Synopsis v2."; const b = await aiSynopsis(ws, p.id, { model: MODEL }); assert.equal(b.synopsis, "Synopsis v2."); assert.equal(b.cached, false);
  assert.equal((await db.select().from(schema.aiSynopses).where(eq(schema.aiSynopses.pageId, p.id))).length, 1, "one row per page and level");
  fake.reply = () => "Synopsis v3."; const c = await aiSynopsis(ws, p.id, { model: MODEL, force: true }); assert.equal(c.synopsis, "Synopsis v3."); assert.equal(c.cached, false);
  assert.notEqual(synopsisHash("A", "x"), synopsisHash("B", "x"), "the title is part of the hash");
});
test("zoom: an empty page costs nothing; a provider failure is an error and caches nothing; an unknown page is 404", async () => {
  const empty = await createPage(ws, { title: `Zoom vide ${TAG}` }); made.push(empty.id); fake.requests.length = 0;
  const e = await aiSynopsis(ws, empty.id, { model: MODEL }); assert.equal(e.status, "empty"); assert.equal(e.ai, false); assert.equal(fake.requests.length, 0);
  const p = await createPage(ws, { title: `Zoom erreur ${TAG}`, content: doc("Texte.") }); made.push(p.id);
  assert.deepEqual(await status(aiSynopsis(ws, p.id, { model: `${P}:err-401` })), { status: 502, code: "provider_error" });
  assert.equal((await db.select().from(schema.aiSynopses).where(eq(schema.aiSynopses.pageId, p.id))).length, 0);
  fake.reply = () => "   "; assert.deepEqual(await status(aiSynopsis(ws, p.id, { model: MODEL })), { status: 502, code: "provider_error" }, "an empty answer is not stored as a synopsis");
  assert.equal((await status(aiSynopsis(ws, "00000000-0000-4000-8000-000000000000", { model: MODEL }))).status, 404);
  // no model at all (keys removed, no preferred model): a clear 503, not a fabricated synopsis
  assert.deepEqual(await status(aiSynopsis(ws, p.id)), { status: 503, code: "no_model" });
});

// =====================================================================================================================
// Smart Inbox
// =====================================================================================================================
const CANDS: Candidate[] = [{ id: "11111111-1111-4111-8111-111111111111", title: "Projet A", section: "projects", icon: null }, { id: "22222222-2222-4222-8222-222222222222", title: "Notes B", section: "notes", icon: null }];
test("inbox: the model's JSON is validated against the workspace — indices outside the candidates, the page itself, duplicate or existing tags are dropped", () => {
  const ctx = { pageId: CANDS[1].id, currentTitle: "Titre actuel", currentTags: ["déjà"], existingTags: ["finance", "déjà"], candidates: CANDS };
  const s = validateSuggestion({ title: "  Nouveau   titre  ", tags: ["Finance", "#Nouveau Tag", "finance", "déjà", "", 3, "!!!"], section: "research", parentIndex: 1, relations: [{ index: 1, reason: "Lié." }, { index: 1, reason: "doublon" }, { index: 2, reason: "soi-même" }, { index: 7, reason: "hors liste" }], summary: "  Un   résumé. " }, ctx);
  assert.deepEqual(s.title, { value: "Nouveau titre", current: "Titre actuel" });
  assert.deepEqual(s.tags, [{ name: "finance", existing: true }, { name: "nouveau tag", existing: false }]);
  assert.deepEqual(s.destination, { section: "projects", parentId: CANDS[0].id, parentTitle: "Projet A" }, "the section follows the chosen parent");
  assert.deepEqual(s.relations, [{ pageId: CANDS[0].id, title: "Projet A", icon: null, reason: "Lié." }]); assert.equal(s.summary, "Un résumé.");
  const none = validateSuggestion({ title: "Titre actuel", tags: [], section: "nowhere", parentIndex: 0, relations: [], summary: "" }, ctx);
  assert.deepEqual(none, { title: null, tags: [], destination: null, relations: [], summary: null }, "same title, unknown section, no parent → nothing suggested");
  assert.deepEqual(validateSuggestion({ title: "X", tags: "a", section: "notes", parentIndex: 2, relations: "x", summary: 4 }, ctx).destination, { section: "notes", parentId: null, parentTitle: null }, "the capture cannot be filed under itself");
  assert.deepEqual(validateSuggestion(null, ctx), { title: null, tags: [], destination: null, relations: [], summary: null });
});
test("inbox: suggestions are generated with a strict schema, cached by content, and change nothing in the workspace", async () => {
  const project = await createPage(ws, { title: `Dossier hypothèque ${TAG}`, section: "projects", content: doc(`Suivi du renouvellement hypothécaire ${TAG}.`) }); made.push(project.id);
  await indexSource(ws, "page", project.id, project.title, { doc: project.content }, project.id).catch(() => {});
  await setPageTags(ws, project.id, [`banque-${TAG}`]);
  const cap = await capture(ws, { kind: "note", text: `renouvellement hypothécaire ${TAG}\nAppeler la banque pour le renouvellement hypothécaire ${TAG} avant vendredi.` }); made.push(cap.id);
  const before = await getPage(ws, cap.id); const edges = await count(schema.knowledgeEdges);
  fake.requests.length = 0;
  fake.reply = (body) => { const user = body.messages.at(-1).content as string; const i = Number(user.match(new RegExp(`\\[(\\d+)\\] \\(projects\\) Dossier hypothèque ${TAG}`))?.[1] ?? 0);
    return JSON.stringify({ title: `Renouvellement hypothécaire ${TAG}`, tags: [`banque-${TAG}`, `échéance-${TAG}`], section: "notes", parentIndex: i, relations: [{ index: i, reason: "Même dossier." }, { index: 99, reason: "inventé" }], summary: "Appeler la banque avant vendredi pour le renouvellement." }); };
  const r = await suggest(ws, cap.id, { model: MODEL });
  assert.equal(r.status, "ready"); assert.equal(r.ai, true); assert.equal(r.model, MODEL); assert.equal(r.cached, false);
  assert.equal(r.suggestions.title?.value, `Renouvellement hypothécaire ${TAG}`); assert.deepEqual(r.suggestions.tags, [{ name: `banque-${TAG}`, existing: true }, { name: `échéance-${TAG}`, existing: false }]);
  assert.deepEqual(r.suggestions.destination, { section: "projects", parentId: project.id, parentTitle: project.title }); assert.deepEqual(r.suggestions.relations.map((x) => x.pageId), [project.id]); assert.match(r.suggestions.summary!, /vendredi/);
  const body = fake.requests[0].body; assert.equal(body.response_format.type, "json_schema"); assert.equal(body.response_format.json_schema.strict, true); assert.deepEqual(body.response_format.json_schema.schema.required, ["title", "tags", "section", "parentIndex", "relations", "summary"]);
  assert.match(body.messages.at(-1).content, /<workspace kind="candidate-pages">/); assert.ok(!(body.messages.at(-1).content as string).includes(cap.id), "page ids are never sent: the model answers with indices");
  // nothing was applied
  const after = await getPage(ws, cap.id); assert.equal(after.title, before.title); assert.equal(after.version, before.version); assert.ok(after.inboxAt); assert.equal(after.parentId, null); assert.deepEqual(await pageTags(cap.id), []); assert.equal(await count(schema.knowledgeEdges), edges);
  const again = await suggest(ws, cap.id, { model: MODEL }); assert.equal(again.cached, true); assert.equal(again.generatedAt, r.generatedAt); assert.equal(fake.requests.length, 1, "cached: no second call");
  assert.equal((await suggest(ws, cap.id, { generate: false })).cached, true);
  // the cache is re-validated: a suggested page deleted meanwhile disappears from the suggestions
  await db.update(schema.pages).set({ deletedAt: new Date() }).where(eq(schema.pages.id, project.id));
  const reval = await suggest(ws, cap.id, { model: MODEL }); assert.deepEqual(reval.suggestions.relations, []); assert.deepEqual(reval.suggestions.destination, { section: "projects", parentId: null, parentTitle: null });
  await db.update(schema.pages).set({ deletedAt: null }).where(eq(schema.pages.id, project.id));
  // an edit of the capture invalidates the cache
  await updatePage(ws, cap.id, { content: doc("Texte changé.") }); assert.deepEqual(await status(suggest(ws, cap.id, { generate: false })), { status: 404, code: "not_generated" });
  fake.reply = () => "pas du json"; assert.deepEqual(await status(suggest(ws, cap.id, { model: MODEL })), { status: 502, code: "bad_output" });
});
test("inbox: applying a chosen subset is journaled and fully undoable; without a destination the capture stays in the inbox", async () => {
  const target = await createPage(ws, { title: `Cible ${TAG}`, section: "research", content: doc("Page cible.") }); made.push(target.id);
  const cap = await capture(ws, { kind: "note", text: `Idée brute ${TAG}\nDétail de l'idée.` }); made.push(cap.id); await setPageTags(ws, cap.id, [`garde-${TAG}`]);
  const before = await getPage(ws, cap.id);
  const r = await applySuggestions(ws, cap.id, { title: `Idée structurée ${TAG}`, tags: [`Nouveau-${TAG}`, `garde-${TAG}`], relations: [{ pageId: target.id, reason: "Même thème." }], summary: "Résumé accepté par le propriétaire." });
  assert.deepEqual(r.applied, ["title", "summary", "tags", "relations"]); assert.equal(r.filed, false); assert.match(r.summary, /^4 suggestions applied$/);
  const p = await getPage(ws, cap.id); assert.equal(p.title, `Idée structurée ${TAG}`); assert.ok(p.inboxAt, "still in the inbox"); assert.equal(p.version, before.version + 1);
  const first = (p.content as any).content[0]; assert.equal(first.type, "aiBlock", "the summary is inserted as a visibly AI block"); assert.equal(first.content[0].content[0].text, "Résumé accepté par le propriétaire."); assert.equal(first.attrs.action, "summary");
  assert.deepEqual(await pageTags(cap.id), [`garde-${TAG}`, `nouveau-${TAG}`].sort());
  const [edge] = await db.select().from(schema.knowledgeEdges).where(and(eq(schema.knowledgeEdges.fromId, cap.id), eq(schema.knowledgeEdges.toId, target.id))); assert.equal(edge.status, "accepted"); assert.equal(edge.kind, "ai_suggested"); assert.equal(edge.rationale, "Même thème.");
  const [j] = await db.select().from(schema.inboxActions).where(eq(schema.inboxActions.id, r.actionId)); assert.equal(j.action, "suggestions"); assert.equal((j.before as any).title, before.title);
  const versions = await db.select().from(schema.pageVersions).where(eq(schema.pageVersions.pageId, cap.id)); assert.ok(versions.some((v) => v.reason === "before AI suggestion"), "the previous state is in the history");
  // the owner keeps working: adds a tag and a paragraph — undo must leave those alone
  await setPageTags(ws, cap.id, [...(await pageTags(cap.id)), `plus-tard-${TAG}`]);
  const cur = await getPage(ws, cap.id); await updatePage(ws, cap.id, { content: { ...(cur.content as any), content: [...(cur.content as any).content, para("Ajout du propriétaire.")] } });
  assert.deepEqual(await undoInboxAction(ws, r.actionId), { ok: true, already: false });
  const u = await getPage(ws, cap.id); assert.equal(u.title, before.title); assert.ok(!(u.content as any).content.some((n: any) => n.type === "aiBlock"), "summary block removed"); assert.ok(JSON.stringify(u.content).includes("Ajout du propriétaire."), "later edits survive");
  assert.deepEqual(await pageTags(cap.id), [`garde-${TAG}`, `plus-tard-${TAG}`].sort()); assert.equal((await db.select().from(schema.knowledgeEdges).where(eq(schema.knowledgeEdges.fromId, cap.id))).length, 0);
  assert.deepEqual(await undoInboxAction(ws, r.actionId), { ok: true, already: true }, "undo is idempotent");
});
test("inbox: applying a destination files the capture (undo returns it to the inbox); invalid choices are refused before any write", async () => {
  const parent = await createPage(ws, { title: `Parent ${TAG}`, section: "projects", content: doc("Parent.") }); made.push(parent.id);
  const cap = await capture(ws, { kind: "note", text: `À classer ${TAG}` }); made.push(cap.id); const at = (await getPage(ws, cap.id)).inboxAt!;
  const bad = [{ c: {}, code: "nothing_to_apply" }, { c: { relations: [{ pageId: "00000000-0000-4000-8000-000000000000" }], title: "X" }, code: "bad_relation" }, { c: { destination: { parentId: "00000000-0000-4000-8000-000000000000" }, title: "X" }, code: "bad_destination" }, { c: { destination: { parentId: cap.id } }, code: "bad_destination" }, { c: { destination: { section: "nowhere" as any } }, code: "bad_section" }];
  const journal = await count(schema.inboxActions);
  for (const b of bad) assert.deepEqual(await status(applySuggestions(ws, cap.id, b.c)), { status: 400, code: b.code });
  assert.equal((await getPage(ws, cap.id)).title, `À classer ${TAG}`, "a refused request changed nothing (not even the title sent with it)"); assert.equal(await count(schema.inboxActions), journal);
  const r = await applySuggestions(ws, cap.id, { destination: { parentId: parent.id } });
  assert.deepEqual(r.applied, ["destination"]); assert.equal(r.filed, true); const p = await getPage(ws, cap.id); assert.equal(p.inboxAt, null); assert.equal(p.parentId, parent.id); assert.equal(p.section, "projects");
  assert.deepEqual(await status(applySuggestions(ws, cap.id, { title: "Trop tard" })), { status: 409, code: "not_in_inbox" }); assert.deepEqual(await status(suggest(ws, cap.id, { model: MODEL })), { status: 409, code: "not_in_inbox" });
  await undoInboxAction(ws, r.actionId); const u = await getPage(ws, cap.id); assert.equal(u.inboxAt!.toISOString(), at.toISOString()); assert.equal(u.parentId, null); assert.equal(u.section, "notes");
  const s = await applySuggestions(ws, cap.id, { destination: { section: "documents" } }); assert.equal((await getPage(ws, cap.id)).section, "documents"); await undoInboxAction(ws, s.actionId);
  // the historical triage actions still undo through the same entry point
  const t = await triage(ws, cap.id, { action: "archive" }); assert.equal((await getPage(ws, cap.id)).archived, true);
  assert.deepEqual(await undoInboxAction(ws, t.actionId), { ok: true, already: false }); assert.equal((await getPage(ws, cap.id)).archived, false); assert.ok((await getPage(ws, cap.id)).inboxAt);
  assert.equal((await status(undoInboxAction(ws, "00000000-0000-4000-8000-000000000000"))).status, 404);
});

// =====================================================================================================================
// Voice
// =====================================================================================================================
test("voice: the engine is chosen among the models the account exposes — segment timestamps first; response shapes map to [{t,text}]", () => {
  const exposed = ["gpt-4o-mini-transcribe", "gpt-4o-mini-transcribe-2025-12-15", "gpt-4o-transcribe", "gpt-4o-transcribe-diarize", "gpt-transcribe", "whisper-1", "gpt-realtime-whisper", "gpt-live-transcribe", "gpt-6-sol"];
  assert.equal(pickTranscriptionModel(exposed), "whisper-1"); assert.equal(pickTranscriptionModel(exposed.filter((x) => x !== "whisper-1")), "gpt-4o-transcribe-diarize");
  assert.equal(pickTranscriptionModel(["gpt-4o-mini-transcribe-2025-12-15", "gpt-4o-mini-transcribe"]), "gpt-4o-mini-transcribe", "an alias before its dated snapshot"); assert.equal(pickTranscriptionModel(["gpt-realtime-whisper", "gpt-6-sol"]), null, "realtime models are not file transcription");
  assert.deepEqual([timestampSupport("whisper-1"), timestampSupport("gpt-4o-transcribe-diarize"), timestampSupport("gpt-4o-transcribe")], ["segments", "diarized", "none"]);
  const w = toEngineResult({ text: " Bonjour  tout le monde. Ça va ? ", language: "french", duration: 4.2, segments: [{ start: 0, end: 1.9, text: " Bonjour tout le monde." }, { start: 1.934, end: 4.2, text: " Ça va ?" }, { start: 4.2, end: 4.2, text: "  " }] }, "whisper-1");
  assert.deepEqual(w, { segments: [{ t: 0, text: "Bonjour tout le monde." }, { t: 1.93, text: "Ça va ?" }], text: "Bonjour tout le monde. Ça va ?", language: "french", duration: 4.2, hasSegments: true });
  const d = toEngineResult({ text: "Oui. Non.", segments: [{ start: 0, end: 1, text: "Oui.", speaker: "A" }, { start: 1, end: 2.5, text: "Non.", speaker: "B" }] }, "gpt-4o-transcribe-diarize"); assert.deepEqual(d.segments, [{ t: 0, text: "A: Oui." }, { t: 1, text: "B: Non." }]); assert.equal(d.duration, 2.5);
  const t = toEngineResult({ text: "Texte seul.", usage: { type: "duration", seconds: 3 } }, "gpt-4o-transcribe"); assert.deepEqual(t.segments, [{ t: 0, text: "Texte seul." }]); assert.equal(t.hasSegments, false); assert.equal(t.duration, 3);
  assert.deepEqual(toEngineResult({ text: "" }, "whisper-1").segments, [], "silence is an empty transcript, not an invented one");
  assert.deepEqual(validateSummary({ text: " Résumé. ", decisions: ["D1", 3, ""], tasks: "x" }, "m", new Date("2026-11-19T00:00:00Z")), { text: "Résumé.", decisions: ["D1"], tasks: [], model: "m", at: "2026-11-19T00:00:00.000Z" }); assert.equal(validateSummary({ text: "" }, "m"), null); assert.equal(validateSummary(null, "m"), null);
  assert.ok(isAudio("audio/webm;codecs=opus") && isAudio("video/mp4") && !isAudio("application/pdf")); assert.equal(QUEUES.transcribe, "transcribe"); assert.equal(QUEUE_POLICY.transcribe.retryLimit, 0, "a paid transcription is never retried automatically");
});
const mkAudio = async (name: string, mime: string, size?: number) => { const buf = Buffer.from(`fake audio ${name} ${TAG}`); const st = await storeFile(buf, name); const [a] = await db.insert(schema.attachments).values({ workspaceId: ws, filename: name, mime, size: size ?? buf.length, sha256: st.sha256, storagePath: st.storagePath }).returning(); atts.push(a.id); return a; };
test("voice: requests are validated (audio only, ≤ 25 MB, engine configured) and nothing is queued when refused", async () => {
  const pdf = await mkAudio(`doc-${TAG}.pdf`, "application/pdf"); const big = await mkAudio(`long-${TAG}.m4a`, "audio/mp4", TRANSCRIBE_MAX_BYTES + 1); const ok = await mkAudio(`memo-${TAG}.webm`, "audio/webm");
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key"; // only makes the provider "configured"; no call is made in this test
  try {
    assert.deepEqual(await status(requestTranscription(ws, pdf.id)), { status: 415, code: "not_audio" }); assert.deepEqual(await status(requestTranscription(ws, big.id)), { status: 413, code: "too_large" });
    assert.equal((await status(requestTranscription(ws, "00000000-0000-4000-8000-000000000000"))).status, 404);
    delete process.env.OPENAI_API_KEY; assert.deepEqual(await status(requestTranscription(ws, ok.id)), { status: 503, code: "not_configured" });
    assert.equal((await db.select().from(schema.audioTranscripts).where(inArray(schema.audioTranscripts.attachmentId, [pdf.id, big.id, ok.id]))).length, 0);
    assert.deepEqual(await getTranscript(ws, ok.id), { attachmentId: ok.id, status: "none", transcript: [], text: "", engine: null, model: null, language: null, duration: null, segments: null, summary: null, error: null, costUsd: null, requestedAt: null, finishedAt: null });
  } finally { delete process.env.OPENAI_API_KEY; }
});
test("voice: queue → job → stored transcript with engine and model; summary through the router as strict JSON; a second request is not billed again", async () => {
  const a = await mkAudio(`reunion-${TAG}.webm`, "audio/webm;codecs=opus"); process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  let calls = 0; const engine: Transcriber = async (file, model) => { calls++; assert.equal(file.name, "audio.webm"); assert.equal(model, "whisper-1"); return toEngineResult({ text: "On retient le taux fixe. Marie envoie le contrat lundi.", language: "french", duration: 6.5, segments: [{ start: 0, end: 3, text: "On retient le taux fixe." }, { start: 3, end: 6.5, text: "Marie envoie le contrat lundi." }] }, model); };
  try {
    const q = await requestTranscription(ws, a.id, { summarize: true }); assert.equal(q.queued, true); assert.equal(q.status, "pending"); assert.ok((q as any).jobId);
    const [job] = await sql`select name, data from pgboss.job where id = ${(q as any).jobId}`; assert.equal(job.name, "transcribe"); assert.equal(job.data.attachmentId, a.id);
    assert.equal((await requestTranscription(ws, a.id, { summarize: true })).queued, false, "already pending: not queued twice");
    fake.reply = () => JSON.stringify({ text: "Le taux fixe est retenu.", decisions: ["Retenir le taux fixe"], tasks: ["Marie : envoyer le contrat lundi"] });
    const r = await runTranscription({ attachmentId: a.id }, { transcriber: engine, model: "whisper-1", summaryModel: MODEL }); assert.deepEqual(r, { segments: 2, chars: "On retient le taux fixe. Marie envoie le contrat lundi.".length, summary: true });
    const t = await getTranscript(ws, a.id);
    assert.equal(t.status, "done"); assert.equal(t.engine, "openai"); assert.equal(t.model, "whisper-1"); assert.equal(t.language, "french"); assert.equal(t.duration, 6.5); assert.equal(t.segments, true); assert.equal(t.error, null); assert.equal(t.costUsd, null, "no transcription price in the catalogue → cost not invented");
    assert.deepEqual(t.transcript, [{ t: 0, text: "On retient le taux fixe." }, { t: 3, text: "Marie envoie le contrat lundi." }]);
    assert.equal(t.summary!.text, "Le taux fixe est retenu."); assert.deepEqual(t.summary!.decisions, ["Retenir le taux fixe"]); assert.deepEqual(t.summary!.tasks, ["Marie : envoyer le contrat lundi"]); assert.equal(t.summary!.model, MODEL);
    assert.equal(fake.requests.at(-1)!.body.response_format.json_schema.name, "voice_summary"); assert.match(fake.requests.at(-1)!.body.messages.at(-1).content, /<workspace kind="transcript">/);
    const again = await requestTranscription(ws, a.id, { summarize: true }); assert.equal(again.queued, false); assert.equal(again.status, "done"); assert.equal(calls, 1);
    // with a price per minute set by the owner, the cost is computed from the measured duration
    await db.insert(schema.settings).values({ key: "ai.transcription_usd_per_minute", value: 0.5 }).onConflictDoUpdate({ target: schema.settings.key, set: { value: 0.5 } });
    const b = await mkAudio(`prix-${TAG}.wav`, "audio/wav"); await requestTranscription(ws, b.id); await runTranscription({ attachmentId: b.id }, { transcriber: async (_f, m) => toEngineResult({ text: "Un.", duration: 30, segments: [{ start: 0, end: 30, text: "Un." }] }, m), model: "whisper-1" });
    assert.equal((await getTranscript(ws, b.id)).costUsd, 0.25); assert.equal((await getTranscript(ws, b.id)).summary, null, "no summary unless asked");
  } finally { delete process.env.OPENAI_API_KEY; await db.delete(schema.settings).where(eq(schema.settings.key, "ai.transcription_usd_per_minute")); }
});
test("voice: engine failure and silence are stored as failed with the reason (never a made-up transcript); a failed summary keeps the transcript", async () => {
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  try {
    const a = await mkAudio(`panne-${TAG}.m4a`, "audio/mp4"); await requestTranscription(ws, a.id);
    await runTranscription({ attachmentId: a.id }, { transcriber: async () => { throw new Error("429 You exceeded your current quota"); }, model: "whisper-1" });
    let t = await getTranscript(ws, a.id); assert.equal(t.status, "failed"); assert.match(t.error!, /^Transcription failed: 429 You exceeded/); assert.deepEqual(t.transcript, []); assert.equal(t.text, "");
    const retry = await requestTranscription(ws, a.id); assert.equal(retry.queued, true, "a failed transcription can be requested again by the owner");
    await runTranscription({ attachmentId: a.id }, { transcriber: async (_f, m) => toEngineResult({ text: "" }, m), model: "whisper-1" });
    t = await getTranscript(ws, a.id); assert.equal(t.status, "failed"); assert.match(t.error!, /empty transcript/);
    const b = await mkAudio(`resume-${TAG}.mp3`, "audio/mpeg"); await requestTranscription(ws, b.id, { summarize: true }); fake.reply = () => "pas du json";
    await runTranscription({ attachmentId: b.id }, { transcriber: async (_f, m) => toEngineResult({ text: "Bonjour.", segments: [{ start: 0, end: 1, text: "Bonjour." }] }, m), model: "whisper-1", summaryModel: MODEL });
    t = await getTranscript(ws, b.id); assert.equal(t.status, "done"); assert.deepEqual(t.transcript, [{ t: 0, text: "Bonjour." }]); assert.equal(t.summary, null); assert.match(t.error!, /^Summary not produced/);
    // asking for the summary later runs only the summary (the audio is not transcribed twice)
    let again = 0; fake.reply = () => JSON.stringify({ text: "Salutation.", decisions: [], tasks: [] });
    const q = await requestTranscription(ws, b.id, { summarize: true }); assert.equal(q.queued, true);
    await runTranscription({ attachmentId: b.id, summaryOnly: true }, { transcriber: async () => { again++; throw new Error("must not be called"); }, model: "whisper-1", summaryModel: MODEL });
    t = await getTranscript(ws, b.id); assert.equal(again, 0); assert.equal(t.status, "done"); assert.equal(t.summary!.text, "Salutation."); assert.deepEqual(t.transcript, [{ t: 0, text: "Bonjour." }]);
    const odd = await mkAudio(`format-${TAG}.xyz`, "audio/x-unknown"); await requestTranscription(ws, odd.id); await runTranscription({ attachmentId: odd.id }, { transcriber: async () => { throw new Error("must not be called"); }, model: "whisper-1" });
    assert.match((await getTranscript(ws, odd.id)).error!, /Unsupported audio format/);
  } finally { delete process.env.OPENAI_API_KEY; }
});

// =====================================================================================================================
// Smart database properties
// =====================================================================================================================
test("db properties: configuration defaults, the legacy prompt, validation problems and the per-task output contracts", () => {
  assert.deepEqual(AI_TASKS, ["custom", "summarize", "classify", "extract", "detect-date", "categorize"]);
  assert.deepEqual(aiConfigOf({ config: { prompt: " Résume. " } }), { task: "custom", prompt: "Résume.", choices: [], model: null, autoRun: false, managed: false }, "a property created before 3.0 is a custom task with its prompt");
  const c = aiConfigOf({ config: { prompt: "ancien", ai: { task: "classify", prompt: "", choices: ["A", " B ", "A", 3], model: "m", autoRun: true, managed: true } } as any }); assert.deepEqual(c, { task: "classify", prompt: "", choices: ["A", "B"], model: "m", autoRun: true, managed: true });
  assert.equal(aiConfigOf({ config: { ai: { task: "nope" } } as any }).task, "custom");
  assert.equal(configProblem(aiConfigOf({ config: {} })), "No prompt configured"); assert.match(configProblem({ ...c, choices: ["A"] })!, /two choices/); assert.match(configProblem({ ...c, task: "extract", prompt: "" })!, /what to extract/); assert.equal(configProblem({ ...c, task: "summarize" }), null); assert.equal(configProblem(c), null);
  const cls = taskSpec({ ...c, choices: ["Urgent", "Normal"] }); assert.deepEqual((cls.schema!.schema as any).properties.value.enum, ["Urgent", "Normal"]); assert.equal(cls.parse('{"value":"urgent"}'), "Urgent"); assert.equal(cls.parse('{"value":"Autre"}'), null, "a class outside the choices is refused"); assert.equal(cls.parse("Normal"), "Normal");
  const cat = taskSpec({ ...c, task: "categorize", choices: ["a", "b", "c"] }); assert.equal(cat.parse('{"values":["B","zzz","a","b"]}'), "b, a"); assert.equal(cat.parse('{"values":[]}'), null); assert.equal(cat.parse("texte"), null);
  assert.equal(taskSpec({ ...c, task: "categorize", choices: [] }).parse('{"values":["Finance","Immobilier","X","Y"]}'), "finance, immobilier, x");
  const dt = taskSpec({ ...c, task: "detect-date" }); assert.equal(dt.parse('{"date":"2026-12-31"}'), "2026-12-31"); assert.equal(dt.parse('{"date":"2026-02-30"}'), null, "an impossible date is refused"); assert.equal(dt.parse('{"date":""}'), null); assert.equal(dt.parse('{"date":"31 décembre"}'), null);
  assert.equal(isoDate("2028-02-29"), "2028-02-29"); assert.equal(isoDate("2027-02-29"), null);
  const ex = taskSpec({ ...c, task: "extract", prompt: "le montant" }); assert.match(ex.instruction, /Extract from this row: le montant/); assert.equal(ex.parse('{"value":" 12 500 $ "}'), "12 500 $"); assert.equal(ex.parse('{"value":""}'), null);
  assert.equal(taskSpec({ ...c, task: "summarize" }).schema, null); assert.equal(taskSpec({ ...c, task: "custom", prompt: "Fais X" }).instruction, "Fais X"); assert.equal(taskSpec({ ...c, task: "custom", prompt: "x" }).parse(' "Réponse" '), "Réponse");
});
test("db properties: a run is logged (status, model, tokens, cost); a hand-edited cell is protected unless the property is AI-managed or forced", async () => {
  const host = await createPage(ws, { title: `Base ${TAG}`, type: "database", section: "databases" }); made.push(host.id); const d = await ensureDatabase(ws, host.id);
  const prop = await createProperty(ws, d.id, { name: "Priorité IA", type: "ai", config: { prompt: "ancien prompt" } }); const note = await createProperty(ws, d.id, { name: "Note", type: "text" });
  const row = await createRow(ws, d.id, { title: `Renouveler l'assurance ${TAG}`, values: { [note.id]: "Échéance le 12 décembre 2026, très important." } }); rowsMade.push(row.id);
  const cfg = await setAiConfig(ws, d.id, prop.id, { task: "classify", choices: ["Urgent", "Normal"], model: MODEL }); assert.equal(cfg.problem, null); assert.equal(cfg.ai.prompt, "ancien prompt", "the legacy prompt is kept as guidance");
  assert.deepEqual(await status(setAiConfig(ws, d.id, note.id, { task: "summarize" })), { status: 400, code: "not_ai_property" });
  fake.requests.length = 0; fake.reply = () => '{"value":"Urgent"}';
  const q = await queueAiProperty(ws, d.id, row.id, prop.id); assert.equal(q.queued, true); assert.equal(q.skipped, null);
  const cell = async () => (await db.select({ v: schema.databaseRows.values }).from(schema.databaseRows).where(eq(schema.databaseRows.id, row.id)))[0].v[prop.id];
  assert.equal((await cell() as any).pending, true); let [run] = await listRuns(ws, d.id, { rowId: row.id }); assert.equal(run.status, "queued"); assert.equal(run.trigger, "manual"); assert.equal(run.task, "classify");
  await handleAiProperty({ rowId: row.id, propertyId: prop.id, workspaceId: ws, runId: q.runId });
  assert.equal(await cell(), "Urgent"); [run] = await listRuns(ws, d.id, { rowId: row.id });
  assert.equal(run.status, "done"); assert.equal(run.model, MODEL); assert.equal(run.provider, P); assert.equal(run.inputTokens, 120); assert.ok(run.outputTokens > 0); assert.equal(run.costUsd, (120 * 1 + run.outputTokens * 2) / 1e6); assert.equal(run.error, null); assert.ok(run.startedAt && run.finishedAt);
  const sent = fake.requests.at(-1)!.body; assert.deepEqual(sent.response_format.json_schema.schema.properties.value.enum, ["Urgent", "Normal"]); assert.match(sent.messages.at(-1).content, /Classify this row into exactly one of these classes: "Urgent", "Normal"/); assert.match(sent.messages.at(-1).content, /Note: Échéance le 12 décembre 2026/); assert.match(sent.messages.at(-1).content, /Additional guidance from the owner: ancien prompt/);
  // regenerating an AI-written value is allowed (existing manual action keeps working)
  assert.equal(await isUserEdited(row.id, prop.id, await cell()), false); assert.equal((await queueAiProperty(ws, d.id, row.id, prop.id)).queued, true);
  fake.reply = () => '{"value":"Normal"}'; await handleAiProperty({ rowId: row.id, propertyId: prop.id, workspaceId: ws, runId: (await listRuns(ws, d.id, { rowId: row.id }))[0].id }); assert.equal(await cell(), "Normal");
  // the owner types a value by hand → protected
  await updateRow(ws, d.id, row.id, { [prop.id]: "Critique (décidé par moi)" }); assert.equal(await isUserEdited(row.id, prop.id, await cell()), true);
  const guarded = await queueAiProperty(ws, d.id, row.id, prop.id); assert.deepEqual([guarded.queued, guarded.skipped], [false, "user_edited"]); assert.equal(await cell(), "Critique (décidé par moi)", "the hand-edited value is untouched (not even marked pending)");
  assert.equal((await listRuns(ws, d.id, { status: "skipped" }))[0].error, "The cell holds a value edited by hand and the property is not AI-managed: not overwritten.");
  assert.deepEqual([(await queueAiProperty(ws, d.id, row.id, prop.id, { trigger: "auto" })).skipped], ["user_edited"]);
  // AI-managed property → the AI may overwrite
  await setAiConfig(ws, d.id, prop.id, { managed: true }); const m = await queueAiProperty(ws, d.id, row.id, prop.id); assert.equal(m.queued, true);
  fake.reply = () => '{"value":"Urgent"}'; await handleAiProperty({ rowId: row.id, propertyId: prop.id, workspaceId: ws, runId: m.runId }); assert.equal(await cell(), "Urgent");
  await setAiConfig(ws, d.id, prop.id, { managed: false }); await updateRow(ws, d.id, row.id, { [prop.id]: "À la main" }); assert.equal((await queueAiProperty(ws, d.id, row.id, prop.id, { force: true })).queued, true, "the owner can force one cell");
  // an answer outside the contract empties the cell rather than storing a guess; a provider error is logged with its message
  fake.reply = () => '{"value":"Peut-être"}'; await handleAiProperty({ rowId: row.id, propertyId: prop.id, workspaceId: ws, runId: (await listRuns(ws, d.id, { rowId: row.id }))[0].id }); assert.equal(await cell(), null);
  await setAiConfig(ws, d.id, prop.id, { model: `${P}:err-401` }); const e = await queueAiProperty(ws, d.id, row.id, prop.id); await handleAiProperty({ rowId: row.id, propertyId: prop.id, workspaceId: ws, runId: e.runId });
  const failed = (await listRuns(ws, d.id, { status: "failed" }))[0]; assert.equal(failed.id, e.runId); assert.ok(failed.error && failed.error.length > 0); assert.ok((await cell() as any).error, "the cell shows the error");
  const conf = await listAiConfig(ws, d.id); assert.equal(conf.length, 1); assert.equal(conf[0].propertyId, prop.id); assert.equal(conf[0].ai.task, "classify"); assert.ok(conf[0].runs.done >= 3); assert.equal(conf[0].runs.failed, 1); assert.ok(conf[0].runs.skipped >= 2); assert.ok(conf[0].runs.costUsd > 0); assert.ok(conf[0].runs.lastAt);
  assert.ok((await listRuns(ws, d.id, { propertyId: prop.id, limit: 2 })).length === 2); assert.ok(!("outputHash" in (await listRuns(ws, d.id))[0]));
  // the row is still readable through the normal query path
  const dbFull = await getDatabase(ws, d.id); assert.ok((await queryRows(d.id, dbFull.properties, {})).rows.some((r) => r.id === row.id));
});
test("db properties: auto-run queues AI properties when another value changes — never for an AI-only change, a bad config or a hand-edited cell", async () => {
  const host = await createPage(ws, { title: `Base auto ${TAG}`, type: "database", section: "databases" }); made.push(host.id); const d = await ensureDatabase(ws, host.id);
  const auto = await createProperty(ws, d.id, { name: "Résumé IA", type: "ai" }); const manual = await createProperty(ws, d.id, { name: "Date IA", type: "ai" }); const note = await createProperty(ws, d.id, { name: "Note", type: "text" });
  await setAiConfig(ws, d.id, auto.id, { task: "summarize", autoRun: true, model: MODEL }); await setAiConfig(ws, d.id, manual.id, { task: "detect-date", model: MODEL });
  const row = await createRow(ws, d.id, { title: `Ligne ${TAG}`, values: { [note.id]: "Rencontre le 3 mars 2027." } }); rowsMade.push(row.id);
  const a = await autoRunForRow(ws, d.id, row.id, [note.id]); assert.equal(a.length, 1, "only the property with autoRun"); assert.equal(a[0].propertyId, auto.id); assert.equal(a[0].queued, true);
  let runs = await listRuns(ws, d.id, { rowId: row.id }); assert.equal(runs[0].trigger, "auto"); assert.equal(runs[0].task, "summarize");
  fake.reply = () => "Rencontre prévue le 3 mars 2027."; await handleAiProperty({ rowId: row.id, propertyId: auto.id, workspaceId: ws, runId: a[0].runId });
  assert.deepEqual(await autoRunForRow(ws, d.id, row.id, [auto.id]), [], "a change of the AI cell itself does not loop"); assert.deepEqual(await autoRunForRow(ws, d.id, row.id, ["Résumé IA", manual.id]), []);
  // detect-date on the manual property
  fake.reply = () => '{"date":"2027-03-03"}'; const q = await queueAiProperty(ws, d.id, row.id, manual.id); await handleAiProperty({ rowId: row.id, propertyId: manual.id, workspaceId: ws, runId: q.runId });
  const vals = (await db.select({ v: schema.databaseRows.values }).from(schema.databaseRows).where(eq(schema.databaseRows.id, row.id)))[0].v; assert.equal(vals[manual.id], "2027-03-03"); assert.equal(vals[auto.id], "Rencontre prévue le 3 mars 2027.");
  // a job queued by an older client (no run id) is still logged
  await handleAiProperty({ rowId: row.id, propertyId: manual.id, workspaceId: ws }); runs = await listRuns(ws, d.id, { propertyId: manual.id }); assert.equal(runs.length, 2); assert.equal(runs[0].status, "done");
  // bad configuration: a manual click shows the problem in the cell and logs a skipped run; auto-run just logs
  const broken = await createProperty(ws, d.id, { name: "Cassée", type: "ai" }); await setAiConfig(ws, d.id, broken.id, { task: "classify", choices: ["Seul"], autoRun: true });
  const b = await queueAiProperty(ws, d.id, row.id, broken.id); assert.deepEqual([b.queued, b.skipped], [false, "bad_config"]);
  assert.deepEqual((await db.select({ v: schema.databaseRows.values }).from(schema.databaseRows).where(eq(schema.databaseRows.id, row.id)))[0].v[broken.id], { error: "Classification needs at least two choices" });
  assert.deepEqual(await status(queueAiProperty(ws, d.id, row.id, note.id)), { status: 400, code: "not_ai_property" }); assert.equal((await status(queueAiProperty(ws, d.id, "00000000-0000-4000-8000-000000000000", auto.id))).status, 404);
  // historical manual path with only `config.prompt` still computes
  const legacy = await createProperty(ws, d.id, { name: "Ancienne", type: "ai", config: { prompt: "Donne un mot-clé pour {{Note}}", ai: { model: MODEL } } }); fake.reply = () => '"rencontre"';
  const l = await queueAiProperty(ws, d.id, row.id, legacy.id); await handleAiProperty({ rowId: row.id, propertyId: legacy.id, workspaceId: ws, runId: l.runId });
  assert.equal((await db.select({ v: schema.databaseRows.values }).from(schema.databaseRows).where(eq(schema.databaseRows.id, row.id)))[0].v[legacy.id], "rencontre"); assert.match(fake.requests.at(-1)!.body.messages.at(-1).content, /Donne un mot-clé pour Rencontre le 3 mars 2027\./);
});
