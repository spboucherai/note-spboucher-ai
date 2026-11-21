/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-nodes.test.ts
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
 * 3.0 document nodes (SPEC §2): the Markdown / plain-text / HTML export is compared byte for byte with the fixtures that SPNotesCore
 * reuses (tests/fixtures/next-nodes), block ids (list items, new atoms, stability across saves), reference extraction, attr limits.
 * No database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { toMarkdown, docText, wordCount, ensureBlockIds, extractRefs, extractPageRefs, docBlocks, docTaskItems, docMarkers, type PMNode } from "../../src/lib/editor/text";
import { cellText, timecode, nextNodeProblem, NEXT_BLOCK_TYPES, NEXT_LIMITS } from "../../src/lib/editor/next-nodes";
import { docToHtml } from "../../src/lib/export/html";
import { rewriteDoc } from "../../src/lib/export/markdown";
import { assertDoc } from "../../src/lib/editor/validate";

const dir = path.join(process.cwd(), "tests/fixtures/next-nodes");
const fixtures = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");
const load = (name: string): PMNode => JSON.parse(read(`${name}.json`));

test("there are fixtures for every 3.0 node, each with its expected .md, .txt and .html", () => {
  assert.deepEqual(fixtures, ["all-nodes.json", "defaults.json", "edge-cases.json", "mixed-document.json"]);
  const types = new Set<string>(); const walk = (n: PMNode) => { types.add(n.type); (n.content ?? []).forEach(walk); }; walk(load("all-nodes"));
  for (const t of [...NEXT_BLOCK_TYPES, "citation"]) assert.ok(types.has(t), `all-nodes.json covers ${t}`);
  for (const f of fixtures) for (const ext of [".md", ".txt", ".html"]) assert.ok(fs.existsSync(path.join(dir, f.replace(".json", ext))), `${f} has ${ext}`);
});
for (const f of fixtures) {
  const name = f.replace(".json", "");
  test(`${name}: Markdown export is byte-identical to the fixture`, () => assert.equal(toMarkdown(load(name)), read(`${name}.md`)));
  test(`${name}: plain text (search index, word count) is byte-identical to the fixture`, () => assert.equal(docText(load(name)), read(`${name}.txt`)));
  test(`${name}: print HTML is byte-identical to the fixture`, () => assert.equal(docToHtml(load(name)).html + "\n", read(`${name}.html`)));
}
test("the exact Markdown of each node, as written in the contract", () => {
  const md = (n: PMNode) => toMarkdown({ type: "doc", content: [n] });
  assert.equal(md({ type: "mermaid", attrs: { code: "graph TD\n A-->B" } }), "```mermaid\ngraph TD\n A-->B\n```\n");
  assert.equal(md({ type: "runCode", attrs: { language: "python", code: "print(1)", output: { text: "1", error: false } } }), "```python\nprint(1)\n```\n\n```output\n1\n```\n");
  assert.equal(md({ type: "runCode", attrs: { language: "python", code: "print(1)", output: null } }), "```python\nprint(1)\n```\n");
  assert.equal(md({ type: "chart", attrs: { title: "T", columns: ["a", "b"], rows: [[1, null], ["x|y", 2.5]] } }), "T\n\n| a | b |\n| --- | --- |\n| 1 |  |\n| x\\|y | 2.5 |\n");
  assert.equal(md({ type: "drawing", attrs: { preview: "11111111-1111-4111-8111-111111111111" } }), "![Dessin](/api/files/11111111-1111-4111-8111-111111111111)\n");
  assert.equal(md({ type: "drawing", attrs: { preview: null } }), "[Dessin]\n");
  assert.equal(md({ type: "pdf", attrs: { attachmentId: "11111111-1111-4111-8111-111111111111", name: "a.pdf", annotations: [{ page: 2, text: "t", note: "n" }] } }), "[PDF: a.pdf](/api/files/11111111-1111-4111-8111-111111111111)\n\n> p.2 — t — n\n");
  assert.equal(md({ type: "audio", attrs: { attachmentId: "11111111-1111-4111-8111-111111111111", title: "Mémo", transcript: [{ t: 61, text: "un" }] } }), "[Audio: Mémo](/api/files/11111111-1111-4111-8111-111111111111)\n\n[01:01] un\n");
  assert.equal(md({ type: "queryView", attrs: { title: "Mes tâches" } }), "[Vue: Mes tâches]\n");
  assert.equal(md({ type: "blockRef", attrs: { pageId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", blockId: "b1" } }), "[[aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#b1]]\n");
  assert.equal(md({ type: "paragraph", content: [{ type: "citation", attrs: { refId: "11111111-1111-4111-8111-111111111111", label: "Doe 2020" } }] }), "[@Doe 2020]\n");
  assert.equal(md({ type: "paragraph", content: [{ type: "citation", attrs: { refId: "11111111-1111-4111-8111-111111111111", label: "" } }] }), "[@11111111-1111-4111-8111-111111111111]\n");
  assert.equal(md({ type: "bibliography", attrs: { title: "Sources" } }), "## Sources\n");
  assert.equal(md({ type: "canvasLink", attrs: { pageId: "11111111-1111-4111-8111-111111111111" } }), "[Canvas](/p/11111111-1111-4111-8111-111111111111)\n");
});
test("cells and time codes follow the documented number rules", () => {
  assert.deepEqual([3, 3.0, 0.1, 1e21, -0, 1.5e-7, NaN, Infinity, null, undefined, true, "a\nb"].map(cellText), ["3", "3", "0.1", "1e+21", "0", "1.5e-7", "", "", "", "", "true", "a b"]);
  assert.deepEqual([0, 59.99, 60, 3599, 7503.9, -5, NaN, "12"].map(timecode), ["00:00", "00:59", "01:00", "59:59", "125:03", "00:00", "00:00", "00:00"]);
});
test("transcript and annotation text are indexed; ids and time codes are not", () => {
  const txt = docText(load("all-nodes"));
  assert.match(txt, /On commence par les résultats du modèle\./); assert.match(txt, /Volatility clustering is pervasive\./); assert.match(txt, /À citer dans l'introduction/);
  assert.doesNotMatch(txt, /11111111|aaaaaaaa|\[00:12\]/); assert.ok(wordCount(txt) > 60);
  const blocks = docBlocks(load("all-nodes")); assert.ok(blocks.find((b) => b.type === "audio" && b.id === "aud0000001" && /Bonjour/.test(b.text)), "an audio node is a search chunk with its block id");
  assert.ok(blocks.find((b) => b.type === "pdf" && b.id === "pdf0000001")); assert.ok(!blocks.find((b) => b.type === "blockRef"), "a block reference has no text of its own");
});
test("an unknown node round-trips untouched and is never rejected", () => {
  const d = load("edge-cases"); const future = d.content!.find((n) => n.type === "futureNode")!;
  assert.doesNotThrow(() => assertDoc({ type: "doc", content: [future, { type: "holo", attrs: { id: "h1", data: { deep: [1, { a: 2 }] } }, content: [{ type: "paragraph" }] }] }));
  const r = ensureBlockIds({ type: "doc", content: [future] } as PMNode); assert.equal(r.changed, false, "nothing is added to a node the server does not know"); assert.deepEqual(r.doc.content![0], future);
});
test("block ids: list items, task items and the new atoms get one; existing ids are kept", () => {
  const src: PMNode = { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }] }, { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "t" }] }] }] }, ...NEXT_BLOCK_TYPES.map((type) => ({ type, attrs: {} })), { type: "mermaid", attrs: { id: "keepme0001", code: "x" } }] };
  const { doc, changed } = ensureBlockIds(src); assert.equal(changed, true);
  assert.match(doc.content![0].content![0].attrs!.id, /^[\w-]{10}$/, "listItem"); assert.match(doc.content![1].content![0].attrs!.id, /^[\w-]{10}$/, "taskItem"); assert.equal(doc.content![1].content![0].attrs!.checked, false, "other attrs kept");
  for (let i = 0; i < NEXT_BLOCK_TYPES.length; i++) assert.match(doc.content![2 + i].attrs!.id, /^[\w-]{10}$/, NEXT_BLOCK_TYPES[i]);
  assert.equal(doc.content![doc.content!.length - 1].attrs!.id, "keepme0001");
  const ids: string[] = []; const walk = (n: PMNode) => { if (n.attrs?.id) ids.push(n.attrs.id); (n.content ?? []).forEach(walk); }; walk(doc); assert.equal(new Set(ids).size, ids.length, "unique in the document");
  assert.equal(ensureBlockIds(doc).changed, false, "idempotent");
});
test("block ids are stable: a document that comes back without its ids gets the same ones", () => {
  const stored = ensureBlockIds(load("mixed-document")).doc;
  const strip = (n: PMNode): PMNode => { const { id: _id, ...rest } = (n.attrs ?? {}) as Record<string, unknown>; return { ...n, ...(n.attrs ? { attrs: rest } : {}), ...(n.content ? { content: n.content.map(strip) } : {}) }; };
  const again = ensureBlockIds(strip(stored), stored); assert.equal(again.changed, true); assert.deepEqual(again.doc, stored, "every block finds its previous id by type + text");
  // an edited block gets a new id, its untouched neighbours keep theirs; an id-less new block never steals an id still present
  const edited = strip(stored); edited.content![1] = { type: "paragraph", content: [{ type: "text", text: "nouveau texte" }] };
  const e = ensureBlockIds(edited, stored).doc; assert.notEqual(e.content![1].attrs!.id, stored.content![1].attrs!.id); assert.equal(e.content![0].attrs!.id, stored.content![0].attrs!.id); assert.equal(e.content![6].attrs!.id, stored.content![6].attrs!.id);
  const dup: PMNode = { type: "doc", content: [stored.content![0], { type: "heading", attrs: { level: 1 }, content: stored.content![0].content }] };
  const d2 = ensureBlockIds(dup, stored).doc; assert.notEqual(d2.content![1].attrs!.id, d2.content![0].attrs!.id);
});
test("links, citations and attachments are extracted with their anchor blocks", () => {
  const r = extractRefs(load("mixed-document"));
  assert.deepEqual(r.pages.map((p) => p.pageId).sort(), ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"], "blockRef and canvasLink are page links");
  assert.deepEqual(r.pages.find((p) => p.pageId.startsWith("aaaa")), { pageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sourceBlockId: "m000000021", targetBlockId: "par0000009" });
  assert.deepEqual(r.references, [{ refId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", sourceBlockId: "m000000002" }], "one entry per reference, anchored to the first paragraph that cites it");
  assert.deepEqual(extractPageRefs(load("mixed-document")).sort(), r.pages.map((p) => p.pageId).sort(), "the 2.x helper sees the same pages");
  assert.deepEqual(extractRefs(load("all-nodes")).attachments.sort(), ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"]);
  const hrefDoc: PMNode = { type: "doc", content: [{ type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "/p/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#block-abc123" } }] }] }] };
  assert.deepEqual(extractRefs(hrefDoc).pages, [{ pageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sourceBlockId: "p1", targetBlockId: "abc123" }]);
});
test("task items and journal markers are read from the document", () => {
  const d = load("mixed-document");
  assert.deepEqual(docTaskItems(d), [{ blockId: "m000000006", taskId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", checked: false, text: "Relancer l'estimation", due: "2026-11-25", priority: "high" }, { blockId: "m000000008", taskId: null, checked: true, text: "Nettoyer les données", due: null, priority: null }]);
  assert.deepEqual(docMarkers(d), { ai: [{ blockId: "m000000018", model: "claude-x", action: "synthesis" }], decisions: [{ blockId: "m000000003", text: "On retient le modèle EGARCH." }] });
});
test("attr limits: sizes of rows, annotations, transcript and the shape of attachment ids", () => {
  const bad = (n: PMNode) => { try { assertDoc({ type: "doc", content: [n] }); return null; } catch (e: any) { return `${e.status} ${e.code}`; } };
  for (const f of ["all-nodes", "defaults", "mixed-document"]) assert.doesNotThrow(() => assertDoc(load(f)), `${f} is valid`);
  assert.equal(bad({ type: "pdf", attrs: { attachmentId: "not-a-uuid" } }), "400 bad_document");
  assert.equal(bad({ type: "drawing", attrs: { ink: "../../etc/passwd" } }), "400 bad_document");
  assert.equal(bad({ type: "audio", attrs: { attachmentId: "/api/files/11111111-1111-4111-8111-111111111111" } }), "400 bad_document", "an id, not a URL");
  assert.equal(bad({ type: "chart", attrs: { columns: ["a"], rows: Array.from({ length: NEXT_LIMITS.chartRows + 1 }, () => [1]) } }), "400 bad_document");
  assert.equal(bad({ type: "chart", attrs: { columns: ["a"], rows: [[{ nested: true }]] } }), "400 bad_document");
  assert.equal(bad({ type: "chart", attrs: { columns: ["a"], rows: Array.from({ length: NEXT_LIMITS.chartRows }, () => [1]) } }), null);
  assert.equal(bad({ type: "pdf", attrs: { annotations: Array.from({ length: NEXT_LIMITS.annotations + 1 }, (_, i) => ({ id: String(i), page: 1 })) } }), "400 bad_document");
  assert.equal(bad({ type: "audio", attrs: { transcript: Array.from({ length: NEXT_LIMITS.transcriptSegments + 1 }, () => ({ t: 0, text: "x" })) } }), "400 bad_document");
  assert.equal(bad({ type: "audio", attrs: { transcript: [{ t: 0, text: "x".repeat(NEXT_LIMITS.transcriptTextChars + 1) }] } }), "400 bad_document");
  assert.equal(bad({ type: "mermaid", attrs: { code: "x".repeat(NEXT_LIMITS.codeChars + 1) } }), "400 bad_document");
  assert.equal(bad({ type: "mermaid", attrs: { code: "x", previewHash: "zz" } }), "400 bad_document");
  assert.equal(bad({ type: "queryView", attrs: { limit: 100000 } }), "400 bad_document");
  assert.equal(bad({ type: "citation", attrs: { refId: "abc" } }), "400 bad_document");
  assert.equal(bad({ type: "mermaid", attrs: { code: "x", futureAttr: { anything: true } } }), null, "unknown attrs of a known node are accepted");
  assert.equal(nextNodeProblem({ type: "paragraph" }), null);
});
test("export resolvers reach the attachments of the new nodes (ZIP / standalone export)", () => {
  const seen: string[] = []; const out = rewriteDoc(load("all-nodes"), { file: (src) => { seen.push(src); return `files/${src.slice(-36)}.bin`; } });
  assert.ok(seen.includes("/api/files/33333333-3333-4333-8333-333333333333"));
  const md = toMarkdown(out); assert.match(md, /\[PDF: article\.pdf\]\(files\/33333333-3333-4333-8333-333333333333\.bin\)/); assert.match(md, /!\[Dessin\]\(files\/11111111-1111-4111-8111-111111111111\.bin\)/); assert.doesNotMatch(md, /__href/);
});
