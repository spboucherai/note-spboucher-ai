/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-web-ink.test.ts
 * Description      : the `spn-ink-1` library of the drawing block — byte-stable
 *                    serialisation, strict parsing that preserves unknown keys,
 *                    bounds, stroke eraser, simplification, pressure widths and
 *                    the renderer (against a recording context). Pure logic, no
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

import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyInk, serializeInk, parseInk, strokeBounds, inkBounds, eraseAt, simplifyStroke, strokeWidthAt, drawInk, segmentDistance, splitColor, backgroundFill, HIGHLIGHTER_ALPHA, type InkDoc, type InkStroke, type InkPoint, type InkContext } from "../../src/lib/editor/ink";

const stroke = (points: InkPoint[], over: Partial<InkStroke> = {}): InkStroke => ({ tool: "pen", color: "#112233ff", width: 4, points, ...over });
const sample = (): InkDoc => ({ ...emptyInk(1200, 800), strokes: [stroke([[10, 10, 0.5], [110, 10, 0.8], [110.004, 60.126, 0.33333]]), stroke([[300, 300, 0.5], [400, 400, 0.5]], { tool: "highlighter", color: "#FFEE0059", width: 24 })] });

test("ink: an empty document has the exact spn-ink-1 shape", () => {
  assert.equal(serializeInk(emptyInk(1200, 800)), '{"format":"spn-ink-1","width":1200,"height":800,"strokes":[]}');
});
test("ink: serialisation rounds (2 decimals, pressure 3), clamps pressure, lower-cases colours and is byte-stable over a round trip", () => {
  const text = serializeInk(sample());
  assert.equal(text, '{"format":"spn-ink-1","width":1200,"height":800,"strokes":[{"tool":"pen","color":"#112233ff","width":4,"points":[[10,10,0.5],[110,10,0.8],[110,60.13,0.333]]},{"tool":"highlighter","color":"#ffee0059","width":24,"points":[[300,300,0.5],[400,400,0.5]]}]}');
  assert.equal(serializeInk(parseInk(text)), text); assert.equal(serializeInk(parseInk(JSON.parse(text))), text, "accepts a parsed value too");
  const odd = serializeInk({ ...emptyInk(10, 10), strokes: [stroke([[-0.001, 1.005, 7], [2, 3, -1]])] });
  assert.ok(odd.includes("[[0,1,1],[2,3,0]]") || odd.includes("[[0,1.01,1],[2,3,0]]"), odd); assert.ok(!odd.includes("-0"));
  assert.equal(serializeInk(parseInk(odd)), odd);
});
test("ink: unknown keys of the document, of a stroke and extra point components survive parse → serialise", () => {
  const src = { zeta: [1, { a: 2 }], format: "spn-ink-1", width: 100, height: 50, app: { name: "SP Notes iOS", build: 7 }, strokes: [{ tool: "marker", color: "#00000080", width: 3, points: [[1, 2, 0.5, 0.25, 12], [3, 4, 1]], tilt: 0.4, id: "s1" }] };
  const doc = parseInk(JSON.stringify(src));
  assert.deepEqual(doc.app, src.app); assert.deepEqual(doc.zeta, src.zeta); assert.equal(doc.strokes[0].tilt, 0.4); assert.equal(doc.strokes[0].id, "s1"); assert.deepEqual(doc.strokes[0].points[0], [1, 2, 0.5, 0.25, 12]);
  const out = serializeInk(doc); assert.deepEqual(JSON.parse(out), src, "nothing lost, nothing added");
  assert.equal(out, serializeInk(parseInk(out))); assert.ok(out.startsWith('{"format":"spn-ink-1","width":100,"height":50,"strokes":['), "known keys first");
  const edited = eraseAt({ ...doc, strokes: [...doc.strokes, stroke([[90, 40, 0.5], [95, 45, 0.5]])] }, [[92, 42]], 2);
  assert.equal(edited.strokes.length, 1); assert.deepEqual(edited.app, src.app, "editing keeps document extras"); assert.equal(edited.strokes[0].tilt, 0.4);
});
test("ink: tolerated inputs are normalised (missing pressure, #rrggbb)", () => {
  const doc = parseInk({ format: "spn-ink-1", width: 10, height: 10, strokes: [{ tool: "pen", color: "#ABCDEF", width: 2, points: [[1, 2]] }] });
  assert.deepEqual(doc.strokes[0].points, [[1, 2, 1]], "a point without pressure counts as p = 1"); assert.equal(doc.strokes[0].color, "#abcdefff");
});
test("ink: invalid inputs are rejected with a clear message", () => {
  const ok = { format: "spn-ink-1", width: 10, height: 10, strokes: [{ tool: "pen", color: "#000000ff", width: 2, points: [[1, 2, 0.5]] }] };
  const bad: [unknown, RegExp][] = [
    ["not json {", /not valid JSON/], ["[]", /JSON object/], [null, /JSON object/], [42, /JSON object/],
    [{ ...ok, format: "spn-ink-2" }, /Unsupported ink format "spn-ink-2"/], [{ width: 1, height: 1, strokes: [] }, /Unsupported ink format \(missing\)/],
    [{ ...ok, width: 0 }, /width and height/], [{ ...ok, height: "800" }, /width and height/], [{ ...ok, strokes: {} }, /strokes must be an array/],
    [{ ...ok, strokes: [null] }, /stroke 1 must be an object/], [{ ...ok, strokes: [{ ...ok.strokes[0], tool: "eraser" }] }, /unknown tool/],
    [{ ...ok, strokes: [{ ...ok.strokes[0], color: "red" }] }, /colour/], [{ ...ok, strokes: [{ ...ok.strokes[0], width: -1 }] }, /positive width/],
    [{ ...ok, strokes: [{ ...ok.strokes[0], points: "x" }] }, /array of points/], [{ ...ok, strokes: [ok.strokes[0], { ...ok.strokes[0], points: [[1, 2, 0.5], [1]] }] }, /stroke 2, point 2/],
    [{ ...ok, strokes: [{ ...ok.strokes[0], points: [[1, "2", 0.5]] }] }, /point 1/], [{ ...ok, strokes: [{ ...ok.strokes[0], points: [[1, NaN, 0.5]] }] }, /point 1/],
  ];
  for (const [input, re] of bad) assert.throws(() => parseInk(input), re, JSON.stringify(input));
  assert.doesNotThrow(() => parseInk(ok));
});
test("ink: bounds include the stroke's width; an empty document has none", () => {
  const s = stroke([[10, 20, 0.5], [50, 80, 1]]);
  assert.deepEqual(strokeBounds(s), { minX: 8, minY: 18, maxX: 52, maxY: 82 }, "pen at pressure 1 = nominal width 4");
  assert.equal(strokeBounds(stroke([])), null); assert.equal(inkBounds(emptyInk(10, 10)), null);
  const b = inkBounds({ ...emptyInk(1200, 800), strokes: [s, stroke([]), stroke([[100, 5, 0.5]], { tool: "highlighter", width: 10 })] });
  assert.deepEqual(b, { minX: 8, minY: 0, maxX: 105, maxY: 82 });
});
test("ink: one width law for every platform — pen = width × (0.35 + 0.65 p), marker and highlighter constant, no pressure = 1", () => {
  const w = (tool: InkStroke["tool"], p: number) => strokeWidthAt({ tool, width: 10 }, p); const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  near(w("pen", 1), 10); near(w("pen", 0), 3.5); near(w("pen", 0.5), 6.75); near(w("pen", 0.2), 4.8); assert.ok(w("pen", 0.2) < w("pen", 0.8));
  assert.equal(w("marker", 0), 10); assert.equal(w("marker", 0.5), 10); assert.equal(w("marker", 1), 10);
  assert.equal(w("highlighter", 0), 10); assert.equal(w("highlighter", 1), 10);
  near(w("pen", 5), 10); near(w("pen", -3), 3.5); near(w("pen", NaN), 10); assert.equal(HIGHLIGHTER_ALPHA, 0.4);
});
test("ink: the shared numeric fixture (tests/fixtures/ink/width-law.json) — the Swift core asserts the same numbers", () => {
  const fx = JSON.parse(fs.readFileSync("tests/fixtures/ink/width-law.json", "utf8")); const doc = parseInk(fx.ink); assert.equal(doc.strokes.length, 3);
  doc.strokes.forEach((s, i) => {
    const got = s.points.map((p) => Math.round(strokeWidthAt(s, p[2]) * 1000) / 1000); assert.deepEqual(got, fx.expected[i].widths, `stroke ${i + 1} (${s.tool})`);
    assert.deepEqual(s.points.map((p) => p[2]), fx.expected[i].pressures, `pressures read for stroke ${i + 1}`);
    const b = strokeBounds(s)!; assert.deepEqual([b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v * 1000) / 1000), fx.expected[i].bounds, `bounds of stroke ${i + 1}`);
  });
  const rec: { alpha: number; lineWidth: number }[] = []; let alpha = 1, lineWidth = 0;
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() { rec.push({ alpha, lineWidth }); }, stroke() { rec.push({ alpha, lineWidth }); }, set globalAlpha(v: number) { alpha = v; }, get globalAlpha() { return alpha; }, set lineWidth(v: number) { lineWidth = v; }, get lineWidth() { return lineWidth; }, lineCap: "round", lineJoin: "round", strokeStyle: "", fillStyle: "", globalCompositeOperation: "source-over" } as unknown as InkContext;
  drawInk(ctx, { ...doc, strokes: [doc.strokes[2]] }); assert.equal(rec.at(-1)!.alpha, fx.highlighterAlpha, "an opaque highlighter colour is drawn at alpha 0.40"); assert.equal(fx.highlighterAlpha, 0.4);
});
test("ink: segment distance — crossing, parallel, touching, degenerate", () => {
  assert.equal(segmentDistance([0, 0], [10, 10], [0, 10], [10, 0]), 0); assert.equal(segmentDistance([0, 0], [10, 0], [0, 3], [10, 3]), 3);
  assert.equal(segmentDistance([0, 0], [10, 0], [13, 4], [20, 4]), 5); assert.equal(segmentDistance([0, 0], [0, 0], [3, 4], [3, 4]), 5); assert.equal(segmentDistance([0, 0], [10, 0], [5, 0], [5, 9]), 0);
});
test("ink: the eraser removes exactly the strokes its path passes over", () => {
  const a = stroke([[0, 100, 1], [200, 100, 1]]), b = stroke([[0, 200, 1], [200, 200, 1]]), dot = stroke([[300, 300, 1]]), thick = stroke([[0, 400, 1], [200, 400, 1]], { tool: "highlighter", width: 40 }); // p = 1: the nominal width
  const doc: InkDoc = { ...emptyInk(1200, 800), strokes: [a, b, dot, thick] };
  assert.deepEqual(eraseAt(doc, [[100, 0], [100, 150]], 5).strokes, [b, dot, thick], "a swipe crossing A between two of its points");
  assert.deepEqual(eraseAt(doc, [[100, 108]], 5).strokes, [a, b, dot, thick], "8 away > radius 5 + half width 2");
  assert.deepEqual(eraseAt(doc, [[100, 106.5]], 5).strokes, [b, dot, thick], "6.5 away ≤ 7");
  assert.deepEqual(eraseAt(doc, [[100, 424]], 5).strokes, [a, b, dot], "the stroke's own width counts (24 ≤ 5 + 20)");
  assert.deepEqual(eraseAt(doc, [[100, 50], [100, 450]], 1).strokes, [dot], "a long swipe takes everything on its way");
  assert.deepEqual(eraseAt(doc, [[303, 304]], 4).strokes, [a, b, thick], "single-point strokes can be erased");
  const same = eraseAt(doc, [[600, 600], [700, 700]], 10); assert.equal(same, doc, "no hit → same object"); assert.equal(eraseAt(doc, [], 10), doc);
  assert.equal(doc.strokes.length, 4, "the input is never mutated"); assert.notEqual(eraseAt(doc, [[100, 100]], 1), doc);
});
test("ink: simplification keeps endpoints, corners and pressure, drops collinear points", () => {
  const line: InkPoint[] = Array.from({ length: 50 }, (_, i) => [i * 2, 10 + (i % 2) * 0.05, i / 49] as InkPoint);
  const s = simplifyStroke(line, 0.5); assert.deepEqual(s, [line[0], line[49]]); assert.equal(s[1][2], 1, "pressure kept");
  const corner: InkPoint[] = [[0, 0, 0.1], [5, 0.01, 0.2], [10, 0, 0.3], [10, 5, 0.4], [10, 10, 0.9]];
  assert.deepEqual(simplifyStroke(corner, 0.5), [[0, 0, 0.1], [10, 0, 0.3], [10, 10, 0.9]]);
  assert.deepEqual(simplifyStroke(corner, 0), corner, "tolerance 0 = unchanged"); assert.notEqual(simplifyStroke(corner, 0), corner, "always a copy");
  assert.deepEqual(simplifyStroke([[1, 1, 0.5]] as InkPoint[], 3), [[1, 1, 0.5]]); assert.deepEqual(simplifyStroke([] as InkPoint[], 3), []);
  const loop: InkPoint[] = [[0, 0, 0.5], [10, 0, 0.5], [10, 10, 0.5], [0, 10, 0.5], [0, 0, 0.5]];
  assert.equal(simplifyStroke(loop, 1).length, 5, "a closed shape (first = last) is not collapsed");
  const wavy: InkPoint[] = Array.from({ length: 200 }, (_, i) => [i, Math.sin(i / 10) * 40, 0.5] as InkPoint), out = simplifyStroke(wavy, 1);
  assert.ok(out.length < 60 && out.length > 8, String(out.length)); assert.deepEqual(out[0], wavy[0]); assert.deepEqual(out[out.length - 1], wavy[199]);
});
test("ink: colours and backgrounds", () => {
  assert.deepEqual(splitColor("#FF000080"), { rgb: "#ff0000", alpha: 128 / 255 }); assert.deepEqual(splitColor("#00ff00"), { rgb: "#00ff00", alpha: 1 }); assert.deepEqual(splitColor("nope"), { rgb: "#000000", alpha: 1 });
  assert.equal(backgroundFill("none"), null); assert.equal(backgroundFill(""), null); assert.equal(backgroundFill("#fdf6e3"), "#fdf6e3"); assert.equal(backgroundFill("white"), "#ffffff"); assert.equal(backgroundFill("grid"), "#ffffff");
});

/** Recording 2D context: every call and the state it was made with. */
function recorder() {
  const calls: { op: string; args: number[]; lineWidth: number; alpha: number; comp: string; stroke: unknown; cap: string }[] = []; const stack: object[] = [];
  const ctx: InkContext = { lineWidth: 1, lineCap: "butt", lineJoin: "miter", strokeStyle: "#000", fillStyle: "#000", globalAlpha: 1, globalCompositeOperation: "source-over",
    save() { stack.push({ lineWidth: ctx.lineWidth, lineCap: ctx.lineCap, lineJoin: ctx.lineJoin, strokeStyle: ctx.strokeStyle, fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha, globalCompositeOperation: ctx.globalCompositeOperation }); }, restore() { Object.assign(ctx, stack.pop()); },
    beginPath() { log("beginPath"); }, moveTo(x, y) { log("moveTo", x, y); }, lineTo(x, y) { log("lineTo", x, y); }, stroke() { log("stroke"); }, arc(x, y, r) { log("arc", x, y, r); }, fill() { log("fill"); } };
  function log(op: string, ...args: number[]) { calls.push({ op, args, lineWidth: ctx.lineWidth, alpha: ctx.globalAlpha, comp: ctx.globalCompositeOperation, stroke: ctx.strokeStyle, cap: ctx.lineCap }); }
  return { ctx, calls, of: (op: string) => calls.filter((c) => c.op === op) };
}
test("ink: the renderer draws pressure-sensitive pen segments, a single translucent highlighter path, dots, and restores the context", () => {
  const doc: InkDoc = { ...emptyInk(100, 100), strokes: [
    stroke([[0, 0, 0.1], [10, 0, 0.5], [20, 0, 1]], { width: 10 }),
    stroke([[0, 50, 0.2], [10, 50, 0.9], [20, 50, 0.4]], { tool: "highlighter", color: "#ffee0080", width: 20 }),
    stroke([[5, 5, 0.5]], { tool: "marker", width: 6 }),
    stroke([[0, 80, 0.5], [9, 80, 0.5]], { tool: "highlighter", color: "#ffee00ff", width: 20 }),
  ] };
  const r = recorder(); drawInk(r.ctx, doc, 2);
  const strokes = r.of("stroke"); assert.equal(strokes.length, 4, "2 pen segments + 1 path per highlighter");
  assert.ok(strokes[0].lineWidth < strokes[1].lineWidth, "the pen thickens with pressure"); assert.equal(strokes[0].lineWidth, strokeWidthAt({ tool: "pen", width: 10 }, 0.3) * 2);
  assert.equal(strokes[0].cap, "round"); assert.equal(strokes[0].alpha, 1); assert.equal(strokes[0].comp, "source-over"); assert.equal(strokes[0].stroke, "#112233");
  assert.equal(strokes[2].lineWidth, 40, "highlighter: constant width × scale"); assert.equal(strokes[2].alpha, 128 / 255); assert.equal(strokes[2].comp, "multiply"); assert.equal(strokes[2].stroke, "#ffee00");
  assert.equal(strokes[3].alpha, HIGHLIGHTER_ALPHA, "an opaque highlighter colour still draws translucent");
  assert.deepEqual(r.of("lineTo").map((c) => c.args), [[20, 0], [40, 0], [20, 100], [40, 100], [18, 160]], "coordinates are scaled");
  assert.deepEqual(r.of("arc")[0].args, [10, 10, 6], "single point = dot of the stroke's width"); assert.equal(r.of("fill").length, 1);
  assert.equal(r.ctx.globalAlpha, 1); assert.equal(r.ctx.globalCompositeOperation, "source-over"); assert.equal(r.ctx.lineCap, "butt", "state restored");
  const none = recorder(); drawInk(none.ctx, emptyInk(10, 10), 1); assert.equal(none.calls.length, 0);
});
