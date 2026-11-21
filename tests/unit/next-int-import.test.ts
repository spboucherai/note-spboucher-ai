/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-int-import.test.ts
 * Description      : 3.0 integration — a note exported to Markdown and imported
 *                    again keeps every block whose documented Markdown form
 *                    identifies its node (docs/next/EDITOR-NODES.md). The file
 *                    importer used to read `[[<page uuid>#<block>]]` as a wiki
 *                    link by title and `![Dessin](/api/files/<id>)` as an
 *                    image, so block references and drawings were lost. No
 *                    database.
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

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { toMarkdown } from "../../src/lib/editor/text";
import { mdToDoc, previewText, readMarkdown } from "../../src/lib/import/markdown";
import { normaliseFilter } from "../../src/lib/databases/filter-input";
import { pgIso, pgNum } from "../../src/lib/pg-values";
import { errorCode } from "../../src/lib/errors";

const fixture = JSON.parse(fs.readFileSync("tests/fixtures/next-nodes/all-nodes.json", "utf8"));
const ctx = { titles: new Map<string, string>([["known page", "99999999-9999-4999-8999-999999999999"]]) } as any;

test("export → file import keeps the nodes their Markdown form identifies", async () => {
  const md = toMarkdown(fixture); const doc = await mdToDoc(ctx, md); const types = (doc.content ?? []).map((n: any) => n.type);
  assert.deepEqual(types, ["mermaid", "drawing", "paragraph", "table", "queryView", "paragraph", "heading", "pdf", "blockRef", "runCode", "audio", "canvasLink"]);
  const by = (t: string) => (doc.content ?? []).find((n: any) => n.type === t)!.attrs as any;
  assert.deepEqual([by("blockRef").pageId, by("blockRef").blockId], ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "par0000009"]);
  assert.deepEqual([by("drawing").preview, by("drawing").ink], ["11111111-1111-4111-8111-111111111111", null], "a drawing comes back with its preview only");
  assert.equal(by("canvasLink").pageId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"); assert.equal(by("pdf").attachmentId, "33333333-3333-4333-8333-333333333333"); assert.equal(by("audio").transcript.length, 3);
  assert.match(by("mermaid").code, /graph TD/); assert.equal(by("runCode").output.text, "6");
});
test("wiki links by title and ordinary images are still imported as before", async () => {
  const doc = await mdToDoc(ctx, "See [[Known page]] and [[Unknown page|alias]].\n\n![Photo](https://example.org/a.png)\n\n![Dessin](https://example.org/not-a-drawing.png)\n");
  const flat = JSON.stringify(doc); assert.match(flat, /"type":"mention","attrs":\{"id":"99999999-9999-4999-8999-999999999999"/); assert.match(flat, /alias/); assert.equal((flat.match(/"type":"image"/g) ?? []).length, 2); assert.doesNotMatch(flat, /"type":"drawing"/);
  assert.equal(previewText("Before.\n\n[[aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#par0000009]]\n\nAfter [[Title]].").replace(/\s+/g, " ").trim(), "Before. After Title.", "the preview text is the text the imported page will hold (a block reference has none)");
});
test("a first paragraph that looks like `Key: value` is text when the file has front matter; a Notion export still gives properties", () => {
  const own = readMarkdown("---\ntitle: My note\nid: 99999999-9999-4999-8999-999999999999\n---\n# My note\n\nNote: this first paragraph must survive.\n\nSecond paragraph.\n", "my-note.md");
  assert.equal(own.title, "My note"); assert.deepEqual(own.nh.props, {}); assert.match(own.body, /^Note: this first paragraph must survive\./); assert.doesNotMatch(own.body, /^# My note/);
  const notion = readMarkdown("# Roadmap\n\nStatus: Doing\nOwner: SPB\n\nBody text.\n", "Roadmap abc123.md");
  assert.equal(notion.title, "Roadmap"); assert.deepEqual(notion.nh.props, { Status: "Doing", Owner: "SPB" }); assert.equal(notion.body.trim(), "Body text.");
});
test("database filter input: a bare rule is wrapped, groups pass, anything else is refused (never dropped)", () => {
  const rule = { property: "p", op: "eq", value: 1 };
  assert.deepEqual(normaliseFilter(rule), { and: [rule] }); assert.deepEqual(normaliseFilter({ or: [rule, { and: [rule] }] }), { or: [rule, { and: [rule] }] });
  assert.deepEqual(normaliseFilter({}), {}); assert.equal(normaliseFilter(null), null); assert.equal(normaliseFilter(undefined), undefined);
  for (const bad of [{ foo: 1 }, "x", 3, [rule], { and: [rule], property: "p" }, { property: "p" }, { and: "x" }]) assert.throws(() => normaliseFilter(bad), (e: any) => e.status === 400 && e.code === "bad_filter", JSON.stringify(bad));
});
test("JSON-safe PostgreSQL values and default error codes", () => {
  assert.equal(pgIso("2026-11-19 13:45:47.060354-05"), "2026-11-19T18:45:47.060Z"); assert.equal(pgIso("2026-11-19 13:45:47+00"), "2026-11-19T13:45:47.000Z"); assert.equal(pgIso("2026-11-19 13:45:47.5+0530"), "2026-11-19T08:15:47.500Z");
  assert.equal(pgIso("2026-11-19"), "2026-11-19T00:00:00.000Z"); assert.equal(pgIso(null), null); assert.equal(pgIso(new Date(0)), "1970-01-01T00:00:00.000Z"); assert.equal(pgIso("2026-11-19T18:45:47.060Z"), "2026-11-19T18:45:47.060Z");
  assert.deepEqual([pgNum("20002"), pgNum(null), pgNum(7), pgNum("x")], [20002, 0, 7, 0]);
  assert.deepEqual([errorCode(400), errorCode(404), errorCode(409), errorCode(404, "not_canvas"), errorCode(500), errorCode(418)], ["bad_request", "not_found", "invalid_state", "not_canvas", "internal", "error"]);
});
