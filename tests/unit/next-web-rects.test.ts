/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-web-rects.test.ts
 * Description      : geometry and list helpers of the pdf block
 *                    (src/lib/editor/pdf-annotations.ts): selection rects →
 *                    page-relative rects (offset, clamping, same-line merging,
 *                    rounding, ordering, degenerate input), the round trip back
 *                    to pixels, and the immutable annotation list operations
 *                    that must preserve what this client does not understand.
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
import { annotationAt, annotationLine, clampPage, cleanSelectionText, denormaliseRect, HIGHLIGHT_COLORS, inkPointsOf, listAnnotations, newAnnotation, normaliseRects, patchAnnotation, rectsOf, removeAnnotation, safeColor, shortId, sortAnnotations } from "../../src/lib/editor/pdf-annotations";

const page = { left: 100, top: 50, width: 400, height: 800 };
const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

test("normaliseRects: relative to the page whatever its offset on screen", () => {
  assert.deepEqual(normaliseRects([box(140, 130, 200, 16)], page), [[0.1, 0.1, 0.5, 0.02]]);
  assert.deepEqual(normaliseRects([box(40, 80, 200, 16)], { left: 0, top: 0, width: 400, height: 800 }), [[0.1, 0.1, 0.5, 0.02]]);
  assert.deepEqual(normaliseRects([box(-460, 1080, 200, 16)], { left: -500, top: 1000, width: 400, height: 800 }), [[0.1, 0.1, 0.5, 0.02]], "scrolled page (negative left)");
  assert.deepEqual(normaliseRects([box(100, 50, 400, 800)], page), [[0, 0, 1, 1]]);
});
test("normaliseRects: clamped to the page, what lies outside is dropped", () => {
  assert.deepEqual(normaliseRects([box(60, 30, 80, 40)], page), [[0, 0, 0.1, 0.025]], "overflowing the top-left corner");
  assert.deepEqual(normaliseRects([box(460, 830, 100, 100)], page), [[0.9, 0.975, 0.1, 0.025]], "overflowing the bottom-right corner");
  assert.deepEqual(normaliseRects([box(0, 0, 50, 20), box(600, 100, 50, 20), box(200, 900, 50, 20), box(100, 0, 50, 50)], page), [], "entirely outside (touching the edge is outside)");
  for (const [x, y, w, h] of normaliseRects([box(-1000, -1000, 5000, 5000), box(490, 840, 30, 30)], page)) { assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0); assert.ok(x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9); }
});
test("normaliseRects: degenerate input", () => {
  assert.deepEqual(normaliseRects([], page), []);
  assert.deepEqual(normaliseRects([box(150, 150, 0, 16), box(150, 150, 30, 0), box(150, 150, -5, 16)], page), [], "zero or negative size");
  assert.deepEqual(normaliseRects([box(NaN, 150, 10, 10), box(150, 150, Infinity, 10), null as any, undefined as any, {} as any], page), []);
  assert.deepEqual(normaliseRects([box(150, 150, 0.01, 0.01)], page), [], "smaller than the rounding step");
  for (const bad of [{ ...page, width: 0 }, { ...page, height: 0 }, { ...page, width: -4 }, { ...page, left: NaN }, null as any, undefined as any]) assert.deepEqual(normaliseRects([box(140, 130, 200, 16)], bad), []);
  assert.deepEqual(normaliseRects(null as any, page), []);
  const arrayLike = { 0: box(140, 130, 200, 16), length: 1 } as ArrayLike<any>; assert.deepEqual(normaliseRects(arrayLike, page), [[0.1, 0.1, 0.5, 0.02]], "DOMRectList-like input");
});
test("normaliseRects: rects of the same text line are merged, separate lines and distant columns are not", () => {
  // three words of one line (gaps of 4 px = 1 % of the page width), with the slightly different heights real fonts produce
  assert.deepEqual(normaliseRects([box(140, 130, 40, 16), box(184, 131, 60, 15), box(248, 130, 52, 20)], page), [[0.1, 0.1, 0.4, 0.025]]);
  // duplicates and a rect nested in another (span + its text node) collapse
  assert.deepEqual(normaliseRects([box(140, 130, 200, 16), box(140, 130, 200, 16), box(180, 132, 40, 12)], page), [[0.1, 0.1, 0.5, 0.02]]);
  // two lines, each made of two pieces
  assert.deepEqual(normaliseRects([box(140, 130, 100, 16), box(240, 130, 100, 16), box(140, 150, 60, 16), box(200, 150, 20, 16)], page), [[0.1, 0.1, 0.5, 0.02], [0.1, 0.125, 0.2, 0.02]]);
  // same line but far apart (two columns): kept as two rects
  assert.deepEqual(normaliseRects([box(120, 130, 80, 16), box(320, 130, 80, 16)], page), [[0.05, 0.1, 0.2, 0.02], [0.55, 0.1, 0.2, 0.02]]);
  // lines that merely touch vertically stay separate
  assert.equal(normaliseRects([box(140, 130, 100, 16), box(140, 146, 100, 16)], page).length, 2);
});
test("normaliseRects: 4-decimal rounding and stable reading order, independent of the input order", () => {
  assert.deepEqual(normaliseRects([box(133.333, 77.777, 123.456, 12.345)], page), [[0.0833, 0.0347, 0.3086, 0.0154]]);
  for (const r of normaliseRects([box(111.11, 61.7, 33.33, 9.87), box(301.01, 400.4, 77.7, 13.13)], page)) for (const v of r) assert.equal(v, Math.round(v * 1e4) / 1e4);
  const input = [box(140, 400, 50, 16), box(300, 130, 50, 16), box(140, 130, 50, 16), box(140, 250, 50, 16), box(360, 250, 50, 16)];
  const expected = [[0.1, 0.1, 0.125, 0.02], [0.5, 0.1, 0.125, 0.02], [0.1, 0.25, 0.125, 0.02], [0.65, 0.25, 0.125, 0.02], [0.1, 0.4375, 0.125, 0.02]];
  assert.deepEqual(normaliseRects(input, page), expected); assert.deepEqual(normaliseRects([...input].reverse(), page), expected);
  assert.deepEqual(normaliseRects([input[3], input[0], input[4], input[2], input[1]], page), expected);
  const frozen = Object.freeze(input.map((b) => Object.freeze({ ...b }))); assert.deepEqual(normaliseRects(frozen as any, page), expected, "the input is not mutated");
});
test("denormaliseRect: round trip with normaliseRects at any page size", () => {
  assert.deepEqual(denormaliseRect([0.1, 0.1, 0.5, 0.02], { width: 400, height: 800 }), { left: 40, top: 80, width: 200, height: 16 });
  assert.deepEqual(denormaliseRect([0, 0, 1, 1], { width: 612, height: 792 }), { left: 0, top: 0, width: 612, height: 792 });
  const source = box(187, 333, 141, 19); const [norm] = normaliseRects([source], page);
  const back = denormaliseRect(norm, page); // within the rounding step (1e-4 of the page ≈ 0.04–0.08 px here)
  assert.ok(Math.abs(back.left + page.left - source.left) < 0.05 && Math.abs(back.top + page.top - source.top) < 0.09 && Math.abs(back.width - source.width) < 0.05 && Math.abs(back.height - source.height) < 0.09);
  // the same stored rect on a page drawn twice as large, normalised again, is unchanged
  const bigger = { left: 10, top: 20, width: 800, height: 1600 }; const px = denormaliseRect(norm, bigger);
  assert.deepEqual(normaliseRects([{ left: px.left + bigger.left, top: px.top + bigger.top, width: px.width, height: px.height }], bigger), [norm]);
  assert.deepEqual(denormaliseRect([] as any, { width: 10, height: 10 }), { left: 0, top: 0, width: 0, height: 0 });
});

test("newAnnotation: SPEC shape, short random id, ISO date, cleaned text, safe colour", () => {
  const before = Date.now(); const a = newAnnotation({ page: 3, kind: "highlight", color: "#6CB8FF", rects: [[0.1, 0.1, 0.5, 0.02]], text: "  some\n  selected   text ", note: "" });
  assert.deepEqual(Object.keys(a).sort(), ["color", "createdAt", "id", "kind", "note", "page", "rects", "text"]);
  assert.match(a.id, /^[0-9a-z]{10}$/); assert.equal(a.page, 3); assert.equal(a.kind, "highlight"); assert.equal(a.color, "#6cb8ff"); assert.equal(a.text, "some selected text"); assert.equal(a.note, "");
  assert.deepEqual(a.rects, [[0.1, 0.1, 0.5, 0.02]]); assert.equal(new Date(a.createdAt).toISOString(), a.createdAt); assert.ok(Date.parse(a.createdAt) >= before - 5 && Date.parse(a.createdAt) <= Date.now() + 5);
  const ids = new Set(Array.from({ length: 500 }, () => newAnnotation({ page: 1 }).id)); assert.equal(ids.size, 500); assert.match(shortId(6), /^[0-9a-z]{6}$/);
  const d = newAnnotation({ page: 0, color: "red; background:url(x)", rects: [[0, 0, 1, "x" as any], [0.2, 0.2, 0.1, 0.1]], kind: "note", note: "n" });
  assert.equal(d.page, 1); assert.equal(d.color, HIGHLIGHT_COLORS[0].color); assert.deepEqual(d.rects, [[0.2, 0.2, 0.1, 0.1]]); assert.equal(d.kind, "note"); assert.equal(d.note, "n");
  const rects: [number, number, number, number][] = [[0.1, 0.1, 0.2, 0.2]]; const c = newAnnotation({ page: 1, rects }); assert.notEqual(c.rects, rects); assert.notEqual(c.rects[0], rects[0]);
  assert.equal(cleanSelectionText("x".repeat(3000)).length, 2000);
  assert.equal(HIGHLIGHT_COLORS.length, 4); for (const { color } of HIGHLIGHT_COLORS) assert.match(color, /^#[0-9a-f]{6}$/);
  assert.equal(safeColor("#ABCDEF"), "#abcdef"); assert.equal(safeColor("#abc"), HIGHLIGHT_COLORS[0].color); assert.equal(safeColor(null, "#000000"), "#000000"); assert.equal(safeColor("#12345g"), HIGHLIGHT_COLORS[0].color);
});
test("sortAnnotations: page, then position, then creation time — on a copy", () => {
  const mk = (id: string, pageNo: number, rects: number[][], createdAt = "2026-11-19T10:00:00.000Z") => ({ id, page: pageNo, kind: "highlight" as const, color: "#ffd84d", rects: rects as any, text: id, note: "", createdAt });
  const list = [mk("p2-top", 2, [[0.1, 0.1, 0.2, 0.02]]), mk("p1-bottom", 1, [[0.1, 0.8, 0.2, 0.02]]), mk("p1-top-right", 1, [[0.6, 0.1, 0.2, 0.02]]), mk("p1-top-left", 1, [[0.1, 0.1, 0.2, 0.02]]), mk("p1-none", 1, []),
    mk("p1-same-late", 1, [[0.3, 0.5, 0.1, 0.02]], "2026-11-19T12:00:00.000Z"), mk("p1-same-early", 1, [[0.3, 0.5, 0.1, 0.02]], "2026-11-19T11:00:00.000Z"), { id: "p1-ink", page: 1, kind: "ink" as const, color: "#000000", rects: [], text: "", note: "", ink: [[0.5, 0.3], [0.2, 0.35]] as [number, number][], createdAt: "" }];
  const snapshot = JSON.stringify(list); const sorted = sortAnnotations(list);
  assert.deepEqual(sorted.map((a) => a.id), ["p1-top-left", "p1-top-right", "p1-ink", "p1-same-early", "p1-same-late", "p1-bottom", "p1-none", "p2-top"]);
  assert.notEqual(sorted, list); assert.equal(JSON.stringify(list), snapshot); assert.equal(sorted[0], list[3], "same objects, new array"); assert.deepEqual(sortAnnotations([]), []);
});
test("clampPage", () => {
  assert.equal(clampPage(3, 10), 3); assert.equal(clampPage(0, 10), 1); assert.equal(clampPage(-4, 10), 1); assert.equal(clampPage(11, 10), 10); assert.equal(clampPage(2.4, 10), 2); assert.equal(clampPage(2.6, 10), 3);
  assert.equal(clampPage("7", 10), 7); assert.equal(clampPage("abc", 10), 1); assert.equal(clampPage(NaN, 10), 1); assert.equal(clampPage(null, 10), 1); assert.equal(clampPage(undefined, 10), 1); assert.equal(clampPage(Infinity, 10), 1);
  assert.equal(clampPage(5, 0), 1); assert.equal(clampPage(5, NaN), 1); assert.equal(clampPage(5, 4.9), 4);
});
test("patch / remove keep every other entry and every unknown key, and never mutate (ProseMirror shares attrs)", () => {
  const ink = Object.freeze({ id: "ink1", page: 1, kind: "ink", color: "#ff0000", rects: Object.freeze([]), text: "", note: "", ink: Object.freeze([[0.1, 0.1], [0.2, 0.2]]), createdAt: "2026-11-01T00:00:00.000Z", pressure: Object.freeze([0.5, 0.7]), device: "pencil" });
  const hl = Object.freeze({ id: "hl1", page: 2, kind: "highlight", color: "#ffd84d", rects: Object.freeze([Object.freeze([0.1, 0.1, 0.5, 0.02])]), text: "t", note: "", createdAt: "2026-11-02T00:00:00.000Z", author: "ios", futureKey: Object.freeze({ a: 1 }) });
  const stored = Object.freeze([ink, hl, "garbage", null, Object.freeze({ noId: true })]) as unknown as unknown[];
  const patched = patchAnnotation(stored, "hl1", { note: "my note", color: "#7bd88f" });
  assert.notEqual(patched, stored); assert.equal(patched.length, 5); assert.equal(patched[0], ink, "untouched entries are the same objects"); assert.equal(patched[2], "garbage"); assert.equal(patched[3], null); assert.equal(patched[4], stored[4]);
  assert.deepEqual(patched[1], { ...hl, note: "my note", color: "#7bd88f" }); assert.equal((patched[1] as any).author, "ios"); assert.equal((patched[1] as any).futureKey, hl.futureKey); assert.equal(hl.note, "");
  assert.deepEqual(patchAnnotation(stored, "missing", { note: "x" }), [...stored]);
  const removed = removeAnnotation(stored, "hl1"); assert.deepEqual(removed, [ink, "garbage", null, stored[4]]); assert.equal(stored.length, 5);
  assert.deepEqual(removeAnnotation(undefined, "x"), []); assert.deepEqual(patchAnnotation("nope", "x", {}), []);
  assert.deepEqual(listAnnotations(stored).map((a) => a.id), ["ink1", "hl1"]); assert.deepEqual(listAnnotations(null), []);
  assert.deepEqual(inkPointsOf(ink as any), [[0.1, 0.1], [0.2, 0.2]]); assert.deepEqual(inkPointsOf({ ink: [[1], "x", [0.3, 0.4, 0.9], [NaN, 1]] }), [[0.3, 0.4, 0.9]]); assert.deepEqual(inkPointsOf(hl as any), []);
  assert.deepEqual(rectsOf({ rects: [[0, 0, 1, 1], [0, 0, 1], "x", [0, 0, NaN, 1]] }), [[0, 0, 1, 1]]); assert.deepEqual(rectsOf(null), []);
});
test("annotationAt and annotationLine", () => {
  const a = { id: "a", page: 1, kind: "highlight" as const, color: "#ffd84d", rects: [[0.1, 0.1, 0.5, 0.02], [0.1, 0.13, 0.2, 0.02]] as [number, number, number, number][], text: "first", note: "", createdAt: "" };
  const b = { ...a, id: "b", rects: [[0.3, 0.1, 0.1, 0.02]] as [number, number, number, number][], kind: "note" as const, note: "why" }; const other = { ...a, id: "c", page: 2 };
  const ink = { ...a, id: "i", kind: "ink" as const, rects: [[0, 0, 1, 1]] as [number, number, number, number][] };
  assert.equal(annotationAt([a, b, other, ink], 1, 0.2, 0.11)?.id, "a"); assert.equal(annotationAt([a, b, other, ink], 1, 0.35, 0.11)?.id, "b", "the latest one wins where two overlap");
  assert.equal(annotationAt([a, b, other, ink], 1, 0.2, 0.14)?.id, "a"); assert.equal(annotationAt([a, b, other, ink], 1, 0.9, 0.9), null, "ink is not a click target"); assert.equal(annotationAt([a, b], 2, 0.2, 0.11), null);
  assert.equal(annotationLine(b), "p.1 — first — why"); assert.equal(annotationLine(a), "p.1 — first"); assert.equal(annotationLine({ page: 4, text: "", note: "only a note" }), "p.4 — only a note");
  assert.equal(annotationLine({ page: 2, kind: "ink", text: "", note: "" }), "p.2 — Ink drawing"); assert.equal(annotationLine({}), "p.1");
});
