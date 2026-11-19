/**
 * file: tests/unit/next-web-chart.test.ts
 * description: pure logic of the chart block — cell coercion, pasted tables (TSV / CSV, French decimals), nice ticks, scales, path
 *   helpers and the renderer-agnostic model of each chart kind, including invalid configurations. No DOM, no database.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { niceTicks, linearScale, bandScale, numericColumn, isNumericColumn, chartModel, arcPath, linePath, areaPath, defaultChartConfig, parsePastedTable, parsePastedCells, coerceCell, detectDelimiter, uniqueName, formatNumber } from "../../src/lib/editor/chart";
import type { ChartAttrs } from "../../src/lib/editor/next-node-defs";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const attrs = (over: Partial<ChartAttrs> = {}): ChartAttrs => ({ kind: "bar", title: "", columns: ["Month", "Sales", "Costs"], rows: [["Jan", 10, 4], ["Feb", 20, 8], ["Mar", 15, null], ["Apr", 30, 12]], x: "Month", y: ["Sales", "Costs"], source: null, ...over });
const size = { width: 640, height: 320 };

test("chart: coerceCell reads numbers, keeps text, accepts unambiguous French decimals", () => {
  const cases: [string, unknown][] = [["", null], ["   ", null], ["12", 12], ["-3.5", -3.5], ["+4", 4], [".5", 0.5], ["1e3", 1000], ["1,5", 1.5], ["12,75", 12.75], ["-0,25", -0.25], ["1 234,5", 1234.5], ["1 234,56", 1234.56], ["1.234,56", 1234.56],
    ["1,234", 1234], ["1,234,567.8", 1234567.8], ["1 234", 1234], ["12 %", 12], ["45%", 45], ["$1,200.50", 1200.5], ["12,5 €", 12.5], ["(15)", -15], ["Jan", "Jan"], ["2024-01-05", "2024-01-05"], ["007", "007"], ["0.5", 0.5], ["0", 0], ["1,2,3", "1,2,3"], ["12abc", "12abc"], ["  hello ", "hello"], ["-", "-"], ["Infinity", "Infinity"]];
  for (const [input, want] of cases) assert.deepEqual(coerceCell(input), want, JSON.stringify(input));
  assert.equal(coerceCell("1,500", { decimal: "," }), 1.5, "a table known to be French"); assert.equal(coerceCell("1,500"), 1500); assert.equal(coerceCell("3.5", { decimal: "," }), 3.5); assert.equal(coerceCell("1 500", { decimal: "," }), 1500);
});
test("chart: a table pasted from a spreadsheet (TSV) becomes columns + typed rows", () => {
  const t = parsePastedTable("Month\tSales\tNote\r\nJan\t10\tok\r\nFeb\t20.5\t\r\nMar\t\tlate\r\n");
  assert.deepEqual(t, { columns: ["Month", "Sales", "Note"], rows: [["Jan", 10, "ok"], ["Feb", 20.5, null], ["Mar", null, "late"]] });
  assert.deepEqual(parsePastedTable("1\t2\n3\t4"), { columns: ["Column 1", "Column 2"], rows: [[1, 2], [3, 4]] }, "no header when the first line has numbers");
  assert.deepEqual(parsePastedTable("A\tA\t\nx\t1"), { columns: ["A", "A (2)", "Column 3"], rows: [["x", 1, null]] }, "duplicate / missing names are repaired; rows are padded");
  assert.deepEqual(parsePastedTable(""), { columns: [], rows: [] }); assert.deepEqual(parsePastedTable(" \n \n"), { columns: [], rows: [] });
  assert.deepEqual(parsePastedTable("solo"), { columns: ["Column 1"], rows: [["solo"]] });
});
test("chart: French decimals in pasted tables — accepted when a cell proves them, never in comma-separated text", () => {
  assert.deepEqual(parsePastedTable("Mois\tPrix\nJanv\t1,5\nFévr\t2,25\nMars\t1,500"), { columns: ["Mois", "Prix"], rows: [["Janv", 1.5], ["Févr", 2.25], ["Mars", 1.5]] }, "1,500 follows the table's convention");
  assert.deepEqual(parsePastedTable("City\tPop\nA\t1,500\nB\t12,000").rows, [["A", 1500], ["B", 12000]], "without evidence a comma + 3 digits is a thousands separator");
  assert.deepEqual(parsePastedTable("Mois;Prix\nJanv;1,5\nFévr;1 234,75"), { columns: ["Mois", "Prix"], rows: [["Janv", 1.5], ["Févr", 1234.75]] }, "semicolon CSV");
  assert.deepEqual(parsePastedTable("a,b\n1,5\n2,7"), { columns: ["a", "b"], rows: [[1, 5], [2, 7]] }, "comma CSV: the comma separates");
  assert.deepEqual(parsePastedTable('name,quote\n"Doe, Jane","say ""hi"""\n"multi\nline",3'), { columns: ["name", "quote"], rows: [["Doe, Jane", 'say "hi"'], ["multi\nline", 3]] }, "quoted CSV fields");
  assert.equal(detectDelimiter("a\tb,c"), "\t"); assert.equal(detectDelimiter("a;b\nc;d"), ";"); assert.equal(detectDelimiter("a,b"), ","); assert.equal(detectDelimiter("abc"), ",");
  assert.deepEqual(parsePastedCells("x\t1,5\n\t2"), [["x", 1.5], [null, 2]]); assert.equal(uniqueName(" ", ["Column"]), "Column (2)");
});
test("chart: niceTicks uses 1-2-5 steps and always covers the domain", () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]); assert.deepEqual(niceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(niceTicks(3, 97, 5), [0, 20, 40, 60, 80, 100]); assert.deepEqual(niceTicks(-50, 50, 4), [-50, 0, 50]);
  assert.deepEqual(niceTicks(-37, 12, 5), [-40, -30, -20, -10, 0, 10, 20]); assert.deepEqual(niceTicks(-0.9, -0.1, 4), [-1, -0.8, -0.6, -0.4, -0.2, 0]);
  assert.deepEqual(niceTicks(0.001, 0.0045, 4), [0.001, 0.002, 0.003, 0.004, 0.005]); assert.deepEqual(niceTicks(1200, 9800, 5), [0, 2000, 4000, 6000, 8000, 10000]);
  assert.deepEqual(niceTicks(40, 60, 5), [40, 45, 50, 55, 60], "no forced zero by default"); assert.deepEqual(niceTicks(40, 60, 5, { zero: true }), [0, 20, 40, 60], "bars and areas start at zero");
  assert.deepEqual(niceTicks(-60, -40, 5, { zero: true }), [-60, -40, -20, 0]); assert.deepEqual(niceTicks(100, 0, 5), [0, 20, 40, 60, 80, 100], "reversed input");
  assert.deepEqual(niceTicks(0, 0, 5), [0, 0.2, 0.4, 0.6, 0.8, 1], "zero-width at 0"); assert.deepEqual(niceTicks(5, 5, 5), [2, 3, 4, 5, 6, 7, 8], "zero-width domain is widened");
  assert.deepEqual(niceTicks(5, 5, 5, { zero: true }), [0, 1, 2, 3, 4, 5]); assert.deepEqual(niceTicks(-5, -5, 5), [-8, -7, -6, -5, -4, -3, -2]); assert.deepEqual(niceTicks(NaN, Infinity, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  for (const [lo, hi] of [[0.13, 0.97], [-1234.5, 88], [7, 7.0001], [1e6, 3.2e7], [-3, -2.2]] as const) for (const n of [2, 4, 5, 8]) {
    const t = niceTicks(lo, hi, n); assert.ok(t.length >= 2 && t.length <= n + 3, `${lo}..${hi}/${n}: ${t}`); assert.ok(t[0] <= lo && t[t.length - 1] >= hi, `${lo}..${hi} covered by ${t}`);
    const step = t[1] - t[0], lead = Number((step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9))).toPrecision(6)); assert.ok([1, 2, 5, 10].includes(lead), `step ${step} of ${t}`);
    for (let i = 2; i < t.length; i++) near(t[i] - t[i - 1], step, Math.abs(step) * 1e-6);
  }
});
test("chart: linear and band scales", () => {
  const s = linearScale([0, 100], [300, 20]); assert.equal(s(0), 300); assert.equal(s(100), 20); assert.equal(s(50), 160); assert.equal(s(-10), 328); assert.deepEqual(s.domain, [0, 100]);
  assert.equal(linearScale([5, 5], [0, 200])(5), 100, "zero-width domain → middle of the range"); assert.equal(linearScale([5, 5], [0, 200])(99), 100);
  const b = bandScale(4, [100, 500], 0.2); assert.equal(b.step, 100); assert.equal(b.bandwidth, 80); assert.equal(b.start(0), 110); assert.equal(b.center(0), 150); assert.equal(b.start(3), 410); assert.equal(b.start(3) + b.bandwidth, 490);
  const p = bandScale(3, [0, 300], 0); assert.equal(p.bandwidth, 100); assert.equal(p.center(1), 150); assert.ok(Number.isFinite(bandScale(0, [0, 10]).bandwidth), "n = 0 does not divide by zero");
});
test("chart: numeric columns and the default configuration", () => {
  const cols = ["City", "Pop", "Code", "Mixed"], rows = [["A", 10, "007", 1], ["B", "12,5", "008", "n/a"], ["C", null, "009", 3]];
  assert.deepEqual(numericColumn(rows, cols, "Pop"), [10, 12.5, null]); assert.deepEqual(numericColumn(rows, cols, "City"), [null, null, null]); assert.equal(numericColumn(rows, cols, "Nope"), null); assert.equal(numericColumn(rows, cols, null), null);
  assert.equal(isNumericColumn(rows, cols, "Pop"), true); assert.equal(isNumericColumn(rows, cols, "Code"), false); assert.equal(isNumericColumn(rows, cols, "Mixed"), false); assert.equal(isNumericColumn([], cols, "Pop"), false);
  assert.deepEqual(defaultChartConfig(cols, rows), { x: "City", y: ["Pop"] });
  assert.deepEqual(defaultChartConfig(["a", "b", "c"], [[1, 2, 3], [4, 5, 6]]), { x: "a", y: ["b", "c"] }, "all numeric: the first column is X");
  assert.deepEqual(defaultChartConfig(["v"], [[1], [2]]), { x: null, y: ["v"] }); assert.deepEqual(defaultChartConfig(["n", "Name"], [[1, "x"]]), { x: "Name", y: ["n"] }); assert.deepEqual(defaultChartConfig([], []), { x: null, y: [] });
  assert.deepEqual(defaultChartConfig(["a", "b"], [["x", "y"]]), { x: "a", y: [] });
});
test("chart: path helpers", () => {
  assert.equal(linePath([{ x: 0, y: 0 }, { x: 10, y: 5.126 }, null, { x: 30, y: 1 }, { x: 40, y: 2 }]), "M0,0L10,5.13 M30,1L40,2"); assert.equal(linePath([]), ""); assert.equal(linePath([null, { x: 1, y: 2 }]), "M1,2");
  assert.equal(areaPath([{ x: 0, y: 10 }, { x: 10, y: 20 }, null, { x: 30, y: 5 }], 100), "M0,100L0,10L10,20L10,100Z M30,100L30,5L30,100Z"); assert.equal(areaPath([], 10), "");
  assert.equal(arcPath(100, 100, 50, 0, Math.PI / 2), "M100,100L100,50A50,50 0 0,1 150,100Z", "quarter from 12 o'clock, clockwise");
  assert.ok(arcPath(100, 100, 50, 0, Math.PI * 1.5).includes(" 0 1,1 "), "large-arc flag beyond a half turn");
  const full = arcPath(100, 100, 50, 0, Math.PI * 2); assert.equal((full.match(/A/g) ?? []).length, 2, "a full turn needs two arcs"); assert.ok(!full.includes("NaN"));
  assert.ok(arcPath(0, 0, 50, 0, 1, 20).startsWith("M0,-50A50,50"), "ring slice");
});
test("chart model — bar: grouped bars from the zero baseline", () => {
  const m = chartModel(attrs(), size);
  assert.deepEqual(m.problems, []); assert.deepEqual(m.series, [{ name: "Sales", color: 0 }, { name: "Costs", color: 1 }]); assert.equal(m.rects.length, 7, "the missing Costs of March has no bar");
  assert.equal(m.yTicks[0].value, 0); assert.ok(Number(m.yTicks[m.yTicks.length - 1].value) >= 30); near(m.baseline!, m.plot.y + m.plot.height);
  for (const r of m.rects) { assert.ok(r.x >= m.plot.x - 1e-6 && r.x + r.width <= m.plot.x + m.plot.width + 1e-6 && r.y >= m.plot.y - 1e-6 && r.height >= 0, JSON.stringify(r)); near(r.y + r.height, m.baseline!); }
  const [jan, janCosts] = m.rects.filter((r) => r.row === 0); assert.equal(jan.label, "Jan"); assert.equal(jan.value, 10); assert.ok(janCosts.x >= jan.x + jan.width, "grouped side by side"); assert.ok(janCosts.height < jan.height);
  const apr = m.rects.find((r) => r.row === 3 && r.series === 0)!; near(apr.height / jan.height, 3, 1e-6);
  assert.deepEqual(m.xTicks.map((t) => t.label), ["Jan", "Feb", "Mar", "Apr"]); assert.match(m.summary, /^Bar chart: 2 series \(Sales, Costs\) by “Month”, 4 rows; values from 4 to 30\.$/);
  const neg = chartModel(attrs({ rows: [["a", -10, 5], ["b", 20, -5]] }), size); const down = neg.rects.find((r) => r.value === -10)!; near(down.y, neg.baseline!); assert.ok(down.height > 0); assert.ok(neg.baseline! < neg.plot.y + neg.plot.height, "the baseline moves up when there are negatives");
  const many = chartModel(attrs({ rows: Array.from({ length: 120 }, (_, i) => [`r${i}`, i, 1]) }), { width: 320, height: 200 }); assert.ok(many.xTicks.length <= 5, "labels are thinned on a narrow chart"); assert.equal(many.rects.length, 240);
});
test("chart model — line and area: one path per series, gaps where a value is missing", () => {
  const m = chartModel(attrs({ kind: "line" }), size); assert.equal(m.lines.length, 2); assert.equal(m.rects.length, 0); assert.equal(m.lines[0].area, null);
  assert.equal(m.lines[0].points.filter(Boolean).length, 4); assert.equal(m.lines[1].points[2], null); assert.equal((m.lines[1].path.match(/M/g) ?? []).length, 2, "broken at the gap"); assert.equal((m.lines[0].path.match(/M/g) ?? []).length, 1);
  const xs = m.lines[0].points.map((p) => p!.x); assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1])); assert.ok(m.lines[0].points[3]!.y < m.lines[0].points[0]!.y, "larger value is higher");
  const a = chartModel(attrs({ kind: "area", y: ["Sales"], rows: [["a", 40], ["b", 60]] }), size); assert.equal(a.yTicks[0].value, 0, "areas include zero"); assert.ok(a.lines[0].area!.endsWith("Z")); assert.ok(a.lines[0].area!.includes(`,${Math.round(a.baseline! * 100) / 100}`));
  const l = chartModel(attrs({ kind: "line", y: ["Sales"], rows: [["a", 40], ["b", 60]] }), size); assert.equal(l.yTicks[0].value, 40, "lines do not force zero");
  const yr = chartModel({ kind: "line", title: "", columns: ["Year", "v"], rows: [[2024, 3], [2020, 1], [2021, 2]], x: "Year", y: ["v"] }, size);
  assert.deepEqual(yr.lines[0].points.map((p) => p!.label), ["2020", "2021", "2024"], "a numeric X is a real axis: sorted, spaced by value"); const [p0, p1, p2] = yr.lines[0].points.map((p) => p!.x); near((p2 - p0) / (p1 - p0), 4, 1e-6);
});
test("chart model — pie: first value column, angles sum to 2π, labels carry percentages", () => {
  const m = chartModel(attrs({ kind: "pie", rows: [["A", 50, 1], ["B", 25, 1], ["C", 0, 1], ["D", -5, 1], ["E", 25, 1], ["F", null, 1]] }), { width: 300, height: 300 });
  assert.deepEqual(m.problems, []); assert.equal(m.arcs.length, 3); near(m.arcs.reduce((a, s) => a + (s.end - s.start), 0), Math.PI * 2, 1e-12); assert.equal(m.arcs[0].start, 0); assert.equal(m.arcs[2].end, Math.PI * 2);
  for (let i = 1; i < m.arcs.length; i++) assert.equal(m.arcs[i].start, m.arcs[i - 1].end); near(m.arcs.reduce((a, s) => a + s.fraction, 0), 1);
  assert.deepEqual(m.arcs.map((s) => [s.label, s.percent]), [["A", "50 %"], ["B", "25 %"], ["E", "25 %"]]); assert.deepEqual(m.series.map((s) => s.name), ["A — 50 %", "B — 25 %", "E — 25 %"]);
  assert.ok(m.notes.some((n) => /one column/.test(n)) && m.notes.some((n) => /Negative/.test(n))); assert.match(m.summary, /Pie chart of “Sales”: 3 slices, total 100; largest A \(50 %\)/);
  const thirds = chartModel(attrs({ kind: "pie", y: ["Sales"], rows: [["a", 1], ["b", 1], ["c", 1], ["d", 4]] }), size); near(thirds.arcs.reduce((a, s) => a + (s.end - s.start), 0), Math.PI * 2, 1e-12); assert.equal(thirds.arcs[0].percent, "14 %");
  const one = chartModel(attrs({ kind: "pie", y: ["Sales"], rows: [["only", 7]] }), size); assert.equal(one.arcs.length, 1); assert.equal(one.arcs[0].percent, "100 %"); assert.ok(!one.arcs[0].path.includes("NaN"));
  assert.match(chartModel(attrs({ kind: "pie", y: ["Sales"], rows: [["a", 0], ["b", -2]] }), size).problems[0], /no positive value/);
});
test("chart model — scatter: numeric X required", () => {
  const m = chartModel({ kind: "scatter", title: "T", columns: ["h", "w", "name"], rows: [[150, 50, "a"], [180, 80, "b"], [null, 60, "c"], [165, null, "d"]], x: "h", y: ["w"] }, size);
  assert.deepEqual(m.problems, []); assert.equal(m.points.length, 2); assert.ok(m.points[0].x < m.points[1].x && m.points[0].y > m.points[1].y); assert.ok(m.xTicks.every((t) => typeof t.value === "number")); assert.ok(m.notes.some((n) => /1 row without an X number/.test(n)));
  assert.match(m.summary, /^Scatter plot “T”: “w” by “h”/);
  assert.match(chartModel(attrs({ kind: "scatter" }), size).problems[0], /“Month” \(X\) must contain numbers/); assert.match(chartModel(attrs({ kind: "scatter", x: null }), size).problems[0], /needs a numeric column for X/);
});
test("chart model — invalid configurations give problems, never an exception", () => {
  const p = (over: Partial<ChartAttrs>) => chartModel(attrs(over), size);
  assert.match(p({ columns: [], rows: [], x: null, y: [] }).problems[0], /No data yet/); assert.match(p({ rows: [] }).problems[0], /no rows/); assert.match(p({ y: [] }).problems[0], /Choose at least one numeric column/);
  assert.match(p({ y: ["Month"] }).problems[0], /contain no numbers/); assert.match(p({ y: ["Gone"] }).problems[0], /contain no numbers/); assert.ok(p({ y: ["Gone"] }).notes.some((n) => /“Gone” no longer exists/.test(n)));
  const partial = p({ y: ["Gone", "Costs"], x: "Missing" }); assert.deepEqual(partial.problems, []); assert.equal(partial.series.length, 1); assert.equal(partial.notes.length, 2); assert.deepEqual(partial.xTicks.map((t) => t.label), ["1", "2", "3", "4"], "rows are numbered without an X column");
  for (const kind of ["bar", "line", "area", "pie", "scatter"] as const) {
    const bad = p({ kind, y: [] }); assert.equal(bad.problems.length, 1); assert.equal(bad.rects.length + bad.lines.length + bad.arcs.length + bad.points.length, 0); assert.ok(bad.summary.includes(bad.problems[0]));
    for (const junk of [{ rows: [[], [null], ["x"]] as ChartAttrs["rows"] }, { rows: "nope" as unknown as ChartAttrs["rows"] }, { y: null as unknown as string[] }, { kind: "radar" as unknown as ChartAttrs["kind"] }, { title: undefined as unknown as string }]) assert.doesNotThrow(() => chartModel(attrs({ kind, ...junk }), size));
    for (const sz of [{ width: 0, height: 0 }, { width: 360, height: 200 }, { width: NaN, height: -5 }]) { const mm = chartModel(attrs({ kind, x: kind === "scatter" ? "Sales" : "Month", y: ["Costs"] }), sz); assert.ok(JSON.stringify(mm).indexOf("NaN") === -1 && !JSON.stringify(mm).includes("null,\"y\":null"), `${kind} ${JSON.stringify(sz)}`); assert.ok(mm.plot.width > 0 && mm.plot.height > 0); }
  }
  const flat = p({ rows: [["a", 5, 5], ["b", 5, 5]], kind: "line" }); assert.deepEqual(flat.problems, []); assert.ok(flat.yTicks.length >= 2, "a constant series still gets an axis"); assert.ok(flat.lines[0].points.every((q) => q && Number.isFinite(q.y)));
});
test("chart: number formatting", () => {
  assert.equal(formatNumber(1234.5678), "1234.57"); assert.equal(formatNumber(0.123456), "0.1235"); assert.equal(formatNumber(12000, { compact: true }), "12k"); assert.equal(formatNumber(2500000, { compact: true }), "2.5M"); assert.equal(formatNumber(950, { compact: true }), "950"); assert.equal(formatNumber(0.5, { decimals: 1 }), "0.5"); assert.equal(formatNumber(NaN), "–");
});
