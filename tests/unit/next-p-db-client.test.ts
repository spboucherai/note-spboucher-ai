/**
 * File: tests/unit/next-p-db-client.test.ts
 * Description: Databases Next Generation — pure client logic (no browser, no database): the saveable part of a filter draft and the
 *   reason a rule is incomplete, the virtual layout of the grid (groups, collapsed groups, "New" lines), per-view column order, groups
 *   built from server counts, date moves of the calendar / timeline drags, and the grouping keys shared with the server.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleProblem, validFilter, describeFilter, OPS, kind } from "../../src/components/database/filter-logic";
import { layout, entryAt, orderedProps } from "../../src/components/database/view-logic";
import { viewGroups, groupRows } from "../../src/components/database/group";
import { shiftDate, onDay, dayDiff, isoDay } from "../../src/components/database/dates";
import { groupKeyOf, groupOrder, groupMetas, NONE } from "../../src/lib/databases/group";
import { FILTER_OPS } from "../../src/lib/databases/types";
import type { Property, View, FilterGroup, RowOut } from "../../src/lib/databases/types";

const P = (id: string, type: Property["type"], config: Property["config"] = {}, position = 0): Property => ({ id, databaseId: "d", name: id, type, config, position, width: null });
const props = [P("title", "title"), P("txt", "text"), P("num", "number"), P("day", "date"), P("chk", "checkbox"), P("sel", "status", { options: [{ id: "todo", name: "To do", color: "gray" }, { id: "done", name: "Done", color: "green" }] }), P("rel", "relation"), P("roll", "rollup")];

test("filter draft: a rule is saved only when it is complete and valid; the rest of the draft is kept out of the saved filter", () => {
  assert.equal(ruleProblem({ property: "txt", op: "contains", value: "" }, props), "Enter a value"); assert.equal(ruleProblem({ property: "txt", op: "contains", value: "a" }, props), null);
  assert.equal(ruleProblem({ property: "txt", op: "empty" }, props), null); assert.equal(ruleProblem({ property: "chk", op: "eq", value: false }, props), null);
  assert.equal(ruleProblem({ property: "num", op: "gt", value: "abc" }, props), "Not a number"); assert.equal(ruleProblem({ property: "num", op: "gt", value: "1,250" }, props), null); assert.equal(ruleProblem({ property: "roll", op: "lte", value: 3 }, props), null);
  assert.equal(ruleProblem({ property: "day", op: "on", value: "today" }, props), null); assert.equal(ruleProblem({ property: "day", op: "before", value: "2026-13-45" }, props), "Not a date"); assert.equal(ruleProblem({ property: "day", op: "gte", value: "2026-11-19" }, props), null);
  assert.equal(ruleProblem({ property: "gone", op: "eq", value: "x" }, props), "This property no longer exists"); assert.equal(ruleProblem({ property: "num", op: "contains", value: "1" }, props), "Choose a condition");
  const draft: FilterGroup = { and: [{ property: "txt", op: "contains", value: "pie" }, { property: "num", op: "gt", value: "" }, { or: [{ property: "sel", op: "eq", value: "done" }, { property: "gone", op: "eq", value: 1 }, { and: [] }] }, { or: [{ property: "num", op: "lt", value: "x" }] }] };
  assert.deepEqual(validFilter(draft, props), { and: [{ property: "txt", op: "contains", value: "pie" }, { or: [{ property: "sel", op: "eq", value: "done" }] }] });
  assert.equal(validFilter({ and: [{ property: "num", op: "gt", value: "" }] }, props), null); assert.equal(validFilter({ or: [] }, props), null);
  assert.equal(describeFilter(draft), 5); assert.equal(describeFilter(validFilter(draft, props)), 2); assert.equal(describeFilter(null), 0);
  // every operator the builder offers is one the server accepts
  for (const [k, ops] of Object.entries(OPS)) for (const [op] of ops) assert.ok((FILTER_OPS as readonly string[]).includes(op), `${k}: ${op}`);
  assert.deepEqual(props.map((p) => kind(p)), ["text", "text", "number", "date", "checkbox", "select", "multi", "number"]);
});

test("virtual grid layout: lines of an ungrouped view, of groups, and of collapsed groups map to the right rows of the view order", () => {
  const flat = layout([{ key: "all", label: "All", color: "gray", value: undefined, count: 20000, offset: 0, aggregates: {} }], false, new Set(), 20000);
  assert.equal(flat.lines, 20001); assert.equal(flat.segs.length, 2); assert.deepEqual(entryAt(flat.segs, 0), { t: "row", i: 0 }); assert.deepEqual(entryAt(flat.segs, 19999), { t: "row", i: 19999 }); assert.deepEqual(entryAt(flat.segs, 20000), { t: "add", g: undefined }); assert.equal(entryAt(flat.segs, 20001), null);
  const groups = viewGroups(props[5], [{ key: "todo", count: 3, offset: 0, aggregates: {} }, { key: NONE, count: 2, offset: 3, aggregates: {} }], 5);
  assert.deepEqual(groups.map((g) => [g.key, g.count, g.offset, g.label]), [["todo", 3, 0, "To do"], ["done", 0, 3, "Done"], [NONE, 2, 3, "No sel"]], "an option without rows still exists (board column), with the offset where it would start");
  const open = layout(groups, true, new Set(), 5); // header, 3 rows, New, header, 2 rows, New — the empty group has no line
  assert.equal(open.lines, 9); assert.deepEqual([0, 1, 3, 4, 5, 6, 7, 8].map((v) => { const e = entryAt(open.segs, v)!; return e.t === "row" ? e.i : e.t === "group" ? `g:${e.g.key}` : `add:${e.g?.key}`; }), ["g:todo", 0, 2, "add:todo", `g:${NONE}`, 3, 4, `add:${NONE}`]);
  const shut = layout(groups, true, new Set(["todo"]), 5); assert.equal(shut.lines, 5); assert.deepEqual([0, 1, 2].map((v) => { const e = entryAt(shut.segs, v)!; return e.t === "row" ? e.i : e.t; }), ["group", "group", 3], "a collapsed group keeps its header only; the next group follows");
  assert.equal(layout(groups, true, new Set(["todo", NONE]), 5).lines, 2);
  assert.deepEqual(viewGroups(undefined, undefined, 7).map((g) => [g.key, g.count]), [["all", 7]]);
});

test("column order of a view: title first, config.order next, the database order for properties the view does not know yet", () => {
  const ps = [P("title", "title", {}, 0), P("a", "text", {}, 1), P("b", "text", {}, 2), P("c", "text", {}, 3), P("d", "text", {}, 4)]; const view = (order?: string[]): View => ({ id: "v", databaseId: "d", name: "v", type: "table", config: order ? { order } : {}, position: 0, isDefault: true });
  assert.deepEqual(orderedProps(ps, view()).map((p) => p.id), ["title", "a", "b", "c", "d"]); assert.deepEqual(orderedProps(ps, view(["c", "a"])).map((p) => p.id), ["title", "c", "a", "b", "d"]);
  assert.deepEqual(orderedProps(ps, view(["d", "gone", "title", "b"])).map((p) => p.id), ["title", "d", "b", "a", "c"]);
});

test("grouping keys are the same on the server and in the client; in-memory grouping keeps the option order", () => {
  const sel = props[5], chk = props[4];
  assert.equal(groupKeyOf(sel, "done"), "done"); assert.equal(groupKeyOf(sel, "ghost"), NONE); assert.equal(groupKeyOf(sel, undefined), NONE); assert.equal(groupKeyOf(chk, true), "true"); assert.equal(groupKeyOf(chk, undefined), "false"); assert.equal(groupKeyOf(chk, false), "false");
  assert.deepEqual(groupMetas(sel).map((m) => m.key), ["todo", "done", NONE]); assert.deepEqual(groupMetas(chk).map((m) => [m.key, m.value]), [["false", false], ["true", true]]);
  assert.ok(groupOrder(sel, "todo") < groupOrder(sel, "done") && groupOrder(sel, "done") < groupOrder(sel, NONE)); assert.ok(groupOrder(chk, "false") < groupOrder(chk, "true"));
  const row = (id: string, v: unknown): RowOut => ({ id, pageId: id, title: id, icon: null, values: { sel: v }, position: 0, createdAt: "", updatedAt: "" });
  assert.deepEqual(groupRows([row("1", "done"), row("2", null), row("3", "todo"), row("4", "ghost")], sel).map((g) => [g.key, g.rows.map((r) => r.id)]), [["todo", ["3"]], ["done", ["1"]], [NONE, ["2", "4"]]]);
});

test("date moves keep the shape of the value: a plain day stays plain, a date-time keeps its time of day", () => {
  assert.equal(shiftDate("2026-11-19", 4), "2026-11-23"); assert.equal(shiftDate("2026-11-30", 2), "2026-12-02"); assert.equal(shiftDate("2026-03-01", -1), "2026-02-28"); assert.equal(shiftDate("nonsense", 1), null); assert.equal(shiftDate(null, 1), null);
  const dt = new Date(2026, 10, 19, 14, 30).toISOString(); const moved = new Date(shiftDate(dt, 3)!); assert.deepEqual([moved.getFullYear(), moved.getMonth(), moved.getDate(), moved.getHours(), moved.getMinutes()], [2026, 10, 22, 14, 30]);
  assert.equal(onDay("2026-11-19", "2026-12-05"), "2026-12-05"); assert.equal(onDay(null, "2026-12-05"), "2026-12-05"); const on = new Date(onDay(dt, "2026-12-05")); assert.deepEqual([on.getMonth(), on.getDate(), on.getHours(), on.getMinutes()], [11, 5, 14, 30]);
  assert.equal(dayDiff(new Date(2026, 10, 22, 1), new Date(2026, 10, 19, 23)), 3); assert.equal(isoDay(new Date(2026, 0, 5)), "2026-01-05");
  // across the daylight-saving change (1 Nov 2026 in America/Toronto) a day is still a day
  assert.equal(shiftDate("2026-10-31", 2), "2026-11-02");
});
