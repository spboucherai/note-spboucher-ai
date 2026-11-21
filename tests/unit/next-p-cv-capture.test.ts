/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-p-cv-capture.test.ts
 * Description      : quick capture (SPEC §4.12). Pure rules of the capture
 *                    sheet (kind of a capture, smart paste, drop, share target,
 *                    size limits, inbox filters) and the server side of the 3.0
 *                    kinds (`screenshot`, `selection`, `document`, voice
 *                    `audio`, `idea` alias) on the scratch database. No
 *                    provider is called.
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
import { capture, listInbox, selectionSource } from "../../src/lib/inbox/service";
import { createPage, getPage } from "../../src/lib/pages/service";
import { storeFile } from "../../src/lib/files/storage";
import { extractPageRefs, docText, type PMNode } from "../../src/lib/editor/text";
import { acceptFiles, captureKind, classifyPaste, filterCounts, filterOf, firstUrl, isUrl, kindOfFiles, prefillFromDrop, prefillFromShare, screenshotName, MAX_TRANSCRIBE_BYTES, MAX_UPLOAD_BYTES, INBOX_FILTERS } from "../../src/lib/client/capture-logic";

const TAG = `pcv${Date.now().toString(36)}`; const made: string[] = []; const atts: string[] = [];
const f = (name: string, type: string, size = 1000) => ({ name, type, size });
const png = f("a.png", "image/png"), pdf = f("report.pdf", "application/pdf"), m4a = f("memo.m4a", "audio/mp4"), zip = f("x.zip", "application/zip"), docx = f("plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
const find = (n: PMNode | undefined, type: string): PMNode[] => [...(n?.type === type ? [n] : []), ...((n?.content ?? []) as PMNode[]).flatMap((c) => find(c, type))];
const ws = async () => { const [w] = await db.select().from(schema.workspaces).limit(1); assert.ok(w, "workspace missing: run `pnpm run bootstrap`"); return w.id; };
const mkAtt = async (w: string, name: string, mime: string) => { const buf = Buffer.from(`${name} ${TAG}`); const st = await storeFile(buf, name); const [a] = await db.insert(schema.attachments).values({ workspaceId: w, filename: name, mime, size: buf.length, sha256: st.sha256, storagePath: st.storagePath }).returning(); atts.push(a.id); return a; };
after(async () => {
  if (made.length) { await db.delete(schema.knowledgeEdges).where(inArray(schema.knowledgeEdges.fromId, made)); await db.delete(schema.attachments).where(inArray(schema.attachments.pageId, made)); await db.delete(schema.knowledgeEvents).where(inArray(schema.knowledgeEvents.pageId, made)); await db.delete(schema.pages).where(inArray(schema.pages.id, made)); await db.delete(schema.syncTombstones).where(inArray(schema.syncTombstones.id, made)); }
  if (atts.length) await db.delete(schema.attachments).where(inArray(schema.attachments.id, atts));
  await sql.end();
});

test("capture kind: text follows the chosen mode, files decide alone, a selection stays a selection", () => {
  assert.equal(captureKind({ mode: "note", text: "hello", files: [] }), "note"); assert.equal(captureKind({ mode: "idea", text: "what if", files: [] }), "idea"); assert.equal(captureKind({ mode: "tasks", text: "a\nb", files: [] }), "tasks");
  assert.equal(captureKind({ mode: "link", text: "https://example.org/a\nnote", files: [] }), "link"); assert.equal(captureKind({ mode: "link", text: "not a link", files: [] }), "note", "a link whose first line is no address is a note");
  assert.equal(captureKind({ mode: "note", text: "", files: [png] }), "photo"); assert.equal(captureKind({ mode: "note", text: "", files: [png], origin: "screenshot" }), "screenshot"); assert.equal(captureKind({ mode: "note", text: "", files: [m4a] }), "audio");
  assert.equal(captureKind({ mode: "note", text: "", files: [pdf] }), "document"); assert.equal(captureKind({ mode: "note", text: "", files: [pdf, docx] }), "document"); assert.equal(captureKind({ mode: "note", text: "", files: [zip] }), "file"); assert.equal(captureKind({ mode: "note", text: "", files: [png, pdf] }), "file", "mixed families → file");
  assert.equal(captureKind({ mode: "note", text: "the bug on the login page", files: [png], origin: "screenshot" }), "screenshot", "a described screenshot stays a screenshot");
  assert.equal(captureKind({ mode: "note", text: "meeting with Marie", files: [m4a] }), "audio"); assert.equal(captureKind({ mode: "tasks", text: "call\nwrite", files: [pdf] }), "tasks", "an explicit to-do wins over the attachment");
  assert.equal(captureKind({ mode: "note", text: "quoted words", files: [], origin: "selection" }), "selection"); assert.equal(captureKind({ mode: "link", text: "quoted words", files: [png], origin: "selection" }), "selection");
  assert.equal(captureKind({ mode: "note", text: "  ", files: [png], origin: "selection" }), "photo", "an emptied selection falls back to what is attached");
  assert.equal(kindOfFiles([]), "note"); assert.equal(kindOfFiles([f("scan.PDF", "")]), "document", "the extension is used when the browser gives no type"); assert.equal(kindOfFiles([f("voice.webm", "audio/webm;codecs=opus")]), "audio");
});
test("smart paste: an address is a link, an image a screenshot, a file a document, the rest text", () => {
  assert.deepEqual(classifyPaste({ text: " https://example.org/x?y=1 ", files: [] }), { as: "link", url: "https://example.org/x?y=1" }); assert.deepEqual(classifyPaste({ text: "www.example.org", files: [] }), { as: "link", url: "https://www.example.org" });
  assert.deepEqual(classifyPaste({ text: "see https://example.org for more", files: [] }), { as: "text" }, "an address inside a sentence is text"); assert.deepEqual(classifyPaste({ text: "", files: [] }), { as: "nothing" });
  assert.deepEqual(classifyPaste({ text: "ignored", files: [png] }), { as: "screenshot" }, "files win over the text flavour of the clipboard"); assert.deepEqual(classifyPaste({ text: "", files: [pdf] }), { as: "document" });
  assert.deepEqual(classifyPaste({ text: "", files: [m4a] }), { as: "audio" }); assert.deepEqual(classifyPaste({ text: "", files: [zip] }), { as: "file" });
  assert.equal(isUrl("http://a.b"), true); assert.equal(isUrl("a b"), false); assert.equal(firstUrl("read https://a.org/p). then"), "https://a.org/p"); assert.equal(firstUrl("nothing"), null);
  assert.equal(screenshotName("image/png", new Date(2026, 10, 19, 9, 5, 7)), "screenshot-20261119-090507.png"); assert.match(screenshotName("image/jpeg"), /\.jpg$/);
});
test("drop and share target: files, then an address, then text; a share without anything opens nothing", () => {
  const file = new File(["x"], "a.txt", { type: "text/plain" });
  assert.deepEqual(prefillFromDrop({ files: [file], uriList: "https://x.org", text: "t" }), { files: [file], origin: "drop" });
  assert.deepEqual(prefillFromDrop({ files: [], uriList: "# comment\r\nhttps://x.org/a\r\n", text: "https://x.org/a" }), { mode: "link", text: "https://x.org/a", origin: "drop" });
  assert.deepEqual(prefillFromDrop({ files: [], uriList: "https://x.org/a", text: "A title" }), { mode: "link", text: "https://x.org/a\nA title", origin: "drop" });
  assert.deepEqual(prefillFromDrop({ files: [], text: "  some dragged words " }), { mode: "note", text: "some dragged words", origin: "drop" }); assert.equal(prefillFromDrop({ files: [], uriList: "", text: " " }), null);
  assert.deepEqual(prefillFromDrop({ files: [], uriList: "javascript:alert(1)", text: "" }), null, "only http(s) addresses are links");
  assert.deepEqual(prefillFromShare({ title: "An article", text: "Worth reading", url: "https://example.org/a" }), { mode: "link", text: "https://example.org/a\nAn article\nWorth reading", origin: "share" });
  assert.deepEqual(prefillFromShare({ title: "An article", text: "https://example.org/a", url: "" }), { mode: "link", text: "https://example.org/a\nAn article", origin: "share" }, "Android puts the address in text");
  assert.deepEqual(prefillFromShare({ title: "Same", text: "Same", url: null }), { mode: "note", text: "Same", origin: "share" }); assert.deepEqual(prefillFromShare({ text: "just words" }), { mode: "note", text: "just words", origin: "share" });
  assert.equal(prefillFromShare({ title: "", text: " ", url: "" }), null); assert.deepEqual(prefillFromShare({ url: "javascript:alert(1)", text: "hi" }), { mode: "note", text: "hi", origin: "share" }, "an address that is not http(s) is dropped");
});
test("limits: over 200 MB is refused, an empty file too; audio over 25 MB is kept with a note about transcription", () => {
  const big = f("movie.mov", "video/quicktime", MAX_UPLOAD_BYTES + 1), empty = f("empty.txt", "text/plain", 0), long = f("lecture.m4a", "audio/mp4", MAX_TRANSCRIBE_BYTES + 1);
  const r = acceptFiles([big, empty, long, png]);
  assert.deepEqual(r.ok, [long, png]); assert.deepEqual(r.rejected.map((x) => x.name), ["movie.mov", "empty.txt"]); assert.match(r.rejected[0].reason, /over 200 MB/); assert.equal(r.notes.length, 1); assert.match(r.notes[0], /^lecture\.m4a \(25\.0 MB\).*25 MB a transcription accepts/);
  assert.deepEqual(acceptFiles([f("ok.m4a", "audio/mp4", MAX_TRANSCRIBE_BYTES)]).notes, []);
});
test("inbox filters: every stored kind falls in exactly one filter; ideas are notes with the 💡 icon", () => {
  assert.equal(filterOf({ kind: "photo" }), "image"); assert.equal(filterOf({ kind: "screenshot" }), "image"); assert.equal(filterOf({ kind: "file" }), "document"); assert.equal(filterOf({ kind: "document" }), "document"); assert.equal(filterOf({ kind: "audio" }), "audio");
  assert.equal(filterOf({ kind: "selection" }), "selection"); assert.equal(filterOf({ kind: "tasks" }), "tasks"); assert.equal(filterOf({ kind: "link" }), "link"); assert.equal(filterOf({ kind: "note", icon: "💡" }), "idea"); assert.equal(filterOf({ kind: "note", icon: null }), "note"); assert.equal(filterOf({ kind: null }), "note"); assert.equal(filterOf({ kind: "future-kind" }), "note");
  const c = filterCounts([{ kind: "note" }, { kind: "note", icon: "💡" }, { kind: "screenshot" }, { kind: "photo" }, { kind: "audio" }]);
  assert.equal(c.all, 5); assert.equal(c.note, 1); assert.equal(c.idea, 1); assert.equal(c.image, 2); assert.equal(c.audio, 1); assert.equal(c.link, 0); assert.equal(INBOX_FILTERS.map((x) => x.id).reduce((n, id) => n + (id === "all" ? 0 : c[id]), 0), 5);
});

test("server: a selection becomes a quotation with its source; an internal source is a backlink", async () => {
  const w = await ws(); const src = await createPage(w, { title: `Source ${TAG}`, content: { type: "doc", content: [{ type: "paragraph", attrs: { id: "blkSrc01" }, content: [{ type: "text", text: "Le taux fixe est garanti 90 jours." }] }] } }); made.push(src.id);
  const p = await capture(w, { kind: "selection", text: `Le taux fixe ${TAG}\nest garanti 90 jours.`, url: `/p/${src.id}#block-blkSrc01` }); made.push(p.id);
  assert.equal(p.captureKind, "selection"); assert.ok(p.inboxAt); assert.equal(p.title, `Le taux fixe ${TAG}`);
  const doc = p.content as unknown as PMNode; const quote = find(doc, "blockquote"); assert.equal(quote.length, 1); assert.equal(docText({ type: "doc", content: quote }).trim(), `Le taux fixe ${TAG}\nest garanti 90 jours.`);
  assert.deepEqual(extractPageRefs(doc), [src.id], "the source page is linked (it will show the capture among its backlinks)");
  const ext = await capture(w, { kind: "selection", text: `Quoted ${TAG}`, url: "https://example.org/article?x=1" }); made.push(ext.id);
  assert.match(JSON.stringify(ext.content), /"href":"https:\/\/example\.org\/article\?x=1"/);
  const bad = await capture(w, { kind: "selection", text: `No source ${TAG}`, url: "javascript:alert(1)" }); made.push(bad.id); assert.doesNotMatch(JSON.stringify(bad.content), /javascript|Source/); assert.equal(find(bad.content as unknown as PMNode, "blockquote").length, 1);
  await assert.rejects(capture(w, { kind: "selection", text: "   " }), /Nothing to capture/);
  assert.equal(selectionSource(`/p/${src.id}`), `/p/${src.id}`); assert.equal(selectionSource("/p/not-a-uuid"), null); assert.equal(selectionSource("/api/files/x"), null); assert.equal(selectionSource("ftp://x"), null); assert.equal(selectionSource(undefined), null);
});
test("server: screenshot → image, document → PDF block (or file card), voice → audio block; photo and file are unchanged; idea is a note with 💡", async () => {
  const w = await ws();
  const shot = await mkAtt(w, `shot-${TAG}.png`, "image/png"); const s = await capture(w, { kind: "screenshot", attachmentIds: [shot.id] }); made.push(s.id);
  assert.equal(s.captureKind, "screenshot"); assert.match(s.title, /^Screenshot · /); assert.equal(find(s.content as unknown as PMNode, "image")[0].attrs!.src, `/api/files/${shot.id}`);
  const pdfA = await mkAtt(w, `rapport-${TAG}.pdf`, "application/pdf"); const docA = await mkAtt(w, `notes-${TAG}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const d = await capture(w, { kind: "document", text: `Dossier ${TAG}`, attachmentIds: [pdfA.id, docA.id] }); made.push(d.id); const dd = d.content as unknown as PMNode;
  assert.equal(d.captureKind, "document"); assert.equal(d.title, `Dossier ${TAG}`); const pdfN = find(dd, "pdf"); assert.equal(pdfN.length, 1); const { id: _pid, ...pdfAttrs } = pdfN[0].attrs!; assert.deepEqual(pdfAttrs, { attachmentId: pdfA.id, name: `rapport-${TAG}.pdf`, page: 1, annotations: [] }); assert.ok(_pid, "block id assigned");
  assert.equal(find(dd, "fileBlock").length, 1); assert.equal(find(dd, "fileBlock")[0].attrs!.attachmentId, docA.id);
  const legacy = await capture(w, { kind: "file", attachmentIds: [pdfA.id] }); made.push(legacy.id); assert.equal(find(legacy.content as unknown as PMNode, "pdf").length, 0, "the 2.x kind `file` keeps its file card"); assert.equal(find(legacy.content as unknown as PMNode, "fileBlock").length, 1);
  const voice = await mkAtt(w, `voice-memo-2026-11-19-10-00.m4a`, "audio/mp4"); const song = await mkAtt(w, `Entrevue ${TAG}.mp3`, "audio/mpeg");
  const a = await capture(w, { kind: "audio", attachmentIds: [voice.id, song.id] }); made.push(a.id); const au = find(a.content as unknown as PMNode, "audio");
  assert.equal(a.captureKind, "audio"); assert.match(a.title, /^Voice memo · /); assert.equal(au.length, 2);
  const { id: _aid, title: t0, ...rest } = au[0].attrs!; assert.deepEqual(rest, { attachmentId: voice.id, duration: 0, recordedAt: null, transcript: [], transcriptStatus: "none", transcriptEngine: null, summary: null }); assert.match(t0, /^Voice memo · /); assert.equal(au[1].attrs!.title, `Entrevue ${TAG}`);
  const [row] = await db.select().from(schema.attachments).where(inArray(schema.attachments.id, [voice.id])); assert.equal(row.pageId, a.id, "attachments are re-parented to the capture");
  const asFile = await capture(w, { kind: "file", attachmentIds: [song.id] }); made.push(asFile.id); assert.equal(find(asFile.content as unknown as PMNode, "audio").length, 0);
  const idea = await capture(w, { kind: "idea", text: `Et si ${TAG}` }); made.push(idea.id); assert.equal(idea.captureKind, "note", "stored kinds stay the contract's"); assert.equal(idea.icon, "💡"); assert.equal((await getPage(w, idea.id)).title, `Et si ${TAG}`);
  const inbox = await listInbox(w); const mine = inbox.filter((i) => made.includes(i.id)); assert.equal(filterOf(mine.find((i) => i.id === idea.id)!), "idea"); assert.equal(filterOf(mine.find((i) => i.id === s.id)!), "image"); assert.equal(filterOf(mine.find((i) => i.id === a.id)!), "audio"); assert.equal(filterOf(mine.find((i) => i.id === d.id)!), "document");
  const ev = await db.select().from(schema.knowledgeEvents).where(inArray(schema.knowledgeEvents.pageId, [s.id, idea.id])); assert.deepEqual(ev.filter((e) => e.kind === "capture.created").map((e) => (e.data as any).kind).sort(), ["note", "screenshot"]);
});
