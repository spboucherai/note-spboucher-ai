/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/ai-ask.test.ts
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
 * Ask My Knowledge (SPEC §4.10): scope (all | page | project | selection), block-anchored and verified citations, the "no support →
 * say so" rules, and the new inline actions (coherence, questions, links, synthesis, structure). Hermetic: the real provider keys are
 * removed from this process, the answering model is a local fake OpenAI-compatible server, retrieval is full-text only.
 */
import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { startFakeLLM, registerFakeProvider, type FakeLLM } from "../helpers/fake-llm";
import { createPage } from "../../src/lib/pages/service";
import { indexSource, removeSource } from "../../src/lib/search/index";
import { docBlocks, type PMNode } from "../../src/lib/editor/text";
import { chat, validateCitations, resolveScope, ACTION_IDS, planAction, CHAT_SCOPES, type ChatEvent, type ChatRequest } from "../../src/lib/ai/chat";
import { blocksOfChunk, bestBlock, citingSentences, overlapScore, tokens } from "../../src/lib/ai/citations";
import { ACTION_SYSTEMS, LINKS_SYSTEM } from "../../src/lib/ai/prompts";
import { linkCandidates, validateLinkPicks, pickLinks } from "../../src/lib/ai/links";
import { route } from "../../src/lib/ai/router";

delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY; // nothing in this file may reach a real provider
const P = `fakeask_${Date.now().toString(36)}`; const MODEL = `${P}:echo`; const TAG = `ask${Date.now().toString(36)}`;
let fake: FakeLLM; let cleanup: () => Promise<void>; let ws: string; const made: string[] = []; const convs: string[] = [];
const para = (text: string): PMNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const T = { rate: `Le taux variable ${TAG} suit le taux directeur de la Banque du Canada.`, penalty: `La pénalité de remboursement anticipé ${TAG} équivaut à trois mois d'intérêts.`, amort: `L'amortissement maximal ${TAG} est de vingt-cinq ans pour un prêt assuré.`, other: `La pénalité de remboursement ${TAG} est calculée selon le différentiel de taux.` };
let root: string, pageA: string, pageB: string; let blocksA: ReturnType<typeof docBlocks>; let blocksB: ReturnType<typeof docBlocks>;
const mk = async (title: string, content: PMNode[], parentId?: string) => { const p = await createPage(ws, { title, parentId: parentId ?? null, section: "projects", content: { type: "doc", content } }); made.push(p.id); await indexSource(ws, "page", p.id, p.title, { doc: p.content }, p.id).catch(() => {}); return p; };
const run = async (r: Partial<ChatRequest> & { message: string }) => { const out: ChatEvent[] = []; for await (const e of chat(ws, { model: MODEL, ...r })) { out.push(e); if (e.type === "meta" && e.conversationId) convs.push(e.conversationId); } return out; };
const ev = <K extends ChatEvent["type"]>(list: ChatEvent[], type: K) => list.find((e) => e.type === type) as Extract<ChatEvent, { type: K }> | undefined;
/** The fake model reads the numbered sources it was sent and cites the one whose title is given. */
const numberOf = (body: any, title: string) => Number((body.messages.at(-1).content as string).match(new RegExp(`\\[(\\d+)\\] "${title}"`))?.[1] ?? 0);

before(async () => {
  const [w] = await db.select().from(schema.workspaces).limit(1); assert.ok(w, "workspace missing"); ws = w.id;
  fake = await startFakeLLM(); cleanup = (await registerFakeProvider(fake, P, [{ id: "echo", capabilities: { tools: true, structured_output: true }, inputPrice: 1, outputPrice: 2, contextWindow: 200_000 }])).cleanup;
  const r = await mk(`Projet ${TAG}`, [para(`Notes de cadrage ${TAG} du projet hypothécaire.`)]); root = r.id;
  const a = await mk(`Hypothèques ${TAG}`, [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Conditions" }] }, para(T.rate), para(T.penalty), para(T.amort)], root); pageA = a.id; blocksA = docBlocks(a.content as PMNode);
  const b = await mk(`Autre banque ${TAG}`, [para(T.other)]); pageB = b.id; blocksB = docBlocks(b.content as PMNode);
});
after(async () => {
  if (convs.length) await db.delete(schema.aiConversations).where(inArray(schema.aiConversations.id, [...new Set(convs)]));
  for (const id of made) await removeSource("page", id);
  if (made.length) { await db.delete(schema.pages).where(inArray(schema.pages.id, made)); await db.delete(schema.syncTombstones).where(inArray(schema.syncTombstones.id, made)); }
  await db.delete(schema.aiUsage).where(eq(schema.aiUsage.provider, P));
  await cleanup(); await fake.close(); await sql.end();
});

// ---------- pure helpers
test("anchoring helpers: a chunk is mapped back to its blocks and the best block for a sentence is chosen", () => {
  const blocks = [{ id: "h", type: "heading", heading: "Conditions", text: "Conditions" }, { id: "b1", type: "paragraph", heading: "Conditions", text: T.rate }, { id: "b2", type: "paragraph", heading: "Conditions", text: T.penalty }, { id: "b3", type: "paragraph", heading: "Conditions", text: T.amort }, { id: "x", type: "paragraph", heading: null, text: "Sans rapport." }];
  const chunk = [T.rate, T.penalty, T.amort].join("\n");
  assert.deepEqual(blocksOfChunk(blocks, chunk).map((b) => b.id), ["b1", "b2", "b3"], "headings and foreign blocks are not part of the passage");
  assert.equal(bestBlock(blocksOfChunk(blocks, chunk), "Quelle est la pénalité de remboursement anticipé ?")?.id, "b2");
  assert.equal(bestBlock(blocksOfChunk(blocks, chunk), "amortissement maximal prêt assuré")?.id, "b3");
  assert.equal(bestBlock(blocksOfChunk(blocks, chunk), "zzz")?.id, "b1", "no lexical match → first block of the passage");
  assert.deepEqual(blocksOfChunk(blocks, "texte disparu de la page"), [], "a passage that is no longer in the page has no block");
  const long = "Phrase un. ".repeat(80); assert.deepEqual(blocksOfChunk([{ id: "L", type: "paragraph", heading: null, text: long }], long.slice(0, 200)).map((b) => b.id), ["L"], "a piece of a long block maps to that block");
  assert.equal(citingSentences("Le taux suit la Banque [1]. La pénalité vaut trois mois [2][3]. Rien ici.", 2), "La pénalité vaut trois mois.");
  assert.equal(citingSentences("- point A [1]\n- point B [2]", 1), "- point A"); assert.equal(citingSentences("Aucune citation.", 1), "");
  assert.ok(overlapScore("pénalité remboursement", T.penalty) > overlapScore("pénalité remboursement", T.rate)); assert.deepEqual(tokens("L'amortissement est de 25 ans"), ["amortissement", "25", "ans"]);
});
test("citation markers outside the retrieved set are removed and reported; code is left alone", () => {
  const v = validateCitations("Vrai [1]. Inventé [7]. Groupe [1, 2, 9]. `a[3]` reste.", new Set([1, 2]));
  assert.equal(v.text, "Vrai [1]. Inventé. Groupe [1][2]. `a[3]` reste."); assert.deepEqual(v.cited, [1, 2]); assert.deepEqual(v.invalid, [7, 9]);
});

// ---------- scope
test("scope: project = root ancestor + descendants, page = that page, unknown or missing page is a coded error", async () => {
  assert.deepEqual(CHAT_SCOPES, ["all", "page", "project", "selection"]);
  assert.deepEqual(await resolveScope(ws, {}), { scope: "all", pageIds: null });
  assert.deepEqual(await resolveScope(ws, { scope: "page", pageId: pageA }), { scope: "page", pageIds: [pageA] });
  const proj = await resolveScope(ws, { scope: "project", pageId: pageA }); assert.deepEqual([...proj.pageIds!].sort(), [root, pageA].sort(), "from a child page: the whole project");
  assert.deepEqual([...(await resolveScope(ws, { scope: "project", projectId: root })).pageIds!].sort(), [root, pageA].sort());
  assert.deepEqual((await resolveScope(ws, { scope: "project", pageId: pageB })).pageIds, [pageB], "a top-level page is its own project");
  await assert.rejects(resolveScope(ws, { scope: "page" }), (e: any) => e.code === "page_required");
  await assert.rejects(resolveScope(ws, { scope: "project", projectId: "00000000-0000-4000-8000-000000000000" }), (e: any) => e.code === "not_found");
});
test("ask (scope all): the answer cites verified blocks — the anchor is the paragraph that supports the sentence, not the first block of the chunk; an invented marker is dropped", async () => {
  fake.reply = (body) => `La pénalité équivaut à trois mois d'intérêts [${numberOf(body, `Hypothèques ${TAG}`)}]. Ailleurs elle suit le différentiel de taux [${numberOf(body, `Autre banque ${TAG}`)}]. Affirmation inventée [9].`;
  const out = await run({ message: `pénalité remboursement ${TAG}` });
  const meta = ev(out, "meta")!; const done = ev(out, "done")!; assert.ok(done, JSON.stringify(out.at(-1)));
  assert.equal(meta.scope, "all"); assert.equal(meta.scopePages, null); assert.equal(meta.model, MODEL); assert.equal(meta.provider, P); assert.equal(meta.reason, "user selection"); assert.equal(meta.evidence, "ok");
  assert.equal(done.sources.length, 2); assert.deepEqual(done.invalidCitations, [9]); assert.ok(!done.content.includes("[9]")); assert.equal(done.evidence, "ok"); assert.equal(done.uncited, false);
  const a = done.sources.find((s) => s.pageId === pageA)!; const b = done.sources.find((s) => s.pageId === pageB)!;
  const penaltyBlock = blocksA.find((x) => x.text === T.penalty)!.id; const firstBlock = blocksA.find((x) => x.text === T.rate)!.id;
  assert.equal(a.blockId, penaltyBlock, "anchored to the paragraph about the penalty"); assert.notEqual(a.blockId, firstBlock); assert.equal(a.anchor, "block"); assert.equal(a.quote, T.penalty);
  assert.ok(a.blockIds!.includes(firstBlock!) && a.blockIds!.includes(penaltyBlock!), "all blocks of the passage are listed");
  assert.equal(b.blockId, blocksB[0].id); assert.equal(b.quote, T.other);
  // every cited block exists in the page as it is now
  for (const s of done.sources) { const [p] = await db.select({ content: schema.pages.content }).from(schema.pages).where(eq(schema.pages.id, s.pageId!)); assert.ok(docBlocks(p.content as PMNode).some((x) => x.id === s.blockId), `block ${s.blockId} exists`); }
  const [stored] = await db.select().from(schema.aiMessages).where(eq(schema.aiMessages.id, done.messageId)); assert.equal((stored.sources as any[]).length, 2); assert.equal((stored.sources as any[])[0].blockId != null, true);
});
test("ask (scope page / project): evidence is restricted to the scope", async () => {
  fake.reply = (body) => `Réponse [1]. ${(body.messages.at(-1).content as string).includes(`Autre banque ${TAG}`) ? "AUTRE" : "SEULE"}`;
  const page = await run({ message: `pénalité remboursement ${TAG}`, scope: "page", pageId: pageB });
  assert.equal(ev(page, "meta")!.scope, "page"); assert.equal(ev(page, "meta")!.scopePages, 1); assert.deepEqual(ev(page, "meta")!.sources.map((s) => s.pageId), [pageB]);
  const proj = await run({ message: `pénalité remboursement ${TAG}`, scope: "project", pageId: pageA });
  assert.equal(ev(proj, "meta")!.scopePages, 2); assert.deepEqual(ev(proj, "meta")!.sources.map((s) => s.pageId), [pageA], "the other bank's page is outside the project");
  assert.match(ev(proj, "done")!.content, /SEULE$/, "the excerpt of the page outside the project was not sent");
});
test("ask (scope selection): only the selected text is sent, no search, and the citation points to the block it was selected in", async () => {
  const blockId = blocksA.find((x) => x.text === T.amort)!.id!; fake.requests.length = 0; fake.reply = () => "Vingt-cinq ans pour un prêt assuré [1].";
  const out = await run({ message: "Quelle est la durée maximale ?", scope: "selection", selection: T.amort, selectionBlockId: blockId, pageId: pageA });
  const meta = ev(out, "meta")!; const done = ev(out, "done")!; assert.ok(done, JSON.stringify(out.at(-1)));
  assert.equal(meta.scope, "selection"); assert.equal(meta.sent.embeddedBy, null); assert.equal(meta.sources.length, 1); assert.equal(meta.sources[0].sourceType, "selection");
  assert.equal(done.sources[0].blockId, blockId); assert.equal(done.sources[0].anchor, "selection"); assert.equal(done.sources[0].pageId, pageA);
  const sent = fake.requests.at(-1)!.body.messages.at(-1).content as string; assert.ok(sent.includes(T.amort)); assert.ok(!sent.includes(T.penalty), "nothing but the selection is sent");
  // a block id that is not in the page is not trusted
  const bad = await run({ message: "Durée ?", scope: "selection", selection: T.amort, selectionBlockId: "not-a-block", pageId: pageA }); assert.equal(ev(bad, "done")!.sources[0].blockId, null);
});
test("ask: an unresolvable scope is refused before anything is stored or sent", async () => {
  const before = (await db.select({ n: dsql<number>`count(*)::int` }).from(schema.aiConversations))[0].n; fake.requests.length = 0;
  const cases: [Partial<ChatRequest>, string][] = [[{ scope: "page" }, "page_required"], [{ scope: "project" }, "page_required"], [{ scope: "selection" }, "selection_required"], [{ scope: "selection", selection: "   " }, "selection_required"], [{ scope: "page", pageId: pageA, mode: "general" }, "bad_scope"], [{ scope: "selection", selection: "x", mode: "draft" }, "bad_scope"], [{ scope: "project", projectId: "00000000-0000-4000-8000-000000000000" }, "not_found"]];
  for (const [r, code] of cases) { const out = await run({ message: "question", ...r }); assert.equal(out.length, 1, code); assert.equal(out[0].type, "error"); assert.equal((out[0] as any).code, code); assert.equal((out[0] as any).retryable, false); }
  assert.equal((await db.select({ n: dsql<number>`count(*)::int` }).from(schema.aiConversations))[0].n, before); assert.equal(fake.requests.length, 0);
});

// ---------- no support → say so
test("ask: with no supporting block no provider is called and the answer says so", async () => {
  fake.requests.length = 0; const out = await run({ message: `zzqx${TAG} introuvable`, scope: "project", pageId: pageA });
  const done = ev(out, "done")!; assert.equal(done.evidence, "none"); assert.match(done.content, /^\*\*No supporting note found\.\*\*/); assert.deepEqual(done.sources, []); assert.equal(done.costUsd, 0);
  assert.equal(ev(out, "meta")!.model, null); assert.equal(fake.requests.length, 0, "the answering model was not called");
});
test("ask: an answer that cites nothing is withheld (not shown as grounded); the model's INSUFFICIENT is honoured", async () => {
  fake.reply = () => "La pénalité est probablement de six mois selon la pratique courante.";
  const a = ev(await run({ message: `pénalité remboursement ${TAG}` }), "done")!;
  assert.equal(a.uncited, true); assert.equal(a.evidence, "insufficient"); assert.deepEqual(a.sources, []); assert.match(a.content, /^\*\*No supporting note found\.\*\*/); assert.ok(!a.content.includes("six mois"), "the unverifiable text is not shown");
  fake.reply = () => "[[INSUFFICIENT]]\nLes extraits ne donnent pas le montant exact [1].";
  const b = ev(await run({ message: `pénalité remboursement ${TAG}` }), "done")!; assert.equal(b.evidence, "insufficient"); assert.deepEqual(b.sources, []); assert.ok(!b.content.includes("[1]")); assert.ok(!b.content.includes("INSUFFICIENT"));
  fake.reply = () => "Réponse qui ne cite que du faux [5][6].";
  const c = ev(await run({ message: `pénalité remboursement ${TAG}` }), "done")!; assert.equal(c.evidence, "insufficient"); assert.deepEqual(c.invalidCitations, [5, 6]); assert.deepEqual(c.sources, []);
});
test("ask: a passage that is no longer in the page (stale index) is dropped — its citation could not be verified", async () => {
  // the page changes but its index is not refreshed: the old passage is still found by the search
  await db.update(schema.pages).set({ content: { type: "doc", content: [{ type: "paragraph", attrs: { id: "new-block" }, content: [{ type: "text", text: "Contenu entièrement réécrit." }] }] } }).where(eq(schema.pages.id, pageB));
  fake.requests.length = 0; const out = await run({ message: `pénalité remboursement ${TAG}`, scope: "page", pageId: pageB });
  assert.equal(ev(out, "meta")!.staleDropped, 1); assert.deepEqual(ev(out, "meta")!.sources, []); assert.equal(ev(out, "done")!.evidence, "none"); assert.equal(fake.requests.length, 0);
  const all = await run({ message: `pénalité remboursement ${TAG}` }); assert.deepEqual(ev(all, "meta")!.sources.map((s) => s.pageId), [pageA], "the live passage is still usable");
});
test("ask: a provider failure stores no answer and reports a retryable error", async () => {
  const [m] = await db.insert(schema.aiModels).values({ id: `${P}:err-500`, provider: P, category: "text", enabled: true, available: true, capabilities: {} }).returning(); assert.ok(m);
  const { invalidateCatalog } = await import("../../src/lib/ai/catalog"); invalidateCatalog();
  const out = await run({ message: `pénalité remboursement ${TAG}`, model: `${P}:err-500` });
  const e = out.at(-1) as Extract<ChatEvent, { type: "error" }>; assert.equal(e.type, "error"); assert.equal(e.code, "provider_error"); assert.equal(e.retryable, true); assert.match(e.message, /temporarily unavailable/);
  const msgs = await db.select().from(schema.aiMessages).where(eq(schema.aiMessages.conversationId, e.conversationId!)); assert.deepEqual(msgs.map((x) => x.role), ["user"], "no assistant message stored");
  const [u] = await db.select().from(schema.aiUsage).where(and(eq(schema.aiUsage.provider, P), eq(schema.aiUsage.ok, false))).limit(1); assert.ok(u, "the failed call is in the usage log");
});

// ---------- inline actions
test("actions: the five new actions exist next to every historical one, each with its prompt and a route plan", async () => {
  const historical = ["rewrite", "fix", "translate", "summarize", "expand", "explain", "to_list", "to_tasks", "table", "shorten", "formal", "simplify", "translate_fr", "translate_en", "explain_math", "continue", "outline", "study_notes", "action_items", "contradictions", "custom"];
  for (const a of historical) assert.ok((ACTION_IDS as readonly string[]).includes(a), `historical action ${a} kept`);
  for (const a of ["coherence", "questions", "links", "synthesis", "structure"]) assert.ok((ACTION_IDS as readonly string[]).includes(a), a);
  assert.equal(ACTION_IDS.length, 26);
  for (const a of ["coherence", "questions", "synthesis", "structure"]) { assert.ok(ACTION_SYSTEMS[a]?.length > 80, a); const { plan, dec } = await planAction(a as any, 500, MODEL); assert.equal(plan.error, null); assert.equal(dec?.model.id, MODEL); assert.equal(plan.expensive, null, `${a} is not an expensive class`); }
  assert.equal(ACTION_SYSTEMS.links, undefined, "links has its own JSON contract"); assert.match(LINKS_SYSTEM, /Never invent a page/);
  assert.equal((await planAction("links", 500, MODEL)).plan.task, "extract");
});
test("links: candidates come from the workspace (never the page itself nor a page already linked), picks are validated, nothing is written", async () => {
  const text = `Il faut vérifier la pénalité de remboursement ${TAG} avant de signer.`;
  const cands = await linkCandidates(ws, `pénalité remboursement ${TAG}`, pageB); assert.ok(cands.some((c) => c.pageId === pageA)); assert.ok(!cands.some((c) => c.pageId === pageB), "the page itself is not a candidate");
  const linking = await mk(`Lien existant ${TAG}`, [{ type: "paragraph", content: [{ type: "text", text: "voir", marks: [{ type: "link", attrs: { href: `/p/${pageA}` } }] }] }]);
  assert.ok(!(await linkCandidates(ws, `pénalité remboursement ${TAG}`, linking.id)).some((c) => c.pageId === pageA), "already linked from the page");
  const picks = validateLinkPicks({ links: [{ index: 1, anchorText: "pénalité de remboursement", reason: "Même sujet." }, { index: 1, anchorText: "x", reason: "doublon" }, { index: 99, anchorText: "", reason: "hors liste" }, { index: 0, anchorText: "", reason: "zéro" }, { index: 2, anchorText: "texte absent", reason: "ancre inventée" }] }, [cands[0], { ...cands[0], pageId: "other", title: "Autre" }], text);
  assert.equal(picks.length, 2); assert.equal(picks[0].anchorText, "pénalité de remboursement"); assert.equal(picks[1].anchorText, null, "an anchor that is not in the text is blanked"); assert.deepEqual(validateLinkPicks("nope", cands, text), []); assert.deepEqual(validateLinkPicks({ links: "x" }, cands, text), []);
  const edges = (await db.select({ n: dsql<number>`count(*)::int` }).from(schema.knowledgeEdges))[0].n; const links = (await db.select({ n: dsql<number>`count(*)::int` }).from(schema.links))[0].n;
  fake.reply = (body) => { const i = Number((body.messages.at(-1).content as string).match(new RegExp(`\\[(\\d+)\\] "Hypothèques ${TAG}"`))?.[1]); return JSON.stringify({ links: [{ index: i, anchorText: "pénalité de remboursement", reason: "La page détaille cette pénalité." }, { index: 42, anchorText: "", reason: "inventé" }] }); };
  const dec = await route({ task: "extract", schema: true, preferred: MODEL });
  const r = await pickLinks(dec, text, await linkCandidates(ws, text.replace("Il faut vérifier la ", "").replace(" avant de signer.", ""), null));
  assert.equal(r.links.length, 1); assert.equal(r.links[0].pageId, pageA); assert.equal(r.links[0].anchorText, "pénalité de remboursement"); assert.equal(r.links[0].title, `Hypothèques ${TAG}`);
  assert.equal(fake.requests.at(-1)!.body.response_format.type, "json_schema");
  fake.reply = () => "ceci n'est pas du JSON"; const bad = await pickLinks(dec, text, cands); assert.equal(bad.parsed, null); assert.deepEqual(bad.links, []);
  assert.equal((await db.select({ n: dsql<number>`count(*)::int` }).from(schema.knowledgeEdges))[0].n, edges, "no edge written"); assert.equal((await db.select({ n: dsql<number>`count(*)::int` }).from(schema.links))[0].n, links, "no link written");
});
