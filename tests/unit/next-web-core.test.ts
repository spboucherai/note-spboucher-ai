/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-web-core.test.ts
 * Description      : pure logic of the web workstream of SP Note Next
 *                    Generation — command registry + fuzzy search,
 *                    unknown-content boxing (round-trip), Markdown forms of the
 *                    new nodes (SPEC §2), sha256 preview hash, live-view row
 *                    normalisation, WCAG contrast of the tokens.
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
import { execFileSync } from "node:child_process";
import { fuzzyMatch, fuzzyRank, registerCommands, availableCommands, getCommands, _resetCommands, pushRecent, recencyBoost, type RecentEntry } from "../../src/lib/client/commands";
import { wrapUnknown, unwrapUnknown, type SchemaInfo } from "../../src/lib/editor/unknown";
import { markdownToDoc, docToMarkdown, expandNextNodes } from "../../src/lib/editor/markdown-client";
import { sha256Hex } from "../../src/lib/editor/hash";
import { queryBody, normaliseQueryResult, groupByStatus, isOverdue } from "../../src/lib/editor/query";
import { NEXT_NODES } from "../../src/lib/editor/next-node-defs";

test("fuzzy search: exact > prefix > substring > subsequence; accents and case ignored; non-matches rejected", () => {
  const s = (q: string, t: string) => fuzzyMatch(q, t)?.score ?? -1;
  assert.ok(s("home", "Home") > s("home", "Homework") && s("home", "Homework") > s("home", "Go home") && s("home", "Go home") > s("hm", "Home"));
  assert.equal(fuzzyMatch("xyz", "Home"), null); assert.equal(fuzzyMatch("", "anything")!.score, 0);
  assert.ok(fuzzyMatch("references", "Références") !== null, "accent-insensitive"); assert.ok(fuzzyMatch("REF", "références"));
  assert.deepEqual(fuzzyMatch("np", "New page")!.positions, [0, 4], "word-boundary initials are preferred");
  assert.ok(s("np", "New page") > s("np", "snapshot"), "initials beat a mid-word subsequence");
  assert.ok(fuzzyMatch("dark mode", "Dark theme mode sombre"), "multi-word, order-free"); assert.equal(fuzzyMatch("dark zzz", "Dark theme"), null);
  assert.ok(fuzzyMatch("abc", "a-b-c")!.positions.length === 3);
});
test("fuzzy rank: title beats keywords, boost applies to matches only, stable order, limit", () => {
  const items = [{ t: "Trash", k: "deleted" }, { t: "Insert diagram", k: "mermaid flowchart" }, { t: "Diagram notes", k: "" }, { t: "Settings", k: "diagram" }];
  const r = fuzzyRank("diagram", items, (i) => ({ title: i.t, keywords: i.k }));
  assert.deepEqual(r.map((x) => x.item.t), ["Diagram notes", "Insert diagram", "Settings"]);
  assert.equal(fuzzyRank("diagram", items, (i) => ({ title: i.t, keywords: i.k }), (i) => (i.t === "Settings" ? 1000 : 0))[0].item.t, "Settings");
  assert.equal(fuzzyRank("", items, (i) => ({ title: i.t })).length, 4); assert.equal(fuzzyRank("", items, (i) => ({ title: i.t }), undefined, 2).length, 2);
  assert.equal(fuzzyRank("zzz", items, (i) => ({ title: i.t })).length, 0);
});
test("command registry: register / replace / unregister, availability, recents", () => {
  _resetCommands(); let ran = 0;
  const off = registerCommands([{ id: "a", title: "Alpha", group: "G", run: () => { ran++; } }, { id: "b", title: "Beta", group: "G", when: () => false, run: () => {} }]);
  assert.equal(getCommands().length, 2); assert.deepEqual(availableCommands().map((c) => c.id), ["a"]);
  const off2 = registerCommands([{ id: "a", title: "Alpha 2", group: "G", run: () => {} }]); assert.equal(getCommands().find((c) => c.id === "a")!.title, "Alpha 2");
  off(); assert.deepEqual(getCommands().map((c) => c.id), ["a"], "the first registration does not remove the command that replaced it"); off2(); assert.equal(getCommands().length, 0);
  let rec: RecentEntry[] = []; for (let i = 0; i < 15; i++) rec = pushRecent(rec, { kind: "command", id: `c${i}` }, i); rec = pushRecent(rec, { kind: "command", id: "c10" }, 99);
  assert.equal(rec.length, 12); assert.equal(rec[0].id, "c10"); assert.equal(rec.filter((r) => r.id === "c10").length, 1);
  assert.ok(recencyBoost(rec, "command", "c10") > recencyBoost(rec, "command", "c14")); assert.equal(recencyBoost(rec, "page", "c10"), 0);
});

const schema: SchemaInfo = { nodes: new Map([["doc", { attrs: new Set<string>(), inlineContent: false }], ["paragraph", { attrs: new Set(["id", "textAlign"]), inlineContent: true }], ["text", { attrs: new Set<string>(), inlineContent: false }], ["callout", { attrs: new Set(["id", "kind", "icon"]), inlineContent: false }], ["horizontalRule", { attrs: new Set<string>(), inlineContent: false }]]), marks: new Map([["bold", new Set<string>()], ["link", new Set(["href"])]]) };
test("unknown content is boxed and comes back byte-identical (node types, marks, attrs)", () => {
  const doc = { type: "doc", content: [
    { type: "paragraph", attrs: { id: "p1", futureAttr: { a: 1 } }, content: [{ type: "text", text: "a", marks: [{ type: "bold" }, { type: "sparkle", attrs: { level: 3 } }] }, { type: "hologram", attrs: { z: [1, 2] } }, { type: "text", text: "b", marks: [{ type: "link", attrs: { href: "https://x.y", futureRel: "z" } }] }] },
    { type: "timeMachine", attrs: { at: "2030-01-01", nested: { deep: [1, { k: "v" }] } }, content: [{ type: "paragraph", content: [{ type: "text", text: "inside" }] }] },
    { type: "callout", attrs: { kind: "note", icon: "💡", id: "c1" }, content: [{ type: "futureBlock", attrs: { x: 1 } }, { type: "paragraph" }] },
    { type: "horizontalRule" },
  ] };
  const before = JSON.stringify(doc);
  const { doc: boxed, report } = wrapUnknown(doc, schema);
  assert.equal(JSON.stringify(doc), before, "the input is never mutated");
  assert.deepEqual(report.nodes.sort(), ["futureBlock", "hologram", "timeMachine"]); assert.deepEqual(report.marks.sort(), ["link", "sparkle"]); assert.deepEqual(report.attrs, ["futureAttr on paragraph"]);
  const b = boxed as any; assert.equal(b.content[1].type, "unknownBlock"); assert.equal(b.content[0].content[1].type, "unknownInline"); assert.equal(b.content[2].content[0].type, "unknownBlock");
  assert.deepEqual(b.content[0].attrs, { id: "p1", xattrs: { futureAttr: { a: 1 } } }); assert.equal(b.content[0].content[0].marks[1].type, "unknownMark");
  // what ProseMirror emits: xattrs on every block (null when nothing extra), even on nodes that had no attrs
  b.content[3] = { type: "horizontalRule", attrs: { xattrs: null } }; b.content[2] = { ...b.content[2], attrs: { ...b.content[2].attrs, xattrs: null } };
  assert.equal(JSON.stringify(unwrapUnknown(boxed)), before, "byte-identical after the round trip");
  const clean = { type: "doc", content: [{ type: "paragraph", attrs: { id: "x", textAlign: null }, content: [{ type: "text", text: "plain", marks: [{ type: "bold" }] }] }] };
  assert.equal(wrapUnknown(clean, schema).doc, clean, "a fully known document is returned as is (same reference)");
  assert.equal(unwrapUnknown(clean), clean);
  assert.deepEqual(unwrapUnknown({ type: "doc", content: [{ type: "paragraph", attrs: { id: "x", xattrs: null } }] }), { type: "doc", content: [{ type: "paragraph", attrs: { id: "x" } }] }, "the reserved key never reaches the stored document");
});

test("Markdown forms of the new nodes (SPEC §2): export, and import where the form identifies the node", () => {
  const P = "11111111-2222-4333-8444-555555555555", F = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const doc = { type: "doc", content: [
    { type: "mermaid", attrs: { code: "flowchart LR\n  A --> B", preview: null, previewHash: null } },
    { type: "runCode", attrs: { language: "javascript", code: "console.log(1)", output: { text: "1", error: false, ms: 2, at: "2026-11-19T00:00:00.000Z" } } },
    { type: "chart", attrs: { kind: "bar", title: "Sales", columns: ["Q", "V"], rows: [["Q1", 3], ["Q2", null]], x: "Q", y: ["V"], source: null } },
    { type: "drawing", attrs: { ink: F, preview: F, pk: null, width: 10, height: 10, background: "none" } },
    { type: "pdf", attrs: { attachmentId: F, name: "paper.pdf", page: 2, annotations: [{ id: "a1", page: 3, kind: "highlight", color: "#ffee00", rects: [[0, 0, 1, 1]], text: "key claim", note: "check", createdAt: "x" }] } },
    { type: "audio", attrs: { attachmentId: F, duration: 70, title: "Memo", recordedAt: null, transcript: [{ t: 0, text: "hello" }, { t: 65, text: "world" }], transcriptStatus: "done", transcriptEngine: null, summary: null } },
    { type: "queryView", attrs: { source: "tasks", databaseId: null, viewId: null, filter: {}, layout: "list", limit: 25, title: "Open tasks" } },
    { type: "blockRef", attrs: { pageId: P, blockId: "blk_1-x", mode: "embed" } },
    { type: "paragraph", content: [{ type: "text", text: "As shown " }, { type: "citation", attrs: { refId: null, locator: "p. 12", label: "Gorton 2019" } }, { type: "text", text: "." }] },
    { type: "bibliography", attrs: { style: "apa", title: "Références" } },
    { type: "canvasLink", attrs: { pageId: P } },
  ] };
  const md = docToMarkdown(doc);
  for (const part of ["```mermaid\nflowchart LR\n  A --> B\n```", "```javascript\nconsole.log(1)\n```", "```output\n1\n```", "Sales\n", "| Q | V |", "| Q1 | 3 |", `![Dessin](/api/files/${F})`, `[PDF: paper.pdf](/api/files/${F})`, "> p.3 — key claim — check", `[Audio: Memo](/api/files/${F})`, "[00:00] hello", "[01:05] world", "[Vue: Open tasks]", `[[${P}#blk_1-x]]`, "[@Gorton 2019, p. 12]", "## Références", `[Canvas](/p/${P})`]) assert.ok(md.includes(part), `export contains ${JSON.stringify(part)}\n---\n${md}`);
  assert.equal(expandNextNodes({ type: "doc", content: [{ type: "paragraph" }] }).content.length, 1);
  const back = markdownToDoc(md); const types = back.map((n) => n.type);
  for (const t of ["mermaid", "runCode", "drawing", "pdf", "audio", "queryView", "blockRef", "canvasLink"]) assert.ok(types.includes(t), `import produces ${t}: ${types.join(",")}`);
  const get = (t: string) => back.find((n) => n.type === t)!.attrs!;
  assert.equal(get("mermaid").code, "flowchart LR\n  A --> B"); assert.deepEqual([get("runCode").language, get("runCode").code, get("runCode").output.text], ["javascript", "console.log(1)", "1"]);
  assert.deepEqual([get("blockRef").pageId, get("blockRef").blockId], [P, "blk_1-x"]); assert.equal(get("canvasLink").pageId, P); assert.equal(get("queryView").title, "Open tasks");
  assert.deepEqual([get("pdf").attachmentId, get("pdf").name, get("pdf").annotations[0].page, get("pdf").annotations[0].text, get("pdf").annotations[0].note], [F, "paper.pdf", 3, "key claim", "check"]);
  assert.deepEqual(get("audio").transcript, [{ t: 0, text: "hello" }, { t: 65, text: "world" }]); assert.equal(get("drawing").preview, F);
  const cite = back.flatMap((n) => n.content ?? []).find((n) => n.type === "citation")!; assert.deepEqual(cite.attrs, { refId: null, label: "Gorton 2019", locator: "p. 12" });
  // a plain code fence stays a code block; ordinary prose is untouched
  assert.equal(markdownToDoc("```js\nx\n```")[0].type, "codeBlock"); assert.equal(markdownToDoc("Hello [world](https://a.b)")[0].type, "paragraph");
  assert.equal(new Set(NEXT_NODES.map((n) => n.name)).size, 11);
});
test("sha256 preview hash (hex, UTF-8) matches known vectors", async () => {
  assert.equal(await sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await sha256Hex("flowchart LR\n  é --> ü"), (await import("node:crypto")).createHash("sha256").update("flowchart LR\n  é --> ü", "utf8").digest("hex"));
});
test("live views: request body and the reader of the final POST /api/query shape", () => {
  assert.deepEqual(queryBody({ source: "tasks", databaseId: null, viewId: null, filter: { status: "open", tag: " " }, limit: 999 }), { source: "tasks", filter: { status: "open" }, limit: 200 });
  assert.deepEqual(queryBody({ source: "database", databaseId: "d", viewId: "v", filter: {}, limit: 0 }), { source: "database", databaseId: "d", viewId: "v", filter: {}, limit: 25 });
  const id = "11111111-2222-4333-8444-555555555555";
  // shape of docs/next/API-NEXT.md §4.7 (the real server answers are pinned in next-p-ra-live.test.ts)
  const answer = (source: string, columns: { key: string; label: string; type: string }[], rows: Record<string, unknown>[]) => ({ source, columns, rows, total: 9, limit: 25, table: { columns: columns.map((c) => c.label), rows: rows.map((r) => columns.map((c) => (r[c.key] ?? null) as string | number | null)) }, resolvedAt: "2026-11-19T18:30:22.355Z" });
  const r = normaliseQueryResult(answer("tasks", [{ key: "title", label: "Tâche", type: "text" }, { key: "status", label: "État", type: "select" }, { key: "dueAt", label: "Échéance", type: "date" }], [{ id: "t1", title: "Write", status: "todo", dueAt: "2020-01-01T12:00:00.000Z", pageId: id, blockId: "b" }, { id: "t2", title: "Done one", status: "done", dueAt: null, pageId: null }]), "tasks");
  assert.equal(r.total, 9); assert.equal(r.rows[0].href, `/p/${id}#block-b`); assert.equal(r.rows[1].done, true); assert.equal(r.rows[1].title, "Done one"); assert.equal(r.rows[1].href, null);
  assert.equal(isOverdue("2020-01-01", false), true); assert.equal(isOverdue("2020-01-01", true), false); assert.equal(isOverdue(null, false), false);
  assert.deepEqual(groupByStatus(r.rows).map((g) => [g.status, g.rows.length]), [["todo", 1], ["done", 1]]);
  assert.equal(normaliseQueryResult(answer("pages", [{ key: "title", label: "Titre", type: "page" }], [{ id, pageId: id, title: "A page" }]), "pages").rows[0].href, `/p/${id}`);
  const db = normaliseQueryResult(answer("database", [{ key: "p1", label: "Name", type: "page" }, { key: "p2", label: "Stage", type: "select" }], [{ id: "r", pageId: id, title: "Row 1", p1: "Row 1", p2: "Lead" }]), "database"); assert.deepEqual(db.columns.map((c) => c.label), ["Name", "Stage"]); assert.equal(db.rows[0].title, "Row 1"); assert.equal(db.rows[0].status, "Lead");
  assert.throws(() => normaliseQueryResult(null, "tasks"), /Unexpected answer/); assert.throws(() => normaliseQueryResult([{ id, title: "bare array" }], "pages"), /Unexpected answer/);
});
test("design tokens keep WCAG AA contrast in both themes (scripts/contrast.mjs)", () => {
  const out = JSON.parse(execFileSync("node", ["scripts/contrast.mjs", "--json"], { encoding: "utf8" }));
  const bad = out.rows.filter((r: any) => r.min > 0 && !r.ok); assert.deepEqual(bad, []);
  assert.ok(out.rows.filter((r: any) => r.min >= 4.5).length >= 30); assert.match(out.hexes.light.accent, /^#[0-9A-F]{6}$/);
});
