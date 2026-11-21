/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-p-cv-inbox.test.ts
 * Description      : Smart Inbox checklist (SPEC §4.12). Pure selection model
 *                    (nothing ticked at the start, only the ticked subset is
 *                    sent, with the owner's edits), the wording of errors, and
 *                    — on the scratch database, without any model — that a body
 *                    built by the checklist is accepted by `applySuggestions`,
 *                    changes exactly the chosen things and is undone by the
 *                    journal.
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
import { and, eq, inArray } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { capture, pageTags } from "../../src/lib/inbox/service";
import { createPage, getPage } from "../../src/lib/pages/service";
import { applySuggestions, undoInboxAction } from "../../src/lib/ai/inbox";
import type { PMNode } from "../../src/lib/editor/text";
import { buildApplyBody, countChosen, countOffered, destinationLabel, emptyChoice, hasSuggestions, selectAll, suggestionError, type Suggestions } from "../../src/lib/client/inbox-suggest";

const TAG = `pcvi${Date.now().toString(36)}`; const made: string[] = [];
const REL = "11111111-1111-4111-8111-111111111111", PARENT = "22222222-2222-4222-8222-222222222222";
const S: Suggestions = { title: { value: "Rappeler la banque", current: "rappeler banque" }, tags: [{ name: "banque", existing: true }, { name: "triplex", existing: false }], destination: { section: "projects", parentId: PARENT, parentTitle: "Refinancement" }, relations: [{ pageId: REL, title: "Offre", icon: null, reason: "Même financement." }], summary: "Rappeler la banque pour la garantie de taux." };
after(async () => {
  if (made.length) { await db.delete(schema.knowledgeEdges).where(inArray(schema.knowledgeEdges.fromId, made)); await db.delete(schema.inboxActions).where(inArray(schema.inboxActions.pageId, made)); await db.delete(schema.knowledgeEvents).where(inArray(schema.knowledgeEvents.pageId, made)); await db.delete(schema.pages).where(inArray(schema.pages.id, made)); await db.delete(schema.syncTombstones).where(inArray(schema.syncTombstones.id, made)); }
  const [w] = await db.select().from(schema.workspaces).limit(1); if (w) await db.delete(schema.tags).where(and(eq(schema.tags.workspaceId, w.id), inArray(schema.tags.name, [`a${TAG}`, `b${TAG}`])));
  await sql.end();
});

test("checklist: nothing is ticked at the start, so nothing can be applied by accident", () => {
  const c = emptyChoice(S);
  assert.equal(countOffered(S), 6); assert.equal(hasSuggestions(S), true); assert.equal(countChosen(S, c), 0); assert.equal(buildApplyBody(S, c), null);
  assert.equal(c.titleValue, "Rappeler la banque"); assert.equal(c.summaryValue, S.summary);
  const none: Suggestions = { title: null, tags: [], destination: null, relations: [], summary: null }; assert.equal(hasSuggestions(none), false); assert.equal(buildApplyBody(none, selectAll(none, emptyChoice(none), true)), null);
});
test("checklist: only the ticked subset is sent, with the owner's edits; an emptied text is not sent", () => {
  let c = emptyChoice(S); c = { ...c, tags: { triplex: true }, summary: true, summaryValue: "  Mon   résumé corrigé. " };
  assert.equal(countChosen(S, c), 2); assert.deepEqual(buildApplyBody(S, c), { tags: ["triplex"], summary: "Mon résumé corrigé." });
  c = { ...c, title: true, titleValue: "   " }; assert.equal(countChosen(S, c), 2, "an emptied title does not count"); assert.equal("title" in buildApplyBody(S, c)!, false);
  const all = selectAll(S, emptyChoice(S), true); assert.equal(countChosen(S, all), 6);
  assert.deepEqual(buildApplyBody(S, all), { title: "Rappeler la banque", tags: ["banque", "triplex"], destination: { section: "projects", parentId: PARENT }, relations: [{ pageId: REL, reason: "Même financement." }], summary: "Rappeler la banque pour la garantie de taux." });
  assert.equal(countChosen(S, selectAll(S, all, false)), 0); assert.deepEqual(buildApplyBody(S, { ...emptyChoice(S), destination: true }), { destination: { section: "projects", parentId: PARENT } });
  assert.deepEqual(buildApplyBody(S, { ...emptyChoice(S), tags: { ghost: true } }), null, "a tick on something the server did not offer is ignored");
  assert.equal(destinationLabel(S.destination!), "Projects › Refinancement"); assert.equal(destinationLabel({ section: "research", parentId: null, parentTitle: null }), "Research");
});
test("errors are worded for the owner, and say whether a retry makes sense", () => {
  assert.deepEqual([suggestionError({ status: 503, code: "no_model" }).title, suggestionError({ status: 503, code: "no_model" }).retry], ["No AI model is available", false]);
  assert.equal(suggestionError({ status: 502, code: "provider_error", message: "The AI provider failed: 529" }).hint, "The AI provider failed: 529"); assert.equal(suggestionError({ status: 502, code: "refused" }).title, "The model declined this capture");
  assert.equal(suggestionError({ status: 409, code: "not_in_inbox" }).retry, false); assert.equal(suggestionError({ status: 409, code: "conflict" }).retry, true); assert.equal(suggestionError({ status: 0, code: "network" }).title, "No connection");
  assert.equal(suggestionError({ status: 400, code: "bad_relation" }).title, "A suggested page no longer exists"); assert.equal(suggestionError({ status: 500, message: "boom" }).hint, "boom"); assert.equal(suggestionError(null).retry, true);
});
test("a body built by the checklist is accepted by the server, applies exactly the chosen subset and is fully undone", async () => {
  const [w] = await db.select().from(schema.workspaces).limit(1); assert.ok(w); const ws = w.id;
  const parent = await createPage(ws, { title: `Projet ${TAG}`, section: "projects" }); made.push(parent.id); const rel = await createPage(ws, { title: `Lié ${TAG}` }); made.push(rel.id);
  const cap = await capture(ws, { kind: "note", text: `capture brute ${TAG}\nSeconde ligne.` }); made.push(cap.id); const before = await getPage(ws, cap.id);
  const offered: Suggestions = { title: { value: `Capture propre ${TAG}`, current: cap.title }, tags: [{ name: `a${TAG}`, existing: false }, { name: `b${TAG}`, existing: false }], destination: { section: "projects", parentId: parent.id, parentTitle: parent.title }, relations: [{ pageId: rel.id, title: rel.title, icon: null, reason: "Même sujet." }], summary: "Résumé proposé." };
  // the owner keeps the title (edited), one tag out of two, the relation and the summary — NOT the destination
  const choice = { ...emptyChoice(offered), title: true, titleValue: `Titre choisi ${TAG}`, tags: { [`a${TAG}`]: true }, relations: { [rel.id]: true }, summary: true };
  const r = await applySuggestions(ws, cap.id, buildApplyBody(offered, choice)!);
  assert.deepEqual([...r.applied].sort(), ["relations", "summary", "tags", "title"]); assert.equal(r.filed, false);
  const p = await getPage(ws, cap.id); assert.equal(p.title, `Titre choisi ${TAG}`); assert.ok(p.inboxAt, "not moved: the destination was not ticked"); assert.equal(p.parentId, null); assert.deepEqual(await pageTags(cap.id), [`a${TAG}`]);
  const first = (p.content as unknown as PMNode).content![0]; assert.equal(first.type, "aiBlock"); assert.equal(first.attrs!.action, "summary", "the applied summary stays visibly AI");
  assert.equal((await db.select().from(schema.knowledgeEdges).where(and(eq(schema.knowledgeEdges.fromId, cap.id), eq(schema.knowledgeEdges.toId, rel.id)))).length, 1);
  assert.deepEqual(await undoInboxAction(ws, r.actionId), { ok: true, already: false });
  const u = await getPage(ws, cap.id); assert.equal(u.title, before.title); assert.deepEqual(await pageTags(cap.id), []); assert.equal((u.content as unknown as PMNode).content!.some((n) => n.type === "aiBlock"), false); assert.ok(u.inboxAt);
  assert.equal((await db.select().from(schema.knowledgeEdges).where(eq(schema.knowledgeEdges.fromId, cap.id))).length, 0);
  // ticking the destination files the capture; undo brings it back
  const f = await applySuggestions(ws, cap.id, buildApplyBody(offered, { ...emptyChoice(offered), destination: true })!); assert.equal(f.filed, true); const filed = await getPage(ws, cap.id); assert.equal(filed.inboxAt, null); assert.equal(filed.parentId, parent.id);
  await undoInboxAction(ws, f.actionId); assert.ok((await getPage(ws, cap.id)).inboxAt);
});
