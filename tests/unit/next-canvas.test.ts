/**
 * Canvas (SPEC §3.4): a page of type `canvas` + one row, saved with baseVersion (409 with the server copy), validated, in the change
 * feed and in the journal (`canvas.edited`, coalesced). Runs against a *_dev database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index";
import { workspace, mk, doc, cleanup, code, kinds, eventsOf } from "../helpers/next";
import { getCanvas, putCanvas } from "../../src/lib/canvas/service";
import { canvasProblem, canvasRefs, EMPTY_CANVAS, CANVAS_LIMITS, type CanvasData } from "../../src/lib/canvas/format";
import { backlinks, softDeletePage, updatePage, getPage } from "../../src/lib/pages/service";

let ws: string; const PFX = "nx-canvas ·";
before(async () => { ws = await workspace(); }); after(() => cleanup(ws, PFX));
const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "text", x: 0, y: 0, w: 200, h: 80, z: 0, text: id, ...extra });
const canvas = (nodes: any[], edges: any[] = []): CanvasData => ({ ...EMPTY_CANVAS(), nodes, edges });

test("creating a page of type canvas creates its canvas: empty document, empty spn-canvas-1, version 1", async () => {
  const p = await mk(ws, `${PFX} new`, undefined, { type: "canvas" });
  assert.equal(p.type, "canvas"); assert.deepEqual(((await getPage(ws, p.id)).content as any).content.map((n: any) => n.type), ["paragraph"], "the page keeps an (empty) ProseMirror document");
  const c = await getCanvas(ws, p.id); assert.deepEqual(c.data, { format: "spn-canvas-1", nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }); assert.equal(c.version, 1); assert.ok(c.rev > 0); assert.equal(c.title, `${PFX} new`);
  const [row] = await db.select().from(schema.canvases).where(eq(schema.canvases.pageId, p.id)); assert.equal(row.workspaceId, ws);
  const plain = await mk(ws, `${PFX} not a canvas`, doc("x")); assert.equal(await code(getCanvas(ws, plain.id)), "not_canvas"); assert.equal(await code(getCanvas(ws, randomUUID())), "not_found");
  // a page whose type was set to canvas afterwards gets its row on first read
  await updatePage(ws, plain.id, { type: "canvas" }); assert.equal((await getCanvas(ws, plain.id)).version, 1);
});
test("save with baseVersion: one writer wins, the other gets 409 with the server copy; nothing is overwritten", async () => {
  const p = await mk(ws, `${PFX} cas`, undefined, { type: "canvas" });
  const a = await putCanvas(ws, p.id, canvas([node("n1")]), 1); assert.deepEqual([a.version, a.unchanged], [2, false]); assert.ok(a.rev > 0);
  let err: any; try { await putCanvas(ws, p.id, canvas([node("other")]), 1); } catch (e) { err = e; }
  assert.equal(err.status, 409); assert.equal(err.code, "conflict"); assert.equal(err.extra.server.version, 2); assert.deepEqual(err.extra.server.data.nodes.map((n: any) => n.id), ["n1"]); assert.ok(err.extra.server.updatedAt);
  assert.deepEqual((await getCanvas(ws, p.id)).data.nodes.map((n) => n.id), ["n1"]);
  const same = await putCanvas(ws, p.id, canvas([node("n1")]), 2); assert.deepEqual([same.version, same.unchanged], [2, true], "saving what is stored is a no-op");
  const r = await Promise.all([1, 2, 3, 4].map((i) => putCanvas(ws, p.id, canvas([node("n1"), node(`race${i}`)]), 2).then(() => 200, (e) => e.status)));
  assert.deepEqual([...r].sort(), [200, 409, 409, 409], "four simultaneous saves on the same base: exactly one wins"); assert.equal((await getCanvas(ws, p.id)).version, 3);
  await softDeletePage(ws, p.id); assert.equal(await code(putCanvas(ws, p.id, canvas([]), 3)), "not_found", "a trashed canvas is read-only"); assert.equal((await getCanvas(ws, p.id)).version, 3, "…but still readable");
});
test("the canvas document is validated: format, ids, geometry, edges, references, size", () => {
  assert.equal(canvasProblem(EMPTY_CANVAS()), null);
  const full = canvas([node("a", { kind: "page", pageId: randomUUID() }), node("b", { kind: "shape", shape: "diamond", color: "#3157d5" }), node("c", { kind: "hologram", custom: { x: 1 } })], [{ id: "e1", from: "a", to: "b", label: "mène à", kind: "arrow" }]);
  assert.equal(canvasProblem(full), null, "unknown node kinds and fields are kept");
  const bad = (d: any) => canvasProblem(d);
  assert.match(bad({ ...EMPTY_CANVAS(), format: "v0" })!, /format/); assert.match(bad({ format: "spn-canvas-1", nodes: [], edges: [] })!, /viewport/); assert.match(bad(canvas([node("a"), node("a")]))!, /duplicate node id/);
  assert.match(bad(canvas([{ id: "a", kind: "text", x: 0, y: 0, w: -1, h: 1 }]))!, /finite numbers/); assert.match(bad(canvas([{ id: "a", kind: "text", x: NaN, y: 0, w: 1, h: 1 }]))!, /finite numbers/);
  assert.match(bad(canvas([node("a", { pageId: "nope" })]))!, /pageId must be a uuid/); assert.match(bad(canvas([node("a", { url: "javascript:alert(1)" })]))!, /unsafe/);
  assert.match(bad(canvas([node("a")], [{ id: "e", from: "a", to: "ghost" }]))!, /from and to/); assert.match(bad(canvas([node("a"), node("b")], [{ id: "e", from: "a", to: "b" }, { id: "e", from: "b", to: "a" }]))!, /duplicate edge id/);
  assert.match(bad(canvas(Array.from({ length: CANVAS_LIMITS.nodes + 1 }, (_, i) => node(`n${i}`))))!, /at most 5000 nodes/);
  const p1 = randomUUID(), r1 = randomUUID(), a1 = randomUUID(); assert.deepEqual(canvasRefs(canvas([node("a", { pageId: p1 }), node("b", { pageId: p1 }), node("c", { refId: r1 }), node("d", { attachmentId: a1 })])), { pages: [p1], references: [r1], attachments: [a1] });
});
test("an invalid canvas is refused (400 / 413) and nothing is written", async () => {
  const p = await mk(ws, `${PFX} invalid`, undefined, { type: "canvas" });
  let e: any; try { await putCanvas(ws, p.id, { format: "nope" }, 1); } catch (x) { e = x; } assert.deepEqual([e.status, e.code], [400, "bad_canvas"]);
  try { await putCanvas(ws, p.id, canvas(Array.from({ length: CANVAS_LIMITS.nodes + 1 }, (_, i) => node(`n${i}`))), 1); } catch (x) { e = x; } assert.deepEqual([e.status, e.code], [413, "bad_canvas"]);
  assert.equal((await getCanvas(ws, p.id)).version, 1);
});
test("edits are journaled (coalesced), page cards become backlinks, and the canvas page moves in the feed", async () => {
  const target = await mk(ws, `${PFX} card target`, doc("t")); const p = await mk(ws, `${PFX} journal`, undefined, { type: "canvas" });
  const rev0 = (await getPage(ws, p.id)).rev;
  await putCanvas(ws, p.id, canvas([node("a", { kind: "page", pageId: target.id })]), 1); await putCanvas(ws, p.id, canvas([node("a", { kind: "page", pageId: target.id }), node("b")]), 2);
  const ev = (await eventsOf(p.id)).filter((e) => e.kind === "canvas.edited"); assert.equal(ev.length, 1, "two saves within 10 minutes are one canvas.edited"); assert.deepEqual([ev[0].entityKind, ev[0].data.nodes], ["canvas", 1]);
  assert.deepEqual((await backlinks(ws, target.id)).map((b) => b.id), [p.id], "the canvas is a backlink of the page it shows"); assert.ok((await getPage(ws, p.id)).rev > rev0);
  await putCanvas(ws, p.id, canvas([node("b")]), 3); assert.equal((await backlinks(ws, target.id)).length, 0, "removing the card removes the backlink");
  assert.deepEqual(await kinds(target.id), ["page.created"]);
  assert.equal((await db.select().from(schema.links).where(and(eq(schema.links.fromPageId, p.id), eq(schema.links.kind, "canvas")))).length, 0);
});
