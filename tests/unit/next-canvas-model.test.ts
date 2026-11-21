/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-canvas-model.test.ts
 * Description      : the pure model of the Infinite Canvas
 *                    (src/lib/canvas/model.ts): unknown-field preservation,
 *                    editing, z-order, hit-testing, snapping, group resize,
 *                    align / distribute, copy / paste, routing, three-way merge
 *                    (cases, shared fixtures, randomised properties, a
 *                    two-client protocol simulation), layouts (determinism,
 *                    fixtures), viewport mathematics, history, exports. No
 *                    database, no DOM.
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
import path from "node:path";
import * as M from "../../src/lib/canvas/model";
import type { CanvasData, CanvasEdge, CanvasNode } from "../../src/lib/canvas/model";

const node = (id: string, x = 0, y = 0, extra: Record<string, unknown> = {}): CanvasNode => ({ id, kind: "text", x, y, w: 100, h: 60, z: 0, text: id, ...extra });
const edge = (id: string, from: string, to: string, extra: Record<string, unknown> = {}): CanvasEdge => ({ id, from, to, ...extra });
const doc = (nodes: CanvasNode[], edges: CanvasEdge[] = [], extra: Record<string, unknown> = {}): CanvasData => ({ format: "spn-canvas-1", nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, ...extra });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/canvas", f), "utf8"));
const ids = (d: CanvasData) => d.nodes.map((n) => n.id);

const ALIEN: CanvasData = {
  format: "spn-canvas-1", theme: { grid: true, step: 8 }, futureTopLevel: [1, { deep: null }],
  nodes: [
    { id: "a", kind: "text", x: 10, y: 20.5, w: 200, h: 80, z: 0, text: "Bonjour", color: null, locked: true } as unknown as CanvasNode,
    { id: "b", kind: "shape", x: -300, y: 0, w: 120, h: 120, z: 2, shape: "diamond", color: "#3157D5" },
    { id: "c", kind: "hologram", x: 1000, y: 2, w: 3, h: 4, z: 1, payload: { deep: [1, { k: null }] } },
    { id: "d", kind: "page", x: 0, y: 0, w: 10, h: 10, z: 3, pageId: "7d0e0d3c-0000-4000-8000-000000000001" },
  ],
  edges: [{ id: "e1", from: "a", to: "b", label: "cause", kind: "arrow", color: "#ff0000", weight: 3 }, { id: "e2", from: "b", to: "c" }, { id: "e3", from: "c", to: "d", kind: "zigzag", label: null } as unknown as CanvasEdge],
  viewport: { x: -12.5, y: 40, zoom: 1.25, rotation: 0 } as CanvasData["viewport"],
};

test("unknown content survives load → edit → save: node kinds, node / edge / viewport fields, top-level keys, explicit nulls", () => {
  const loaded = M.readCanvas(clone(ALIEN)); assert.deepEqual(loaded, ALIEN, "reading changes nothing in a valid document");
  let d = M.updateNode(loaded, "a", { x: 11, text: "Salut" });
  d = M.moveNodes(d, ["c"], 5, 5); d = M.resizeNodes(d, ["b"], "se", 10, 10); d = M.bringToFront(d, ["a"]); d = M.alignNodes(d, ["a", "d"], "left");
  d = M.updateEdge(d, "e1", { label: "because" }); d = M.addNode(d, M.makeNode("math", { x: 0, y: 0 }, { latex: "x^2" }, "new1")); d = M.addEdge(d, { id: "e4", from: "new1", to: "c" });
  d = M.tidyLayout(d, { seed: 3 }); d = M.normalizeZ(d);
  const a = M.nodeById(d, "a")!, c = M.nodeById(d, "c")!;
  assert.equal(a.locked, true); assert.equal(a.color, null); assert.equal(a.text, "Salut"); assert.deepEqual(c.payload, { deep: [1, { k: null }] }); assert.equal(c.kind, "hologram");
  assert.deepEqual(M.edgeById(d, "e1"), { id: "e1", from: "a", to: "b", label: "because", kind: "arrow", color: "#ff0000", weight: 3 }); assert.deepEqual(M.edgeById(d, "e3"), ALIEN.edges[2]);
  assert.deepEqual([d.theme, d.futureTopLevel, (d.viewport as any).rotation], [ALIEN.theme, ALIEN.futureTopLevel, 0]);
  const { merged, conflicts } = M.mergeCanvas(ALIEN, d, M.updateNode(ALIEN, "d", { futureField: [1] }));
  assert.deepEqual(M.nodeById(merged, "c")!.payload, { deep: [1, { k: null }] }); assert.deepEqual((conflicts.find((c) => c.id === "d")!.remote as any).futureField, [1], "the other side's unknown field is carried by the conflict"); assert.deepEqual(merged.futureTopLevel, ALIEN.futureTopLevel);
  assert.deepEqual(M.nodeById(M.mergeCanvas(ALIEN, M.updateNode(ALIEN, "a", { x: 1 }), M.updateNode(ALIEN, "d", { futureField: [1] })).merged, "d")!.futureField, [1]);
  assert.equal(M.canvasProblem(merged), null, "still a valid spn-canvas-1 document");
  // history round trip returns the very same objects
  let h = M.createHistory(loaded); h = M.commit(h, d); h = M.undo(h); assert.equal(h.present, loaded); h = M.redo(h); assert.equal(h.present, d);
});
test("tolerant reading: missing arrays and viewport get defaults, unaddressable elements are dropped, the rest is kept", () => {
  assert.deepEqual(M.readCanvas({ format: "spn-canvas-1" }), M.emptyCanvas());
  assert.deepEqual(M.readCanvas(null), M.emptyCanvas());
  const r = M.readCanvas({ format: "spn-canvas-1", nodes: [node("a"), null, { kind: "text" }, 3], edges: "nope", viewport: { zoom: 0, x: "1", tilt: 2 }, extra: 1 });
  assert.deepEqual(ids(r), ["a"]); assert.deepEqual(r.edges, []); assert.deepEqual(r.viewport, { x: 0, y: 0, zoom: 1, tilt: 2 }); assert.equal(r.extra, 1);
});
test("jsonEqual ignores key order and undefined, distinguishes null from absent; ids are lower-case uuids; code-point order differs from UTF-16 order", () => {
  assert.ok(M.jsonEqual({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1, z: undefined })); assert.ok(!M.jsonEqual({ a: null }, {})); assert.ok(!M.jsonEqual([1, 2], [2, 1])); assert.ok(!M.jsonEqual({ a: 1 }, { a: 1, b: 2 })); assert.ok(M.jsonEqual(undefined, undefined)); assert.ok(!M.jsonEqual(undefined, null));
  const seen = new Set<string>(); for (let i = 0; i < 500; i++) { const id = M.newId(); assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); seen.add(id); } assert.equal(seen.size, 500);
  let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; assert.match(M.newId(rnd), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(["😀", "ﬁ", "b", "a", "Z", "ab", ""].sort(M.compareCodePoints), ["", "Z", "a", "ab", "b", "ﬁ", "😀"]); assert.deepEqual(["😀", "ﬁ"].sort(), ["😀", "ﬁ"], "the default JS order would put the emoji first");
});
test("editing: add raises z, duplicates are refused, removing a node removes its edges, edges need both ends, reorder moves in the array only", () => {
  let d = doc([node("a", 0, 0, { z: 4 }), node("b")]);
  d = M.addNode(d, node("c")); assert.equal(M.nodeById(d, "c")!.z, 5); assert.equal(M.addNode(d, node("c", 9, 9)), d, "same id: no-op");
  d = M.addEdge(d, edge("e1", "a", "c")); d = M.addEdge(d, edge("e2", "b", "c")); assert.equal(M.addEdge(d, edge("e3", "a", "ghost")), d); assert.equal(M.addEdge(d, edge("e1", "a", "b")), d);
  assert.equal(M.updateNode(d, "ghost", { x: 1 }), d); assert.equal(M.updateNode(d, "a", { id: "zzz" } as any).nodes[0].id, "a", "the id cannot be changed");
  assert.equal("text" in M.updateNode(d, "a", { text: undefined }).nodes[0], false, "an undefined patch value removes the key");
  const r = M.removeNodes(d, ["c"]); assert.deepEqual(ids(r), ["a", "b"]); assert.deepEqual(r.edges, []); assert.equal(M.removeNodes(d, ["ghost"]), d);
  assert.deepEqual(M.removeEdges(d, ["e1"]).edges.map((e) => e.id), ["e2"]); assert.deepEqual(M.danglingEdges({ ...d, nodes: d.nodes.slice(0, 2) }).map((e) => e.id), ["e1", "e2"]);
  const o = M.reorderNode(d, "c", 0); assert.deepEqual(ids(o), ["c", "a", "b"]); assert.deepEqual(o.nodes.map((n) => n.z).sort(), d.nodes.map((n) => n.z).sort()); assert.equal(M.reorderNode(d, "c", 99), d);
  const m = M.makeNode("shape", { x: 100, y: 100 }); assert.deepEqual([m.x, m.y, m.w, m.h, m.shape], [20, 40, 160, 120, "rect"]);
});
test("z-order: back-to-front by z then array order; front / back keep the relative order and touch only the moved nodes; step swaps neighbours", () => {
  const d = doc([node("a", 0, 0, { z: 1 }), node("b", 0, 0, { z: 0 }), node("c", 0, 0, { z: 1 }), node("d", 0, 0, { z: undefined })]);
  const order = (x: CanvasData) => M.backToFront(x).map((n) => n.id);
  assert.deepEqual(order(d), ["b", "d", "a", "c"]);
  const f = M.bringToFront(d, ["b", "a"]); assert.deepEqual(order(f), ["d", "c", "b", "a"]); assert.equal(f.nodes[2], d.nodes[2], "untouched nodes are the same objects"); assert.equal(M.bringToFront(f, ["b", "a"]), f, "already in front: no-op");
  const k = M.sendToBack(d, ["c"]); assert.deepEqual(order(k), ["c", "b", "d", "a"]); assert.equal(M.sendToBack(k, ["c"]), k);
  assert.deepEqual(order(M.stepZ(d, ["b"], 1)), ["d", "b", "a", "c"]); assert.deepEqual(order(M.stepZ(d, ["c"], -1)), ["b", "d", "c", "a"]); assert.equal(M.stepZ(d, ["c"], 1), d, "top node cannot go further up");
  assert.deepEqual(M.normalizeZ(d).nodes.map((n) => n.z), [2, 0, 3, 1]); const n = M.normalizeZ(M.normalizeZ(d)); assert.equal(M.normalizeZ(n), n);
});
test("hit-testing: front-most node wins, shapes use their real outline, marquee by intersection or containment, distance to a route", () => {
  const d = doc([node("under", 0, 0, { w: 200, h: 200, z: 0 }), node("over", 50, 50, { w: 100, h: 100, z: 5 }), node("ell", 300, 0, { kind: "shape", shape: "ellipse", w: 200, h: 100 }), node("dia", 300, 200, { kind: "shape", shape: "diamond", w: 100, h: 100 })]);
  assert.equal(M.nodeAt(d, { x: 60, y: 60 })!.id, "over"); assert.equal(M.nodeAt(d, { x: 10, y: 10 })!.id, "under"); assert.equal(M.nodeAt(d, { x: 250, y: 250 }), null);
  assert.equal(M.nodeAt(d, { x: 400, y: 50 })!.id, "ell"); assert.equal(M.nodeAt(d, { x: 304, y: 4 }), null, "corner of the ellipse's box is outside the ellipse"); assert.equal(M.nodeAt(d, { x: 304, y: 4 }, 30)!.id, "ell", "…but inside with a touch tolerance");
  assert.equal(M.nodeAt(d, { x: 350, y: 250 })!.id, "dia"); assert.equal(M.nodeAt(d, { x: 310, y: 210 }), null); assert.ok(M.pointInNode(d.nodes[3], { x: 300, y: 250 }), "the tip of the diamond belongs to it");
  assert.deepEqual(M.nodesInRect(d, { x: 40, y: 40, w: 20, h: 20 }).map((n) => n.id), ["under", "over"]); assert.deepEqual(M.nodesInRect(d, { x: 40, y: 40, w: 120, h: 120 }, true).map((n) => n.id), ["over"]);
  assert.deepEqual(M.contentBounds(d), { x: 0, y: 0, w: 500, h: 300 }); assert.equal(M.contentBounds(M.emptyCanvas()), null); assert.deepEqual(M.contentBounds(d, ["over"]), { x: 50, y: 50, w: 100, h: 100 });
  assert.equal(M.distanceToPolyline({ x: 5, y: 3 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]), 3); assert.equal(M.distanceToPolyline({ x: 13, y: 14 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]), 5); assert.equal(M.distanceToPolyline({ x: 0, y: 0 }, []), Infinity);
});
test("snapping: nearest alignment within the threshold on each axis, with guides spanning both rectangles; nothing beyond the threshold", () => {
  const others = [{ x: 0, y: 0, w: 100, h: 60 }, { x: 300, y: 200, w: 80, h: 80 }];
  const s = M.snapMove({ x: 103, y: 95, w: 50, h: 40 }, others, 6);
  assert.equal(s.dx, -3, "left edge snaps to the right edge of the first rectangle (100)"); assert.equal(s.dy, 0); assert.deepEqual(s.guides, [{ axis: "x", at: 100, from: 0, to: 135 }]);
  const c = M.snapMove({ x: 312, y: 50, w: 50, h: 40 }, others, 6); assert.equal(c.dx, 3, "centre (337) snaps to the centre of the second rectangle (340)"); assert.equal(c.guides[0].at, 340);
  const both = M.snapMove({ x: 2, y: 62, w: 100, h: 20 }, others, 6); assert.deepEqual([both.dx, both.dy, both.guides.length], [-2, -2, 2]);
  assert.deepEqual(M.snapMove({ x: 150, y: 120, w: 20, h: 20 }, others, 6), { dx: 0, dy: 0, guides: [] }); assert.deepEqual(M.snapMove({ x: 0, y: 0, w: 1, h: 1 }, [], 6).guides, []);
  assert.deepEqual([M.snapToGrid(13, 8), M.snapToGrid(-13, 8), M.snapToGrid(13, 0)], [16, -16, 13]);
});
test("group move and resize: proportional scaling from any handle, minimum size, no flip, aspect lock", () => {
  const d = doc([node("a", 0, 0, { w: 100, h: 100 }), node("b", 100, 100, { w: 100, h: 100 }), node("c", 500, 500)]);
  assert.deepEqual(M.moveNodes(d, ["a", "b"], 10.004, -5).nodes.map((n) => [n.x, n.y]), [[10, -5], [110, 95], [500, 500]]); assert.equal(M.moveNodes(d, ["a"], 0, 0), d); assert.equal(M.moveNodes(d, [], 5, 5), d);
  const se = M.resizeNodes(d, ["a", "b"], "se", 200, 100); assert.deepEqual(se.nodes.slice(0, 2).map((n) => [n.x, n.y, n.w, n.h]), [[0, 0, 200, 150], [200, 150, 200, 150]]); assert.equal(se.nodes[2], d.nodes[2]);
  const nw = M.resizeNodes(d, ["a", "b"], "nw", 100, 100); assert.deepEqual(nw.nodes.slice(0, 2).map((n) => [n.x, n.y, n.w, n.h]), [[100, 100, 50, 50], [150, 150, 50, 50]], "the opposite corner stays fixed");
  const tiny = M.resizeNodes(d, ["a"], "e", -1000, 0); assert.deepEqual([tiny.nodes[0].x, tiny.nodes[0].w], [0, M.MIN_NODE_SIZE], "never smaller than the minimum, never flipped");
  const w = M.resizeNodes(d, ["a"], "w", 1000, 0); assert.deepEqual([w.nodes[0].x, w.nodes[0].w], [100 - M.MIN_NODE_SIZE, M.MIN_NODE_SIZE]);
  const ar = M.resizeNodes(d, ["a"], "se", 100, 10, { keepAspect: true }); assert.deepEqual([ar.nodes[0].w, ar.nodes[0].h], [200, 200]);
  const side = M.resizeNodes(d, ["a"], "e", 100, 0, { keepAspect: true }); assert.deepEqual([side.nodes[0].x, side.nodes[0].y, side.nodes[0].w, side.nodes[0].h], [0, -50, 200, 200]);
  assert.equal(M.resizeNodes(d, ["a"], "se", 0, 0), d); assert.equal(M.resizeNodes(d, ["ghost"], "se", 5, 5), d);
  assert.deepEqual(M.resizeRect({ x: 0, y: 0, w: 10, h: 10 }, "n", 0, -5, 24, false), { x: 0, y: -5, w: 10, h: 15 });
});
test("align and distribute", () => {
  const d = doc([node("a", 0, 0, { w: 50, h: 50 }), node("b", 100, 30, { w: 100, h: 20 }), node("c", 400, 200, { w: 100, h: 100 }), node("z", 999, 999)]);
  const sel = ["a", "b", "c"]; const xy = (x: CanvasData) => x.nodes.slice(0, 3).map((n) => [n.x, n.y]);
  assert.deepEqual(xy(M.alignNodes(d, sel, "left")), [[0, 0], [0, 30], [0, 200]]); assert.deepEqual(xy(M.alignNodes(d, sel, "right")), [[450, 0], [400, 30], [400, 200]]); assert.deepEqual(xy(M.alignNodes(d, sel, "center")), [[225, 0], [200, 30], [200, 200]]);
  assert.deepEqual(xy(M.alignNodes(d, sel, "top")), [[0, 0], [100, 0], [400, 0]]); assert.deepEqual(xy(M.alignNodes(d, sel, "bottom")), [[0, 250], [100, 280], [400, 200]]); assert.deepEqual(xy(M.alignNodes(d, sel, "middle")), [[0, 125], [100, 140], [400, 100]]);
  assert.equal(M.alignNodes(d, ["a"], "left"), d); assert.equal(M.alignNodes(d, sel, "left").nodes[3], d.nodes[3]);
  assert.deepEqual(xy(M.distributeNodes(d, sel, "horizontal")), [[0, 0], [175, 30], [400, 200]], "equal gaps of 125"); assert.deepEqual(xy(M.distributeNodes(d, sel, "vertical")), [[0, 0], [100, 115], [400, 200]]); assert.equal(M.distributeNodes(d, ["a", "b"], "horizontal"), d);
});
test("copy / paste / duplicate: fresh ids, internal edges remapped, external edges left out, pasted in front with the stacking kept", () => {
  const d = doc([node("a", 0, 0, { z: 3, future: 1 }), node("b", 200, 0, { z: 1 }), node("c", 400, 0, { z: 2 })], [edge("e1", "a", "b", { label: "in", weight: 2 }), edge("e2", "b", "c")]);
  const clip = M.copyNodes(d, ["a", "b"]); assert.deepEqual(clip.edges.map((e) => e.id), ["e1"]);
  let i = 0; const p = M.pasteClip(d, clip, { x: 24, y: 24 }, () => `new${++i}`);
  assert.deepEqual(p.ids, ["new1", "new2"]); assert.deepEqual(ids(p.data), ["a", "b", "c", "new1", "new2"]);
  assert.deepEqual(p.data.nodes[3], { ...d.nodes[0], id: "new1", x: 24, y: 24, z: 5 }); assert.equal(p.data.nodes[4].z, 4, "b was under a: its copy stays under a's copy");
  assert.deepEqual(p.data.edges[2], { id: "new3", from: "new1", to: "new2", label: "in", weight: 2 }); assert.equal(p.data.edges.length, 3); assert.equal(M.canvasProblem(p.data), null);
  assert.deepEqual(M.pasteClip(M.emptyCanvas(), clip, { x: 0, y: 0 }).data.nodes.map((n) => n.z), [1, 0]);
});
test("tables are GFM in `text`: parse / serialise round trip (pipes, line breaks, ragged rows); labels name every kind", () => {
  const cells = [["Name", "Value"], ["a|b", "line1\nline2"], ["only"]]; const text = M.serializeTable(cells);
  assert.equal(text, "| Name | Value |\n| --- | --- |\n| a\\|b | line1<br>line2 |\n| only |  |"); assert.deepEqual(M.parseTable(text), [["Name", "Value"], ["a|b", "line1\nline2"], ["only", ""]]);
  assert.deepEqual(M.parseTable(M.emptyTable(2, 3)), [["", "", ""], ["", "", ""]]); assert.deepEqual(M.parseTable("no table here"), []); assert.deepEqual(M.parseTable(null), []);
  const t = (id: string) => ({ p1: "Project plan", r1: "Fama (1970)" })[id];
  assert.deepEqual([node("x", 0, 0, { text: "## Title\nbody" }), node("x", 0, 0, { kind: "page", pageId: "p1", text: undefined }), node("x", 0, 0, { kind: "reference", refId: "r1" }), node("x", 0, 0, { kind: "link", url: "https://a.b", text: "" }), node("x", 0, 0, { kind: "math", latex: "e^{i\\pi}" }), node("x", 0, 0, { kind: "table", text }), node("x", 0, 0, { kind: "shape", shape: "ellipse", text: "" }), node("x", 0, 0, { kind: "hologram", text: "" })].map((n) => M.nodeLabel(n, t)),
    ["Title", "Project plan", "Fama (1970)", "https://a.b", "e^{i\\pi}", "Name · Value", "Ellipse", "Card (hologram)"]);
});
test("routing: anchors sit on the real outline (rectangle, ellipse, diamond); straight, orthogonal, curved and self routes; arrowheads", () => {
  const a = node("a", 0, 0, { w: 100, h: 60 }), b = node("b", 300, 0, { w: 100, h: 60 }), below = node("c", 20, 300, { w: 100, h: 60 });
  assert.deepEqual(M.anchorToward(a, { x: 350, y: 30 }), { x: 100, y: 30 }); assert.deepEqual(M.anchorToward(a, { x: 50, y: -500 }), { x: 50, y: 0 }); assert.deepEqual(M.anchorToward(a, { x: 150, y: 130 }), { x: 80, y: 60 }, "leaves through the bottom side on a steep diagonal");
  assert.deepEqual(M.anchorToward(a, { x: 50, y: 30 }), { x: 50, y: 0 }, "degenerate direction: top centre");
  const ell = node("e", 0, 0, { kind: "shape", shape: "ellipse", w: 200, h: 100 }); const pe = M.anchorToward(ell, { x: 400, y: 350 }); assert.ok(Math.abs(((pe.x - 100) ** 2) / 100 ** 2 + ((pe.y - 50) ** 2) / 50 ** 2 - 1) < 1e-3, "on the ellipse");
  const dia = node("d", 0, 0, { kind: "shape", shape: "diamond", w: 100, h: 100 }); const pd = M.anchorToward(dia, { x: 150, y: 150 }); assert.deepEqual(pd, { x: 75, y: 75 }, "on the diamond's edge, not on its box corner");
  for (const n of [a, ell, dia]) for (let k = 0; k < 24; k++) { const ang = (k / 24) * Math.PI * 2; const c = M.centerOf(M.rectOf(n)); const p = M.anchorToward(n, { x: c.x + Math.cos(ang) * 1000, y: c.y + Math.sin(ang) * 1000 }); assert.ok(M.pointInNode(n, p, 0.02) && !M.pointInNode({ ...n, x: n.x + 2, y: n.y + 2, w: n.w - 4, h: n.h - 4 }, p), `anchor ${n.id} ${k} is on the border`); }
  const s = M.routeEdge(a, b); assert.deepEqual(s.points, [{ x: 100, y: 30 }, { x: 300, y: 30 }]); assert.equal(s.d, "M100 30 L300 30"); assert.equal(s.endAngle, 0); assert.deepEqual(s.label, { x: 200, y: 30 });
  const o = M.routeEdge(a, below, "orthogonal"); assert.deepEqual(o.points, [{ x: 50, y: 60 }, { x: 50, y: 180 }, { x: 70, y: 180 }, { x: 70, y: 300 }]); assert.equal(o.endAngle, Math.PI / 2); assert.deepEqual(o.label, { x: 60, y: 180 });
  const oh = M.routeEdge(b, a, "orthogonal"); assert.deepEqual([oh.points[0], oh.points[3]], [{ x: 300, y: 30 }, { x: 100, y: 30 }]); assert.equal(Math.abs(oh.endAngle), Math.PI);
  const c = M.routeEdge(a, below, "curved"); assert.equal(c.points.length, 25); assert.deepEqual([c.points[0], c.points[24]], [{ x: 50, y: 60 }, { x: 70, y: 300 }]); assert.match(c.d, /^M50 60 C50 180\.\d+ 70 179\.\d+ 70 300$/); assert.equal(c.endAngle, Math.PI / 2, "arrives perpendicular to the side");
  assert.equal(M.routeEdge(a, node("o", 50, 30), "orthogonal").style, "straight", "overlapping boxes fall back to a straight line");
  const self = M.routeEdge(a, a); assert.equal(self.points.length, 5); assert.deepEqual(self.points[4], { x: 100, y: 18 }); assert.equal(self.endAngle, Math.PI);
  assert.deepEqual(M.facingSides(M.rectOf(a), M.rectOf(b)), { from: "right", to: "left" }); assert.deepEqual(M.facingSides(M.rectOf(below), M.rectOf(a)), { from: "top", to: "bottom" }); assert.equal(M.facingSides(M.rectOf(a), M.rectOf(a)), null);
  const head = M.arrowHead({ x: 300, y: 30 }, 0, 10); assert.deepEqual(head[0], { x: 300, y: 30 }); assert.ok(head[1].x < 300 && head[2].x < 300 && Math.abs(head[1].y + head[2].y - 60) < 0.02 && head[1].y !== head[2].y);
  assert.deepEqual([M.routeStyleOf(edge("e", "a", "b")), M.routeStyleOf(edge("e", "a", "b", { route: "curved" })), M.routeStyleOf(edge("e", "a", "b", { route: "spiral" }))], ["straight", "curved", "straight"]);
  assert.deepEqual([M.hasArrow(edge("e", "a", "b")), M.hasArrow(edge("e", "a", "b", { kind: "line" })), M.hasArrow(edge("e", "a", "b", { kind: "zigzag" }))], [true, false, true]);
});

/* ------------------------------------------------------------------ merge ------------------------------------------------------------------ */
const B = doc([node("a"), node("b", 200), node("c", 400)], [edge("e1", "a", "b"), edge("e2", "b", "c")]);
test("merge: different ids combine without conflict, whichever side is local; the same change is taken once", () => {
  const l = M.updateNode(B, "a", { text: "A local", x: 5 }), r = M.addNode(M.updateNode(B, "c", { color: "#008b4e" }), node("n-remote", 9, 9));
  const m = M.mergeCanvas(B, l, r); assert.deepEqual(m.conflicts, []); assert.deepEqual(ids(m.merged), ["a", "b", "c", "n-remote"]);
  assert.equal(M.nodeById(m.merged, "a")!.text, "A local"); assert.equal(M.nodeById(m.merged, "c")!.color, "#008b4e"); assert.deepEqual(M.mergeCanvas(B, r, l).merged, m.merged);
  const same = M.mergeCanvas(B, M.updateNode(B, "a", { text: "same" }), M.updateNode(M.updateNode(B, "a", { text: "same" }), "b", { y: 1 })); assert.deepEqual(same.conflicts, []); assert.equal(M.nodeById(same.merged, "b")!.y, 1);
  assert.equal(M.mergeCanvas(B, B, r).merged, r); assert.equal(M.mergeCanvas(B, l, B).merged, l); assert.equal(M.mergeCanvas(B, l, clone(l)).merged, l);
});
test("merge: the same node edited on both sides is a conflict — local kept, both versions carried, resolvable either way", () => {
  const l = M.updateNode(B, "a", { text: "mine" }), r = M.updateNode(B, "a", { text: "theirs" });
  const m = M.mergeCanvas(B, l, r); assert.equal(m.conflicts.length, 1); const c = m.conflicts[0];
  assert.deepEqual([c.kind, c.id, c.reason], ["node", "a", "bothEdited"]); assert.deepEqual([(c.base as any).text, (c.local as any).text, (c.remote as any).text], ["a", "mine", "theirs"]);
  assert.equal(M.nodeById(m.merged, "a")!.text, "mine"); assert.equal(M.nodeById(M.resolveConflict(m.merged, c, true), "a")!.text, "theirs"); assert.deepEqual(M.resolveConflict(m.merged, c, false), m.merged);
  // even a disjoint-field edit of the same node is a conflict (merge is by element, as on the native apps)
  assert.equal(M.mergeCanvas(B, M.updateNode(B, "a", { x: 9 }), M.updateNode(B, "a", { text: "t" })).conflicts.length, 1);
});
test("merge: edit versus delete keeps the edited node and reports it (SPEC §7), on either side", () => {
  const edited = M.updateNode(B, "b", { text: "B edited" }), deleted = M.removeNodes(B, ["b"]);
  for (const [l, r, where] of [[edited, deleted, "local"], [deleted, edited, "remote"]] as const) {
    const m = M.mergeCanvas(B, l, r); const c = m.conflicts.find((x) => x.id === "b")!;
    assert.deepEqual([c.kind, c.reason], ["node", "editedAndDeleted"]); assert.equal(M.nodeById(m.merged, "b")!.text, "B edited", `edited on the ${where} side`);
    assert.equal(where === "local" ? c.remote : c.local, undefined); assert.equal(M.danglingEdges(m.merged).length, 0);
    const gone = M.resolveConflict(m.merged, c, where === "local"); assert.equal(M.nodeById(gone, "b"), undefined, "choosing the deleting side removes the node"); assert.equal(M.danglingEdges(gone).length, 0, "…and its edges");
  }
});
test("merge: edges of a deleted node go with it when untouched; a new or edited edge restores the node (deletedButReferenced)", () => {
  const del = M.removeNodes(B, ["c"]);
  const quiet = M.mergeCanvas(B, M.updateNode(B, "a", { x: 3 }), del); assert.deepEqual(quiet.conflicts, []); assert.deepEqual(ids(quiet.merged), ["a", "b"]); assert.deepEqual(quiet.merged.edges.map((e) => e.id), ["e1"]);
  const m = M.mergeCanvas(B, M.addEdge(B, edge("e9", "a", "c")), del); assert.deepEqual(ids(m.merged), ["a", "b", "c"], "restored at its base position");
  assert.deepEqual(m.conflicts.map((c) => [c.kind, c.id, c.reason, c.remote === undefined]), [["node", "c", "deletedButReferenced", true]]); assert.deepEqual(m.merged.edges.map((e) => e.id), ["e1", "e9"], "e2 was untouched and goes; e9 is kept"); assert.equal(M.danglingEdges(m.merged).length, 0);
  const rel = M.mergeCanvas(B, del, M.updateEdge(B, "e2", { label: "kept" })); assert.ok(M.nodeById(rel.merged, "c")); assert.deepEqual(rel.conflicts.map((c) => `${c.kind}:${c.id}:${c.reason}`), ["edge:e2:editedAndDeleted", "node:c:deletedButReferenced"]);
});
test("merge: top-level fields merge like elements; the viewport never conflicts (local wins unless only the remote moved)", () => {
  const b = { ...B, theme: "a" }; const m = M.mergeCanvas(b, { ...b, theme: "l", viewport: { x: 1, y: 1, zoom: 2 } }, { ...b, theme: "r", viewport: { x: 9, y: 9, zoom: 3 }, added: 1 });
  assert.deepEqual(m.conflicts.map((c) => [c.kind, c.id, c.reason, c.local, c.remote]), [["field", "theme", "bothEdited", "l", "r"]]); assert.deepEqual([m.merged.theme, m.merged.added, m.merged.viewport], ["l", 1, { x: 1, y: 1, zoom: 2 }]);
  assert.equal(M.resolveConflict(m.merged, m.conflicts[0], true).theme, "r"); assert.equal(M.resolveConflict(m.merged, { kind: "field", id: "format", reason: "bothEdited", remote: "x" }, true).format, "spn-canvas-1");
  assert.deepEqual(M.mergeCanvas(b, M.updateNode(b, "a", { x: 1 }), { ...b, viewport: { x: 9, y: 9, zoom: 3 } }).merged.viewport, { x: 9, y: 9, zoom: 3 });
});
test("merge fixtures (shared with SPNotesCore): every case reproduces its expected document and conflicts", () => {
  const f = fixture("merge-cases.json"); assert.ok(f.cases.length >= 39);
  for (const c of f.cases) { const r = M.mergeCanvas(c.base, c.local, c.remote); assert.ok(M.jsonEqual(r.merged, c.expected.merged), `${c.name}: merged`); assert.deepEqual(clone(r.conflicts), c.expected.conflicts, `${c.name}: conflicts`); }
  const added = f.cases.find((c: any) => c.name === "added-both-sides").expected; assert.deepEqual(added.merged.nodes.slice(4).map((n: any) => n.id), ["Z-remote", "twin", "z-local", "ﬁ", "😀"]); assert.deepEqual(added.conflicts.map((c: any) => c.id), ["twin"]);
});

function randomDocs(seed: number) {
  const rng = new M.LayoutRandom(seed); const int = (n: number) => Number(rng.next() % BigInt(n));
  const n = 3 + int(7); const base = doc(Array.from({ length: n }, (_, i) => node(`n${i}`, int(900), int(600))));
  for (let i = 1; i < n; i++) if (int(3) > 0) base.edges.push(edge(`e${i}`, `n${int(i)}`, `n${i}`));
  const mutate = (from: CanvasData, side: string, ops = 1 + int(5)) => {
    let d = from;
    for (let k = 0; k < ops; k++) {
      const op = int(8); const pick = () => d.nodes[int(d.nodes.length)];
      if (op === 0 && d.nodes.length) d = M.moveNodes(d, [pick().id], int(50) + 1, int(50));
      else if (op === 1 && d.nodes.length) d = M.updateNode(d, pick().id, { text: `${side}${int(4)}` });
      else if (op === 2 && d.nodes.length > 1) d = M.removeNodes(d, [pick().id]);
      else if (op === 3) d = M.addNode(d, node(`${side}${int(5)}`, int(900), int(600)));
      else if (op === 4 && d.nodes.length > 1) d = M.addEdge(d, edge(`x${side}${int(4)}`, pick().id, pick().id));
      else if (op === 5 && d.edges.length) d = M.updateEdge(d, d.edges[int(d.edges.length)].id, { label: `${side}${int(3)}` });
      else if (op === 6 && d.edges.length) d = M.removeEdges(d, [d.edges[int(d.edges.length)].id]);
      else if (d.nodes.length) d = M.bringToFront(d, [pick().id]);
    }
    return d;
  };
  return { base, mutate, int };
}
const SEEDS = 2000;
test(`merge, randomised (${SEEDS} seeds): deterministic, rule-abiding per id, nothing lost, never a dangling edge, symmetric when clean, stable under re-merge`, () => {
  let conflicted = 0, clean = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { base, mutate } = randomDocs(seed); const l = mutate(base, "l"), r = mutate(base, "r");
    const m = M.mergeCanvas(base, l, r); const tag = `seed ${seed}`;
    assert.deepEqual(M.mergeCanvas(clone(base), clone(l), clone(r)), clone(m), `${tag}: deterministic`);
    assert.equal(M.danglingEdges(m.merged).length, 0, `${tag}: dangling edge`); assert.equal(M.canvasProblem(m.merged), null, `${tag}: valid document`);
    assert.equal(new Set(ids(m.merged)).size, m.merged.nodes.length, `${tag}: unique node ids`);
    const inConflict = new Set(m.conflicts.map((c) => `${c.kind}:${c.id}`));
    for (const [kind, key] of [["node", "nodes"], ["edge", "edges"]] as const) {
      const all = new Set([...base[key], ...l[key], ...r[key]].map((e) => e.id));
      for (const id of all) {
        const find = (d: CanvasData) => (d[key] as { id: string }[]).find((e) => e.id === id); const bv = find(base), lv = find(l), rv = find(r), mv = find(m.merged);
        if (inConflict.has(`${kind}:${id}`)) { const c = m.conflicts.find((x) => x.kind === kind && x.id === id)!; assert.ok(M.jsonEqual(c.local, lv) || c.reason === "deletedButReferenced", `${tag}: conflict carries local`); assert.ok(M.jsonEqual(c.remote, rv) || c.reason === "deletedButReferenced", `${tag}: conflict carries remote`); assert.ok(mv, `${tag}: a conflicted element stays in the canvas`); continue; }
        // an edge can also disappear with a deleted node
        const expected = M.jsonEqual(lv, rv) ? lv : M.jsonEqual(lv, bv) ? rv : lv;
        if (kind === "edge" && expected && !mv) { const e = expected as CanvasEdge; assert.ok(!M.nodeById(m.merged, e.from) || !M.nodeById(m.merged, e.to), `${tag}: edge ${id} dropped only with its node`); continue; }
        assert.ok(M.jsonEqual(mv, expected), `${tag}: ${kind} ${id} follows the three-way rule`);
      }
    }
    // nothing lost: every node a side edited or added is in the merged canvas or in a conflict that carries it
    for (const side of [l, r]) for (const n of side.nodes) { const bv = M.nodeById(base, n.id); if (bv && M.jsonEqual(bv, n)) continue; assert.ok(M.nodeById(m.merged, n.id), `${tag}: edited / added node ${n.id} survives`); }
    const back = M.mergeCanvas(base, r, l);
    assert.equal(back.conflicts.length === 0, m.conflicts.length === 0, `${tag}: clean on both sides or on neither`);
    if (m.conflicts.length === 0) { clean++; assert.ok(M.jsonEqual(back.merged, m.merged), `${tag}: a clean merge does not depend on which side is local`); } else conflicted++;
    assert.ok(M.jsonEqual(M.mergeCanvas(r, m.merged, r).merged, m.merged), `${tag}: re-merging the result against the same remote changes nothing`);
    let settled = m.merged; for (const c of m.conflicts) settled = M.resolveConflict(settled, c, true); if (m.conflicts.length) assert.equal(new Set(ids(settled)).size, settled.nodes.length, `${tag}: resolving keeps ids unique`);
  }
  assert.ok(conflicted > SEEDS / 20 && clean > SEEDS / 20, `the generator produces both outcomes (clean ${clean}, conflicted ${conflicted})`);
});
const SIMS = 500;
test(`two clients against a versioned server (${SIMS} simulations of PUT → 409 → merge → retry): both converge to the server copy and no un-deleted card is lost`, () => {
  for (let seed = 1; seed <= SIMS; seed++) {
    const { base, mutate, int } = randomDocs(seed * 7919);
    const server = { data: base, version: 1 }; const mk = () => ({ base, version: 1, doc: base });
    const clients = [mk(), mk()]; const born = new Set<string>(ids(base)), deletedBy = new Set<string>(); let puts = 0, conflicts409 = 0;
    const sync = (c: (typeof clients)[number]) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (c.version === server.version) { if (!M.jsonEqual(c.doc, server.data)) { server.data = c.doc; server.version++; puts++; } c.base = c.doc; c.version = server.version; return; }
        conflicts409++; const m = M.mergeCanvas(c.base, c.doc, server.data); c.doc = m.merged; c.base = server.data; c.version = server.version; // 409: merge against the remembered base, retry
      }
      throw new Error("did not settle");
    };
    for (let round = 0; round < 6; round++) {
      const who = clients[int(2)], side = who === clients[0] ? "p" : "q"; const before = new Set(ids(who.doc));
      who.doc = mutate(who.doc, `${side}${round}`, 1 + int(3));
      for (const id of ids(who.doc)) born.add(id); for (const id of before) if (!M.nodeById(who.doc, id)) deletedBy.add(id);
      if (int(3) > 0) sync(who); if (int(4) === 0) sync(clients[int(2)]);
    }
    sync(clients[0]); sync(clients[1]); sync(clients[0]);
    assert.ok(M.jsonEqual(clients[0].doc, server.data) && M.jsonEqual(clients[1].doc, server.data), `sim ${seed}: both clients hold the server copy`);
    assert.equal(M.canvasProblem(server.data), null, `sim ${seed}: the server copy is valid`);
    for (const id of born) if (!deletedBy.has(id)) assert.ok(M.nodeById(server.data, id), `sim ${seed}: card ${id} was never deleted by anyone and must still exist`);
    void puts; void conflicts409;
  }
});

/* ------------------------------------------------------------------ layout ------------------------------------------------------------------ */
const pile = (n: number, edges = true) => { const d = doc(Array.from({ length: n }, (_, i) => node(`n${i}`, i % 3, i % 2, { w: 80 + (i % 4) * 40, h: 40 + (i % 3) * 30 }))); if (edges) for (let i = 1; i < n; i++) d.edges.push(edge(`e${i}`, `n${Math.floor((i - 1) / 2)}`, `n${i}`)); return d; };
test("SplitMix64 matches the reference sequence; rounding is half away from zero", () => {
  const r = new M.LayoutRandom(0); assert.deepEqual([r.next(), r.next(), r.next()].map(String), ["16294208416658607535", "7960286522194355700", "487617019471545679"]);
  const u = new M.LayoutRandom(42); for (let i = 0; i < 1000; i++) { const v = u.signedUnit(); assert.ok(v >= -1 && v < 1); }
  assert.deepEqual([2.5, -2.5, 0.5, -0.5, 1.4999, -1.5, 3].map(M.roundHalfAway), [3, -3, 1, -1, 1, -2, 3]);
});
test("grid layout: no overlap, array order row by row, columns as wide as their widest card, pinned nodes untouched, degenerate inputs", () => {
  const d = pile(11); const g = M.gridLayout(d, { columns: 4, spacing: 20, origin: { x: 100, y: -50 } });
  assert.equal(M.overlapArea(g), 0); assert.deepEqual(ids(g), ids(d)); assert.equal(g.edges, d.edges); assert.ok(g.nodes.every((n, i) => n.w === d.nodes[i].w && n.h === d.nodes[i].h && n.text === d.nodes[i].text));
  assert.deepEqual([g.nodes[0].x, g.nodes[0].y], [100, -50]); assert.equal(new Set(g.nodes.slice(0, 4).map((n) => n.y)).size, 1); assert.equal(g.nodes[4].x, g.nodes[0].x); assert.equal(g.nodes[1].x, 100 + 80 + 20);
  const auto = M.gridLayout(d); assert.equal(M.overlapArea(auto), 0); assert.equal(new Set(auto.nodes.map((n) => n.x)).size, 4, "⌈√11⌉ = 4 columns");
  const pinned = M.gridLayout(d, { pinned: new Set(["n3", "n7"]) }); assert.equal(pinned.nodes[3], d.nodes[3]); assert.equal(pinned.nodes[7], d.nodes[7]);
  assert.deepEqual(M.gridLayout(M.emptyCanvas()), M.emptyCanvas()); assert.deepEqual([M.gridLayout(pile(1), { columns: 0, spacing: -Infinity }).nodes[0].x, M.gridLayout(pile(1), { columns: 0 }).nodes[0].y], [0, 0]);
  assert.ok(M.gridLayout(d, { columns: 99 }).nodes.every((n) => n.y === 0)); assert.ok(M.gridLayout(d, { spacing: NaN }).nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
});
test("force-directed layout: spreads a pile, deterministic for a seed (identical bytes), another seed differs, only positions change, pinned nodes stay", () => {
  const d = pile(12); const before = M.layoutEnergy(d), overlapBefore = M.overlapArea(d);
  const a = M.forceLayout(d, { iterations: 300, seed: 7 });
  assert.ok(a.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))); assert.ok(M.layoutEnergy(a) < before * 0.05, `energy ${before} → ${M.layoutEnergy(a)}`); assert.ok(M.overlapArea(a) < overlapBefore * 0.02);
  for (let k = 0; k < 5; k++) assert.equal(JSON.stringify(M.forceLayout(clone(d), { iterations: 300, seed: 7 })), JSON.stringify(a), "same seed, same bytes");
  assert.equal(a.edges, d.edges); assert.ok(a.nodes.every((n, i) => n.id === d.nodes[i].id && n.w === d.nodes[i].w && n.h === d.nodes[i].h && n.z === d.nodes[i].z));
  assert.ok(a.nodes.every((n) => Math.round(n.x * 100) / 100 === n.x && Math.round(n.y * 100) / 100 === n.y), "rounded to 1/100");
  assert.equal(M.forceLayout(d, { iterations: 0 }), d); assert.equal(M.forceLayout(d, { iterations: -3 }), d);
  const same = doc(Array.from({ length: 6 }, (_, i) => node(`n${i}`, 50, 50)));
  const s1 = M.forceLayout(same, { iterations: 120, seed: 1 }), s2 = M.forceLayout(same, { iterations: 120, seed: 2 });
  assert.notDeepEqual(s1, s2); assert.equal(new Set(s1.nodes.map((n) => `${n.x},${n.y}`)).size, 6, "coincident cards are separated"); assert.deepEqual(M.forceLayout(same, { iterations: 120, seed: 1 }), s1);
  const pin = M.forceLayout(d, { iterations: 50, seed: 1, pinned: new Set(["n0", "n5"]) }); assert.equal(pin.nodes[0], d.nodes[0]); assert.equal(pin.nodes[5], d.nodes[5]);
});
test("layout fixtures (shared with SPNotesCore): generator values, grid and force-directed outputs are reproduced exactly", () => {
  const f = fixture("layout-cases.json"); const rng = new M.LayoutRandom(42);
  assert.deepEqual(Array.from({ length: 8 }, () => rng.next().toString()), f.random.next); assert.deepEqual(Array.from({ length: 4 }, () => rng.signedUnit()), f.random.signedUnit);
  assert.ok(f.cases.length >= 9);
  for (const c of f.cases) {
    const pinned = new Set<string>(c.params.pinned ?? []);
    const out = c.op === "grid" ? M.gridLayout(c.input, { columns: c.params.columns, spacing: c.params.spacing, origin: c.params.origin, pinned }) : M.forceLayout(c.input, { iterations: c.params.iterations, seed: c.params.seed, forces: c.params.forces, pinned });
    assert.deepEqual(clone(out), c.expected, c.name);
  }
});
test("Tidy up: connected canvases use the forces, unconnected ones the grid; anchored at the previous top-left corner; deterministic; selection only; animation frames", () => {
  const linked = pile(9); const t = M.tidyLayout(linked, { seed: 5 }); assert.deepEqual(M.tidyLayout(clone(linked), { seed: 5 }), t); assert.ok(M.overlapArea(t) < M.overlapArea(linked) * 0.05);
  assert.deepEqual([Math.min(...t.nodes.map((n) => n.x)), Math.min(...t.nodes.map((n) => n.y))], [0, 0], "the top-left corner did not move");
  const loose = M.moveNodes(pile(9, false), Array.from({ length: 9 }, (_, i) => `n${i}`), 300, 200); const g = M.tidyLayout(loose); assert.equal(M.overlapArea(g), 0); assert.deepEqual([g.nodes[0].x, g.nodes[0].y], [300, 200]);
  const only = M.tidyLayout(linked, { only: new Set(["n1", "n2", "n3"]) }); assert.ok(only.nodes.every((n, i) => ["n1", "n2", "n3"].includes(n.id) || n === linked.nodes[i]));
  const one = doc([node("a")]); assert.equal(M.tidyLayout(one), one);
  const mid = M.interpolateLayout(linked, t, 0.5); assert.ok(mid.nodes.every((n, i) => Math.abs(n.x - (linked.nodes[i].x + t.nodes[i].x) / 2) < 1e-9)); assert.equal(M.interpolateLayout(linked, t, 1), t); assert.equal(M.interpolateLayout(linked, t, 0), linked);
});
test("layout of 1 000 cards stays within an interactive budget", () => {
  const big = doc(Array.from({ length: 1000 }, (_, i) => node(`n${i}`, (i * 37) % 2000, (i * 91) % 1500)), Array.from({ length: 999 }, (_, i) => edge(`e${i}`, `n${Math.floor(i / 3)}`, `n${i + 1}`)));
  const t0 = performance.now(); const g = M.gridLayout(big); const t1 = performance.now(); const f = M.tidyLayout(big, { seed: 1 }); const t2 = performance.now();
  assert.equal(M.overlapArea(g), 0); assert.ok(f.nodes.every((n) => Number.isFinite(n.x))); assert.ok(t1 - t0 < 200, `grid ${Math.round(t1 - t0)} ms`); assert.ok(t2 - t1 < 8000, `tidy ${Math.round(t2 - t1)} ms`);
  console.log(`    layout timings for 1 000 cards: grid ${(t1 - t0).toFixed(1)} ms, tidy (60 force steps) ${(t2 - t1).toFixed(0)} ms`);
});

/* ------------------------------------------------------------------ viewport, history, exports ------------------------------------------------------------------ */
test("viewport: world ↔ screen, zoom around a point keeps that point fixed, clamped zoom, fit to content, visible rectangle", () => {
  const v = { x: 100, y: 50, zoom: 2 };
  assert.deepEqual(M.worldToScreen(v, { x: 110, y: 60 }), { x: 20, y: 20 }); assert.deepEqual(M.screenToWorld(v, { x: 20, y: 20 }), { x: 110, y: 60 });
  for (const f of [0.5, 1.3, 3, 0.01, 100]) { const at = { x: 333, y: 127 }; const z = M.zoomBy(v, f, at); const w0 = M.screenToWorld(v, at), w1 = M.screenToWorld(z, at); assert.ok(Math.abs(w0.x - w1.x) < 1e-9 && Math.abs(w0.y - w1.y) < 1e-9, `factor ${f}`); assert.ok(z.zoom >= M.ZOOM_MIN && z.zoom <= M.ZOOM_MAX); }
  assert.equal(M.zoomTo(v, 2, { x: 0, y: 0 }), v); assert.deepEqual([M.clampZoom(NaN), M.clampZoom(99), M.clampZoom(0)], [1, M.ZOOM_MAX, M.ZOOM_MIN]);
  assert.deepEqual(M.panBy(v, 40, -20), { x: 80, y: 60, zoom: 2 });
  const fit = M.fitToContent({ x: 0, y: 0, w: 2000, h: 500 }, { w: 1000, h: 800 }, 50); assert.equal(fit.zoom, 0.45); const tl = M.worldToScreen(fit, { x: 0, y: 0 }), br = M.worldToScreen(fit, { x: 2000, y: 500 }); assert.ok(Math.abs(tl.x - 50) < 1e-9 && Math.abs(br.x - 950) < 1e-9 && Math.abs((tl.y + br.y) / 2 - 400) < 1e-9, "content centred with the padding");
  assert.equal(M.fitToContent({ x: 0, y: 0, w: 10, h: 10 }, { w: 1000, h: 800 }).zoom, 1, "never magnifies beyond 100 %"); assert.deepEqual(M.fitToContent(null, { w: 100, h: 100 }), { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(M.visibleRect(v, { w: 400, h: 200 }, 100), { x: 50, y: 0, w: 300, h: 200 }); assert.deepEqual(M.centerOn(v, { x: 0, y: 0 }, { w: 400, h: 200 }), { x: -100, y: -50, zoom: 2 });
  assert.ok(Math.abs(M.wheelZoomFactor(120, false) * M.wheelZoomFactor(-120, false) - 1) < 1e-12);
});
test("history: a gesture is one step, a cancelled gesture is none, undo / redo, a remote document drops the history, bounded", () => {
  const a = doc([node("a")]); let h = M.createHistory(a); assert.ok(!M.canUndo(h) && !M.canRedo(h));
  const b = M.moveNodes(a, ["a"], 1, 0), c = M.moveNodes(b, ["a"], 1, 0), d2 = M.moveNodes(c, ["a"], 1, 0);
  h = M.transient(h, b); h = M.transient(h, c); assert.equal(h.past.length, 0); assert.ok(M.canUndo(h)); h = M.settle(h); assert.deepEqual([h.past.length, h.present], [1, c]);
  h = M.commit(h, d2); h = M.undo(h); assert.equal(h.present, c); h = M.undo(h); assert.equal(h.present, a); assert.equal(M.undo(h), h); h = M.redo(h); h = M.redo(h); assert.equal(h.present, d2); assert.equal(M.redo(h), h);
  h = M.undo(h); h = M.commit(h, b); assert.equal(h.future.length, 0, "a new edit clears the redo stack"); assert.equal(M.commit(h, h.present), h);
  let g = M.transient(M.createHistory(a), b); g = M.cancelGesture(g); assert.deepEqual([g.present, g.past.length, g.gesture], [a, 0, null]); g = M.settle(M.transient(M.transient(g, b), a)); assert.equal(g.past.length, 0, "a gesture that ends where it started is not a step");
  g = M.transient(M.createHistory(a), b); g = M.undo(g); assert.equal(g.present, a, "undo during a gesture settles it first");
  const r = M.replaceHistory(h, c); assert.deepEqual([r.past.length, r.future.length, r.present], [0, 0, c]);
  let big = M.createHistory(a); for (let i = 0; i < M.HISTORY_LIMIT + 50; i++) big = M.commit(big, M.moveNodes(big.present, ["a"], 1, 0)); assert.equal(big.past.length, M.HISTORY_LIMIT);
});
test("exports: plain text for the index, Markdown outline, standalone SVG", () => {
  const pid = "7d0e0d3c-0000-4000-8000-000000000001", att = "7d0e0d3c-0000-4000-8000-000000000002", ink = "7d0e0d3c-0000-4000-8000-000000000003";
  const d = doc([
    node("t", 0, 0, { h: 180, text: "## Hypothesis\nPrices <adjust> & settle" }), node("p", 300, 0, { kind: "page", pageId: pid, text: undefined }), node("l", 600, 0, { kind: "link", url: "https://example.org/a?b=1&c=2", text: "Example" }),
    node("m", 0, 200, { kind: "math", latex: "E=mc^2", text: undefined }), node("tb", 300, 200, { kind: "table", text: M.serializeTable([["Year", "Rate"], ["2025", "4.1"]]) }), node("s", 600, 200, { kind: "shape", shape: "diamond", text: "Decide", color: "#cc272e" }),
    node("i", 0, 400, { kind: "image", attachmentId: att, text: "photo.png" }), node("dr", 300, 400, { kind: "drawing", ink, text: undefined }), node("u", 600, 400, { kind: "hologram", text: "" }),
  ], [edge("e1", "t", "p", { label: "motivates" }), edge("e2", "p", "s", { kind: "line" }), edge("e3", "s", "m", { route: "curved", color: "#008b4e" })]);
  assert.equal(M.canvasText(d), "## Hypothesis\nPrices <adjust> & settle\nExample\nhttps://example.org/a?b=1&c=2\nE=mc^2\nYear Rate\n2025 4.1\nDecide\nphoto.png\nmotivates");
  const md = M.canvasToMarkdown(d, "Project map", (id) => (id === pid ? "Plan [v2]" : undefined));
  assert.equal(md, ["# Project map", "", "## Cards", "", "- **Text** — Hypothesis", "  Prices <adjust> & settle", `- **Page** — [Plan \\[v2\\]](/p/${pid})`, "- **Link** — [Example](https://example.org/a?b=1&c=2)", "- **Formula** — $E=mc^2$", "- **Table** — Year · Rate", "  | Year | Rate |", "  | --- | --- |", "  | 2025 | 4.1 |", "- **Shape** — Decide", `- **Image** — ![photo.png](/api/files/${att})`, "- **Drawing** — Drawing", "- **Card (hologram)** — Card (hologram)", "", "## Connections", "", "- Hypothesis → Plan [v2] — motivates", "- Plan [v2] — Decide", "- Decide → E=mc^2", ""].join("\n"));
  assert.match(M.canvasToMarkdown(M.emptyCanvas(), ""), /^# Untitled canvas\n\n## Cards\n\n_No card\._\n\n## Connections\n\n_No connection\._\n$/);
  const svg = M.canvasToSvg(d, { images: new Map([[att, "data:image/png;base64,AAAA"]]), inks: new Map([[ink, { width: 100, height: 60, strokes: [{ color: "#dc2626ff", width: 3, points: [[0, 0, 0.5], [50, 30, 0.5]] }] }]]) });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-32 -32 764 524"/); assert.ok(svg.endsWith("</svg>"));
  assert.ok(svg.includes("&lt;adjust&gt;") && svg.includes("&amp;") && !svg.includes("<adjust>"), "text is escaped"); assert.equal((svg.match(/<g data-id=/g) ?? []).length, 9); assert.equal((svg.match(/<path /g) ?? []).length, 3); assert.equal((svg.match(/<polygon points="[^"]+" fill="#(535862|008b4e)"/g) ?? []).length, 2, "two arrowheads (the line has none)");
  assert.ok(svg.includes('href="data:image/png;base64,AAAA"') && svg.includes('<polyline points="300,400 350,430"') && svg.includes('stroke="#dc2626"') && svg.includes("stroke-dasharray"), "image, ink strokes and the unknown card are drawn");
  assert.ok(svg.includes(" C") && svg.includes('stroke="#008b4e"')); assert.ok(M.canvasToSvg(d, { theme: M.SVG_DARK }).includes('fill="#0d1016"'));
  assert.deepEqual(M.wrapText("alpha beta gamma delta", 60, 12, 5), ["alpha", "beta", "gamma", "delta"]); assert.deepEqual(M.wrapText("one two three four five six", 80, 12, 2).length, 2); assert.ok(M.wrapText("x".repeat(100), 60, 12, 99).every((l) => l.length <= 9));
});
