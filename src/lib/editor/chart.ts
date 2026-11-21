/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/editor/chart.ts
 * Description      : pure logic of the `chart` block (SPEC §2) — cell coercion
 *                    and pasted-table parsing (TSV / CSV, French decimals),
 *                    nice axis ticks, linear and band scales, SVG path helpers
 *                    and `chartModel`, which turns the stored attrs into a
 *                    renderer-agnostic model in pixels (bars, lines, areas,
 *                    arcs, points, ticks, legend, problems). Nothing throws on
 *                    a bad configuration: the model lists what is wrong
 *                    instead. No DOM, nothing happens at import time.
 * Module           : lib
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

import type { ChartAttrs, ChartCell, ChartKind } from "./next-node-defs";

export const CHART_KINDS: readonly ChartKind[] = ["bar", "line", "area", "pie", "scatter"];
/** Number of categorical colour slots of the renderer's palette (`--ch-1` … `--ch-8`); indexes wrap beyond it. */
export const CHART_COLORS = 8;

// ---------- cells and pasted tables ----------
const PLAIN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const EN_THOUSANDS = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const FR_NUMBER = /^[+-]?(\d{1,3}([.\s]\d{3})+|\d+)(,\d+)?$/;
const strip = (s: string) => s.replace(/[  ]/g, " ").trim().replace(/^([+-]?)\s*[$€£]\s*/, "$1").replace(/\s*[$€£%]$/, "").replace(/^\((.+)\)$/, "-$1");
/**
 * Text of a cell → number, string or null (empty). Numbers: plain and scientific notation, English thousands (`1,234.5`), a French
 * decimal comma when it cannot be anything else (`1,5`, `12,75`, `1 234,5`), an optional currency / percent sign. `decimal: ","`
 * (a table known to be French) also reads `1,500` as 1.5. Codes with a leading zero (`007`) stay text.
 */
export function coerceCell(text: string, opts: { decimal?: "." | "," } = {}): ChartCell {
  const raw = String(text ?? "").replace(/[  ]/g, " ").trim(); if (raw === "") return null;
  const s = strip(raw); let n: number | null = null;
  if (/^[+-]?0\d/.test(s)) return raw;
  if (opts.decimal === ",") { if (FR_NUMBER.test(s) && (s.includes(",") || !PLAIN.test(s))) n = Number(s.replace(/[.\s]/g, "").replace(",", ".")); else if (PLAIN.test(s)) n = Number(s); }
  else if (PLAIN.test(s)) n = Number(s);
  else if (EN_THOUSANDS.test(s)) n = Number(s.replace(/,/g, ""));
  else if (/^[+-]?\d{1,3}( \d{3})+(\.\d+)?$/.test(s)) n = Number(s.replace(/ /g, ""));
  else if (FR_NUMBER.test(s) && s.includes(",")) n = Number(s.replace(/[.\s]/g, "").replace(",", "."));
  return n !== null && Number.isFinite(n) ? n : raw;
}
/** A comma that can only be a decimal separator: not followed by exactly three digits, or combined with `.`/space thousands. */
const frenchEvidence = (s: string) => { const t = strip(s); return FR_NUMBER.test(t) && t.includes(",") && !EN_THOUSANDS.test(t); };

function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, i = 0; const s = text.replace(/\r\n?/g, "\n");
  while (i < s.length) {
    const c = s[i];
    if (quoted) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; } else cell += c; }
    else if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
    i++;
  }
  row.push(cell); rows.push(row);
  while (rows.length && rows[rows.length - 1].every((x) => x.trim() === "")) rows.pop();
  return rows;
}
const countOf = (line: string, ch: string) => { let n = 0, q = false; for (const c of line) { if (c === '"') q = !q; else if (c === ch && !q) n++; } return n; };
/** Delimiter of a pasted block: tab (spreadsheets) first, then `;` (French CSV), then `,`. */
export function detectDelimiter(text: string): "\t" | ";" | "," {
  const lines = text.split(/\r\n?|\n/).filter((l) => l.trim() !== "");
  if (lines.some((l) => l.includes("\t"))) return "\t";
  const semi = lines.map((l) => countOf(l, ";")), comma = lines.map((l) => countOf(l, ","));
  if (semi[0] > 0 && semi.every((n) => n === semi[0])) return ";";
  if (comma[0] > 0) return ",";
  return semi[0] > 0 ? ";" : ",";
}
/** Pasted block → matrix of coerced cells (no header detection). French decimals are accepted when at least one cell proves them. */
export function parsePastedCells(text: string): ChartCell[][] {
  if (!text || text.trim() === "") return [];
  const delimiter = detectDelimiter(text), raw = splitDelimited(text, delimiter);
  const french = delimiter !== "," && raw.some((r) => r.some(frenchEvidence));
  return raw.map((r) => r.map((c) => coerceCell(c, french ? { decimal: "," } : {})));
}
export function uniqueName(name: string, taken: readonly string[]): string {
  const base = name.trim() || "Column"; if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) { const n = `${base} (${i})`; if (!taken.includes(n)) return n; }
}
/**
 * A table pasted from a spreadsheet (TSV) or a CSV → `{columns, rows}`. The first line is the header when none of its cells is a
 * number and something follows it; otherwise columns are named "Column 1"… Rows are padded with null to the widest line.
 */
export function parsePastedTable(text: string): { columns: string[]; rows: ChartCell[][] } {
  const cells = parsePastedCells(text); if (!cells.length) return { columns: [], rows: [] };
  const width = Math.max(...cells.map((r) => r.length));
  const header = cells.length > 1 && cells[0].some((c) => c !== null) && cells[0].every((c) => typeof c !== "number");
  const columns: string[] = [];
  for (let i = 0; i < width; i++) columns.push(uniqueName(header && cells[0][i] != null ? String(cells[0][i]) : `Column ${i + 1}`, columns));
  const rows = (header ? cells.slice(1) : cells).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null));
  return { columns, rows };
}

// ---------- columns ----------
const cellNumber = (c: ChartCell | undefined): number | null => { if (typeof c === "number") return Number.isFinite(c) ? c : null; if (typeof c === "string") { const v = coerceCell(c); return typeof v === "number" ? v : null; } return null; };
/** The column as numbers (null where a cell is empty or not a number); null when the column does not exist. */
export function numericColumn(rows: readonly ChartCell[][], columns: readonly string[], name: string | null): (number | null)[] | null {
  const i = name == null ? -1 : columns.indexOf(name); if (i < 0) return null;
  return rows.map((r) => cellNumber(r[i]));
}
/** A column is numeric when it has at least one number and no cell that is text. */
export function isNumericColumn(rows: readonly ChartCell[][], columns: readonly string[], name: string): boolean {
  const i = columns.indexOf(name); if (i < 0) return false; let seen = 0;
  for (const r of rows) { const c = r[i]; if (c == null || c === "") continue; if (cellNumber(c) === null) return false; seen++; }
  return seen > 0;
}
/** x = first non-numeric column (else the first one, else row numbers when there is a single column); y = the numeric columns. */
export function defaultChartConfig(columns: readonly string[], rows: readonly ChartCell[][]): { x: string | null; y: string[] } {
  if (!columns.length) return { x: null, y: [] };
  const numeric = columns.filter((c) => isNumericColumn(rows, columns, c));
  const label = columns.find((c) => !numeric.includes(c));
  if (label !== undefined) return { x: label, y: numeric };
  if (columns.length === 1) return { x: null, y: numeric };
  return { x: columns[0], y: numeric.slice(1) };
}

// ---------- scales ----------
const decimalsOf = (step: number) => { if (!Number.isFinite(step) || step <= 0) return 0; const e = Math.floor(Math.log10(step) + 1e-9); return e >= 0 ? 0 : Math.min(12, -e); };
/**
 * Round axis values covering [min, max] with a 1-2-5 × 10ⁿ step, about `count` intervals. A zero-width or invalid domain is widened
 * so there are always at least two ticks. `zero: true` (bars, areas) extends the domain to include 0.
 */
export function niceTicks(min: number, max: number, count = 5, opts: { zero?: boolean } = {}): number[] {
  let lo = Number.isFinite(min) ? min : 0, hi = Number.isFinite(max) ? max : 1; if (lo > hi) [lo, hi] = [hi, lo];
  if (opts.zero) { if (lo > 0) lo = 0; if (hi < 0) hi = 0; }
  if (lo === hi) { if (lo === 0) hi = 1; else { const pad = Math.abs(lo) * 0.5; lo -= pad; hi += pad; if (opts.zero) { if (lo > 0) lo = 0; if (hi < 0) hi = 0; } } }
  const n = Math.max(1, Math.floor(count) || 1), rough = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(rough))), f = rough / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag, d = decimalsOf(step);
  const start = Math.floor(lo / step + 1e-9), end = Math.ceil(hi / step - 1e-9), out: number[] = [];
  for (let i = start; i <= end; i++) { const v = Number((i * step).toFixed(d)); out.push(v === 0 ? 0 : v); }
  return out;
}
export interface LinearScale { (v: number): number; domain: [number, number]; range: [number, number] }
/** Linear map domain → range. A zero-width domain maps everything to the middle of the range. */
export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain, [r0, r1] = range, span = d1 - d0;
  const f = (v: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0));
  return Object.assign(f, { domain, range });
}
export interface BandScale { step: number; bandwidth: number; start: (i: number) => number; center: (i: number) => number }
/** `n` equal bands across the range; `padding` (0..1) is the share of each step left empty, half on each side of the band. */
export function bandScale(n: number, range: [number, number], padding = 0.2): BandScale {
  const count = Math.max(1, Math.floor(n)), step = (range[1] - range[0]) / count, pad = Math.max(0, Math.min(0.95, padding)), bandwidth = step * (1 - pad);
  const start = (i: number) => range[0] + step * i + (step - bandwidth) / 2;
  return { step, bandwidth, start, center: (i) => start(i) + bandwidth / 2 };
}

// ---------- paths ----------
const f2 = (n: number) => { const v = Math.round(n * 100) / 100; return String(v === 0 ? 0 : v); };
export interface XYPoint { x: number; y: number }
/** Polyline through the points; a null breaks the line (missing value). */
export function linePath(points: readonly (XYPoint | null)[]): string {
  let d = "", pen = false;
  for (const p of points) { if (!p) { pen = false; continue; } d += `${pen ? "L" : d ? " M" : "M"}${f2(p.x)},${f2(p.y)}`; pen = true; }
  return d;
}
/** Closed area between the points and the horizontal baseline `y0`; a null splits it into separate pieces. */
export function areaPath(points: readonly (XYPoint | null)[], y0: number): string {
  let d = ""; let run: XYPoint[] = [];
  const close = () => { if (run.length) d += `${d ? " " : ""}M${f2(run[0].x)},${f2(y0)}${run.map((p) => `L${f2(p.x)},${f2(p.y)}`).join("")}L${f2(run[run.length - 1].x)},${f2(y0)}Z`; run = []; };
  for (const p of points) { if (p) run.push(p); else close(); }
  close(); return d;
}
/** Pie slice (or ring slice when `inner` > 0). Angles in radians, 0 = 12 o'clock, clockwise. A full turn is drawn as two halves. */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number, inner = 0): string {
  const pt = (a: number, rad: number) => `${f2(cx + rad * Math.sin(a))},${f2(cy - rad * Math.cos(a))}`;
  const sweep = end - start;
  if (sweep >= Math.PI * 2 - 1e-9) {
    const mid = start + Math.PI, ring = (rad: number, dir: 0 | 1) => `M${pt(start, rad)}A${f2(rad)},${f2(rad)} 0 1,${dir} ${pt(mid, rad)}A${f2(rad)},${f2(rad)} 0 1,${dir} ${pt(start, rad)}Z`;
    return inner > 0 ? `${ring(r, 1)} ${ring(inner, 0)}` : ring(r, 1);
  }
  const large = sweep > Math.PI ? 1 : 0;
  if (inner > 0) return `M${pt(start, r)}A${f2(r)},${f2(r)} 0 ${large},1 ${pt(end, r)}L${pt(end, inner)}A${f2(inner)},${f2(inner)} 0 ${large},0 ${pt(start, inner)}Z`;
  return `M${f2(cx)},${f2(cy)}L${pt(start, r)}A${f2(r)},${f2(r)} 0 ${large},1 ${pt(end, r)}Z`;
}

// ---------- model ----------
/** Compact human number: at most 4 significant decimals, `k`/`M`/`B` suffix from 10 000 up when `compact`. */
export function formatNumber(v: number, opts: { compact?: boolean; decimals?: number } = {}): string {
  if (!Number.isFinite(v)) return "–"; const a = Math.abs(v);
  if (opts.compact && a >= 1e4) { const [div, suf] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1e3, "k"]; return `${Number((v / div).toFixed(a / div >= 100 ? 0 : 1))}${suf}`; }
  if (opts.decimals != null) return v.toFixed(opts.decimals);
  return String(Number(v.toFixed(a >= 100 ? 2 : 4)));
}
export interface ChartTick { value: number | string; label: string; px: number }
export interface ChartSeries { name: string; color: number }
export interface ChartRect { series: number; row: number; x: number; y: number; width: number; height: number; label: string; value: number }
export interface ChartPoint { series: number; row: number; x: number; y: number; label: string; value: number }
export interface ChartLine { series: number; points: (ChartPoint | null)[]; path: string; area: string | null }
export interface ChartArc { index: number; row: number; color: number; start: number; end: number; fraction: number; value: number; label: string; percent: string; path: string }
export interface ChartModel {
  kind: ChartKind; width: number; height: number; plot: { x: number; y: number; width: number; height: number };
  /** legend entries: one per y column — one per slice for a pie */ series: ChartSeries[];
  xTicks: ChartTick[]; yTicks: ChartTick[]; /** px of the value 0 on the y axis (bar / area baseline), null without a y axis */ baseline: number | null;
  rects: ChartRect[]; lines: ChartLine[]; points: ChartPoint[]; arcs: ChartArc[];
  /** reasons why nothing can be drawn (empty = drawable) */ problems: string[]; /** non-blocking remarks (ignored columns or rows) */ notes: string[];
  /** one-sentence description for assistive technology */ summary: string;
}
const KIND_NAME: Record<ChartKind, string> = { bar: "Bar chart", line: "Line chart", area: "Area chart", pie: "Pie chart", scatter: "Scatter plot" };
const labelOf = (c: ChartCell | undefined, row: number) => (c == null || c === "" ? `Row ${row + 1}` : String(c));
const extent = (vals: Iterable<number>): [number, number] | null => { let lo = Infinity, hi = -Infinity; for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; } return lo <= hi ? [lo, hi] : null; };

/**
 * Attrs + pixel size → everything a renderer needs. `bar`: grouped bars per row; `line` / `area` (not stacked): one path per y column,
 * positioned by value when the x column is numeric, by row otherwise; `pie`: the first y column, slices clockwise from 12 o'clock;
 * `scatter`: x must be numeric. Invalid configurations give `problems`, never an exception.
 */
export function chartModel(attrs: Pick<ChartAttrs, "kind" | "title" | "columns" | "rows" | "x" | "y">, size: { width: number; height: number }): ChartModel {
  const kind: ChartKind = CHART_KINDS.includes(attrs.kind) ? attrs.kind : "bar";
  const width = Math.max(40, Math.round(Number(size.width) || 0)), height = Math.max(40, Math.round(Number(size.height) || 0));
  const columns = Array.isArray(attrs.columns) ? attrs.columns : [], rows = Array.isArray(attrs.rows) ? attrs.rows.filter(Array.isArray) : [];
  const m: ChartModel = { kind, width, height, plot: { x: 0, y: 0, width, height }, series: [], xTicks: [], yTicks: [], baseline: null, rects: [], lines: [], points: [], arcs: [], problems: [], notes: [], summary: "" };
  const title = attrs.title?.trim() ? ` “${attrs.title.trim()}”` : "";
  const fail = (msg: string) => { m.problems.push(msg); m.summary = `${KIND_NAME[kind]}${title}: ${msg}`; return m; };
  if (!columns.length) return fail("No data yet.");
  if (!rows.length) return fail("The table has no rows.");
  const xi = attrs.x != null ? columns.indexOf(attrs.x) : -1;
  if (attrs.x != null && xi < 0) m.notes.push(`Column “${attrs.x}” (X) no longer exists; rows are numbered instead.`);
  const labels = rows.map((r, i) => (xi >= 0 ? labelOf(r[xi], i) : String(i + 1)));
  const ys: { name: string; values: (number | null)[]; color: number }[] = [];
  for (const [slot, name] of (Array.isArray(attrs.y) ? attrs.y : []).entries()) {
    const values = numericColumn(rows, columns, name);
    if (!values) { m.notes.push(`Column “${name}” no longer exists.`); continue; }
    if (!values.some((v) => v !== null)) { m.notes.push(`Column “${name}” has no numbers.`); continue; }
    ys.push({ name, values, color: slot % CHART_COLORS }); // the colour follows the column's slot in `y`, not what happens to be drawable
  }
  if (!ys.length) return fail(Array.isArray(attrs.y) && attrs.y.length ? "The selected value columns contain no numbers." : "Choose at least one numeric column for the values (Y).");

  if (kind === "pie") {
    const { name, values } = ys[0]; if (ys.length > 1) m.notes.push(`A pie shows one column: “${name}”.`);
    const slices = values.map((v, row) => ({ v, row })).filter((s): s is { v: number; row: number } => s.v !== null && s.v > 0);
    if (values.some((v) => v !== null && v < 0)) m.notes.push("Negative values cannot be shown in a pie and are left out.");
    const total = slices.reduce((a, s) => a + s.v, 0);
    if (!slices.length || total <= 0) return fail(`Column “${name}” has no positive value to share out.`);
    const r = Math.max(8, Math.min(width, height) / 2 - 6), cx = width / 2, cy = height / 2; let angle = 0;
    m.plot = { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r };
    slices.forEach((s, index) => {
      const fraction = s.v / total, start = angle, end = index === slices.length - 1 ? Math.PI * 2 : angle + fraction * Math.PI * 2; angle = end;
      const percent = `${formatNumber(fraction * 100, { decimals: fraction * 100 >= 10 || fraction === 0 ? 0 : 1 })} %`;
      m.arcs.push({ index, row: s.row, color: index % CHART_COLORS, start, end, fraction, value: s.v, label: labels[s.row], percent, path: arcPath(cx, cy, r, start, end) });
      m.series.push({ name: `${labels[s.row]} — ${percent}`, color: index % CHART_COLORS });
    });
    const top = [...m.arcs].sort((a, b) => b.value - a.value)[0];
    m.summary = `${KIND_NAME.pie}${title} of “${name}”: ${m.arcs.length} slice${m.arcs.length > 1 ? "s" : ""}, total ${formatNumber(total)}; largest ${top.label} (${top.percent}).`;
    return m;
  }

  m.series = ys.map((s) => ({ name: s.name, color: s.color }));
  const xNum = xi >= 0 ? rows.map((r) => cellNumber(r[xi])) : null;
  const xNumeric = !!xNum && xNum.some((v) => v !== null) && rows.every((r, i) => xNum[i] !== null || r[xi] == null || r[xi] === "");
  if (kind === "scatter" && !xNumeric) return fail(xi < 0 ? "A scatter plot needs a numeric column for X." : `Column “${columns[xi]}” (X) must contain numbers for a scatter plot.`);
  const linearX = kind === "scatter" || ((kind === "line" || kind === "area") && xNumeric && new Set(xNum!.filter((v) => v !== null)).size > 1);
  const used = (row: number) => !linearX || xNum![row] !== null;
  const yExt = extent((function* () { for (const s of ys) for (let i = 0; i < s.values.length; i++) { const v = s.values[i]; if (v !== null && used(i)) yield v; } })());
  if (!yExt) return fail("No row has both an X and a Y number.");
  const yTicks = niceTicks(yExt[0], yExt[1], height < 220 ? 4 : 5, { zero: kind === "bar" || kind === "area" });
  const yStep = yTicks.length > 1 ? Math.abs(yTicks[1] - yTicks[0]) : 1, yDec = decimalsOf(yStep), compact = Math.max(Math.abs(yTicks[0]), Math.abs(yTicks[yTicks.length - 1])) >= 1e4;
  const yLabels = yTicks.map((v) => formatNumber(v, compact ? { compact: true } : { decimals: yDec }));
  const left = Math.min(72, Math.max(26, Math.max(...yLabels.map((l) => l.length)) * 6.5 + 10)), right = 12, top = 10, bottom = 26;
  const plot = (m.plot = { x: left, y: top, width: Math.max(10, width - left - right), height: Math.max(10, height - top - bottom) });
  const y = linearScale([yTicks[0], yTicks[yTicks.length - 1]], [plot.y + plot.height, plot.y]);
  m.yTicks = yTicks.map((v, i) => ({ value: v, label: yLabels[i], px: y(v) }));
  m.baseline = y(Math.max(yTicks[0], Math.min(yTicks[yTicks.length - 1], 0)));
  const maxLabels = Math.max(2, Math.floor(plot.width / 64));
  let xAt: (row: number) => number | null;
  if (linearX) {
    const xe = extent(xNum!.filter((v): v is number => v !== null))!, ticks = niceTicks(xe[0], xe[1], Math.min(6, maxLabels));
    const x = linearScale([ticks[0], ticks[ticks.length - 1]], [plot.x, plot.x + plot.width]), xDec = decimalsOf(ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1), big = Math.max(Math.abs(ticks[0]), Math.abs(ticks[ticks.length - 1])) >= 1e4;
    m.xTicks = ticks.map((v) => ({ value: v, label: formatNumber(v, big ? { compact: true } : { decimals: xDec }), px: x(v) }));
    xAt = (row) => (xNum![row] === null ? null : x(xNum![row]!));
    const skipped = rows.length - xNum!.filter((v) => v !== null).length; if (skipped) m.notes.push(`${skipped} row${skipped > 1 ? "s" : ""} without an X number left out.`);
  } else {
    const band = bandScale(rows.length, [plot.x, plot.x + plot.width], kind === "bar" ? 0.24 : 0), every = Math.ceil(rows.length / maxLabels);
    m.xTicks = labels.map((label, i) => ({ value: label, label, px: band.center(i) })).filter((_, i) => i % every === 0);
    xAt = (row) => band.center(row);
    if (kind === "bar") {
      const gap = ys.length > 1 ? Math.min(2, band.bandwidth / (ys.length * 4)) : 0, w = Math.max(0.5, (band.bandwidth - gap * (ys.length - 1)) / ys.length);
      ys.forEach((s, si) => s.values.forEach((v, row) => { if (v === null) return; const py = y(v); m.rects.push({ series: si, row, x: band.start(row) + si * (w + gap), y: Math.min(py, m.baseline!), width: w, height: Math.abs(py - m.baseline!), label: labels[row], value: v }); }));
    }
  }
  if (kind === "scatter") ys.forEach((s, si) => s.values.forEach((v, row) => { const px = xAt(row); if (v !== null && px !== null) m.points.push({ series: si, row, x: px, y: y(v), label: labels[row], value: v }); }));
  if (kind === "line" || kind === "area") ys.forEach((s, si) => {
    let order = rows.map((_, i) => i); if (linearX) order = order.filter((i) => xNum![i] !== null).sort((a, b) => xNum![a]! - xNum![b]!);
    const points = order.map((row): ChartPoint | null => { const v = s.values[row], px = xAt(row); return v === null || px === null ? null : { series: si, row, x: px, y: y(v), label: labels[row], value: v }; });
    m.lines.push({ series: si, points, path: linePath(points), area: kind === "area" ? areaPath(points, m.baseline!) : null });
  });
  const names = ys.map((s) => s.name);
  m.summary = `${KIND_NAME[kind]}${title}: ${names.length === 1 ? `“${names[0]}”` : `${names.length} series (${names.join(", ")})`} ${xi >= 0 ? `by “${columns[xi]}”` : "by row"}, ${rows.length} row${rows.length > 1 ? "s" : ""}; values from ${formatNumber(yExt[0])} to ${formatNumber(yExt[1])}.`;
  return m;
}
