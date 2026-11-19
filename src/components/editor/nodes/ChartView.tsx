"use client";
/**
 * file: src/components/editor/nodes/ChartView.tsx
 * description: node view of the `chart` block (SPEC §2) — a small SVG renderer of its own (bar, line, area, pie, scatter) driven by
 *   `chartModel`, sized by a ResizeObserver so it never widens the page, with a legend, `<title>` on every mark and a spoken summary;
 *   plus the editing side: inline title, kind switcher, X / Y mapping and an editable data grid (cells, rows, columns, paste from a
 *   spreadsheet). Typing is written to the document ~400 ms after the last key; structural actions at once. A chart fed by a database
 *   (`source: {databaseId, viewId?}`) reads its rows live through `POST /api/query` (see ./live.tsx): `columns` / `rows` then hold the
 *   last snapshot (what native clients and offline readers draw), rewritten — outside the undo history — only when the live data
 *   differs. Offline or on a server error the snapshot is drawn and flagged as such.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartArea, ChartColumn, ChartLine, ChartPie, ChartScatter, ClipboardPaste, Database, Plus, RefreshCw, Table2, Unlink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { ChartAttrs, ChartCell, ChartKind } from "@/lib/editor/next-node-defs";
import { chartModel, coerceCell, defaultChartConfig, formatNumber, parsePastedCells, parsePastedTable, uniqueName, type ChartModel } from "@/lib/editor/chart";
import { chartQueryBody, sameTable } from "@/lib/editor/query";
import { api } from "@/lib/client/api";
import { NodeButton, NodeFrame, NodeState, useDebounced, type LeafViewProps } from "./frame";
import { useLiveQuery, LiveBadge } from "./live";

type Data = Pick<ChartAttrs, "title" | "columns" | "rows" | "x" | "y">;
const KINDS: { kind: ChartKind; label: string; icon: React.ReactNode }[] = [
  { kind: "bar", label: "Bar", icon: <ChartColumn /> }, { kind: "line", label: "Line", icon: <ChartLine /> }, { kind: "area", label: "Area", icon: <ChartArea /> }, { kind: "pie", label: "Pie", icon: <ChartPie /> }, { kind: "scatter", label: "Scatter", icon: <ChartScatter /> },
];
/** Honest starter content: named as a sample so nobody mistakes it for real figures. */
const SAMPLE: Data = { title: "Sample data", columns: ["Month", "Value"], rows: [["Jan", 12], ["Feb", 18], ["Mar", 15], ["Apr", 22], ["May", 27], ["Jun", 24]], x: "Month", y: ["Value"] };
const ROWS_SHOWN = 100;
const fromAttrs = (a: ChartAttrs): Data => ({ title: typeof a.title === "string" ? a.title : "", columns: Array.isArray(a.columns) ? a.columns : [], rows: Array.isArray(a.rows) ? a.rows : [], x: a.x ?? null, y: Array.isArray(a.y) ? a.y : [] });
const show = (v: ChartCell | undefined) => (v == null ? "" : String(v));
const color = (i: number) => `var(--ch-${i + 1})`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

export function ChartView({ attrs, update, editable, selected, editor, getPos }: LeafViewProps<ChartAttrs>) {
  const [data, setData] = React.useState<Data>(() => fromAttrs(attrs));
  const [editing, setEditing] = React.useState(false);
  const [pasting, setPasting] = React.useState(false);
  const [all, setAll] = React.useState(false);
  const cur = React.useRef(data); const pending = React.useRef(false);
  const push = useDebounced((d: Data) => { pending.current = false; update({ title: d.title, columns: d.columns, rows: d.rows, x: d.x, y: d.y }); }, 400);
  // The document is the source of truth (undo, sync): follow it whenever no local keystroke is waiting to be written.
  React.useEffect(() => { if (!pending.current) { const d = fromAttrs(attrs); cur.current = d; setData(d); } }, [attrs.title, attrs.columns, attrs.rows, attrs.x, attrs.y]); // eslint-disable-line react-hooks/exhaustive-deps
  /** typing: local at once, document after a pause */
  const typing = React.useCallback((next: Data) => { cur.current = next; setData(next); pending.current = true; push(next); }, [push]);
  /** structural change: local and document at once (also carries any keystroke still waiting) */
  const apply = React.useCallback((next: Data) => { cur.current = next; setData(next); pending.current = true; push(next); push.flush(); }, [push]);

  const kind: ChartKind = KINDS.some((k) => k.kind === attrs.kind) ? attrs.kind : "bar";
  const snapshot = attrs.source != null, canEdit = editable;
  /* ---- live data of a chart fed by a database ---- */
  const liveBody = React.useMemo(() => (attrs.source?.databaseId ? chartQueryBody(attrs.source) : null), [attrs.source?.databaseId, attrs.source?.viewId]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useLiveQuery(liveBody, "database"); const fresh = snapshot && live.result && !live.stale ? live.result.table : null;
  /*
   * The stored snapshot follows the live data, but VIEWING a page never writes it (3.0 integration: opening a note with a live chart
   * used to create a save — a version, a new `rev`, a `page.edited` event — without any user edit). It is written only
   *  (1) on an explicit click on "Refresh", or (2) together with a real user edit of the document (the page is being saved anyway).
   * Never in the undo history (an undo must not fight the refresh), never when read-only. Meanwhile the live table is what is drawn.
   */
  const freshRef = React.useRef(fresh); freshRef.current = fresh; const explicitRefresh = React.useRef(false);
  const storeSnapshot = React.useCallback(() => {
    const table = freshRef.current; if (!table || !editor.isEditable || editor.isDestroyed || pending.current) return;
    const pos = getPos(); if (typeof pos !== "number") return; const node = editor.state.doc.nodeAt(pos); if (!node || node.type.name !== "chart") return;
    const a = node.attrs as ChartAttrs; if (a.source == null || sameTable(table, { columns: a.columns, rows: a.rows })) return;
    const keep = (a.x == null || table.columns.includes(a.x)) && a.y.length > 0 && a.y.every((c) => table.columns.includes(c));
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, columns: table.columns, rows: table.rows, ...(keep ? {} : defaultChartConfig(table.columns, table.rows)) }).setMeta("addToHistory", false).setMeta("chartSnapshot", true));
  }, [editor, getPos]);
  // (1) explicit refresh: store what came back
  React.useEffect(() => { if (explicitRefresh.current && fresh && !live.fetching) { explicitRefresh.current = false; storeSnapshot(); } }, [fresh, live.fetching, storeSnapshot]);
  // (2) a user edit elsewhere in the document carries the snapshot along
  React.useEffect(() => {
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean; getMeta: (k: string) => unknown } }) => { if (!transaction.docChanged || transaction.getMeta("chartSnapshot") || transaction.getMeta("addToHistory") === false) return; storeSnapshot(); };
    editor.on("update", onUpdate); return () => { editor.off("update", onUpdate); };
  }, [editor, storeSnapshot]);
  // what is drawn: the live table when there is one (a read-only reader cannot store it), else the stored snapshot
  const drawn: Data = React.useMemo(() => { if (!fresh || sameTable(fresh, data)) return data; const ok = (data.x == null || fresh.columns.includes(data.x)) && data.y.length > 0 && data.y.every((c) => fresh.columns.includes(c)); return { ...data, columns: fresh.columns, rows: fresh.rows, ...(ok ? {} : defaultChartConfig(fresh.columns, fresh.rows)) }; }, [fresh, data]);
  const hasData = drawn.columns.length > 0;
  const [linking, setLinking] = React.useState(false);
  const dbs = useQuery({ queryKey: ["tree-databases"], enabled: linking && canEdit, staleTime: 60_000, queryFn: async () => (await api<{ id: string; title: string; type: string; databaseId?: string | null }[]>("/api/tree")).filter((n) => n.type === "database") });
  const link = (databaseId: string) => { setLinking(false); if (databaseId) update({ source: { databaseId } }); };

  const setCell = React.useCallback((r: number, c: number, v: ChartCell) => {
    const d = cur.current; typing({ ...d, rows: d.rows.map((row, i) => (i === r ? Array.from({ length: Math.max(d.columns.length, row.length) }, (_, j) => (j === c ? v : row[j] ?? null)) : row)) });
  }, [typing]);
  const rename = React.useCallback((c: number, text: string) => {
    const d = cur.current, old = d.columns[c], name = uniqueName(text.trim() || `Column ${c + 1}`, d.columns.filter((_, i) => i !== c)); if (name === old) return;
    typing({ ...d, columns: d.columns.map((n, i) => (i === c ? name : n)), x: d.x === old ? name : d.x, y: d.y.map((n) => (n === old ? name : n)) });
  }, [typing]);
  const addRow = () => { const d = cur.current; apply({ ...d, rows: [...d.rows, d.columns.map(() => null)] }); if (d.rows.length >= ROWS_SHOWN) setAll(true); };
  const removeRow = (r: number) => { const d = cur.current; apply({ ...d, rows: d.rows.filter((_, i) => i !== r) }); };
  const addColumn = () => { const d = cur.current; apply({ ...d, columns: [...d.columns, uniqueName(`Column ${d.columns.length + 1}`, d.columns)], rows: d.rows.map((row) => [...Array.from({ length: d.columns.length }, (_, j) => row[j] ?? null), null]) }); };
  const removeColumn = (c: number) => {
    const d = cur.current, name = d.columns[c], columns = d.columns.filter((_, i) => i !== c);
    apply({ ...d, columns, rows: columns.length ? d.rows.map((row) => row.filter((_, i) => i !== c)) : [], x: d.x === name ? null : d.x, y: d.y.filter((n) => n !== name) });
  };
  const setX = (x: string | null) => { const d = cur.current; apply({ ...d, x, y: d.y.filter((n) => n !== x) }); };
  const toggleY = (name: string) => { const d = cur.current; apply({ ...d, y: d.y.includes(name) ? d.y.filter((n) => n !== name) : [...d.y, name] }); };
  const replaceTable = (t: { columns: string[]; rows: ChartCell[][] }) => { apply({ title: cur.current.title, ...t, ...defaultChartConfig(t.columns, t.rows) }); setPasting(false); setEditing(true); };
  /** A block of cells pasted into the grid lands at the focused cell and grows the table as needed (like a spreadsheet). */
  const onGridPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain"); if (!/[\t\n]/.test(text.replace(/[\r\n]+$/, ""))) return;
    e.preventDefault(); const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r]"), d = cur.current;
    if (!el) { const t = parsePastedTable(text); if (t.columns.length) replaceTable(t); return; }
    const block = parsePastedCells(text), r0 = Number(el.dataset.r), c0 = Number(el.dataset.c), wide = Math.max(d.columns.length, c0 + Math.max(...block.map((b) => b.length))), tall = Math.max(d.rows.length, r0 + block.length);
    const columns = [...d.columns]; while (columns.length < wide) columns.push(uniqueName(`Column ${columns.length + 1}`, columns));
    const rows = Array.from({ length: tall }, (_, r) => Array.from({ length: wide }, (_, c) => { const v = block[r - r0]?.[c - c0]; return r >= r0 && c >= c0 && v !== undefined ? v : d.rows[r]?.[c] ?? null; }));
    apply({ ...d, columns, rows, ...(d.y.length ? {} : defaultChartConfig(columns, rows)) }); if (tall > ROWS_SHOWN) setAll(true);
  };

  const title = canEdit
    ? <input data-nv-stop="" className="ch-title" value={data.title} placeholder="Untitled chart" aria-label="Chart title" maxLength={200} onChange={(e) => typing({ ...cur.current, title: e.target.value })} onBlur={() => push.flush()} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
    : data.title;
  const shown = all ? data.rows : data.rows.slice(0, ROWS_SHOWN);
  return (
    <NodeFrame kind="chart" icon={<ChartColumn />} label="Chart" title={title} selected={selected} className="ch"
      actions={canEdit && hasData ? <NodeButton label="Edit data" active={editing} onClick={() => setEditing((v) => !v)}><Table2 /></NodeButton> : undefined}>
      {canEdit && hasData && (
        <div className="nb-toolbar" role="group" aria-label="Chart type">
          {KINDS.map((k) => <NodeButton key={k.kind} label={k.label} active={kind === k.kind} onClick={() => { if (kind !== k.kind) update({ kind: k.kind }); }}>{k.icon}</NodeButton>)}
        </div>
      )}
      {snapshot && <div className="ch-note" data-testid="chart-source"><Database aria-hidden /> <span className="min-w-0 truncate">{live.result?.name ? `Database · ${live.result.name}` : "Database"}</span>
        {live.unavailable ? <span>· live data is not available on this server yet — stored snapshot</span> : live.result ? <LiveBadge live={live} /> : live.loading ? <span>· reading…</span> : <span className="live-badge" data-state={live.reason === "offline" ? "offline" : "stale"} data-testid="live-indicator"><span className="live-dot" aria-hidden /><span className="live-text">{live.reason === "offline" ? "Offline · stored snapshot" : `Not refreshed · stored snapshot${live.error ? ` (${live.error.message})` : ""}`}</span></span>}
        <span className="ml-auto inline-flex gap-1"><NodeButton label="Refresh" onClick={() => { explicitRefresh.current = true; live.refresh(); }} disabled={live.fetching}><RefreshCw /></NodeButton>{canEdit && <NodeButton label="Unlink from the database (keeps the data)" onClick={() => update({ source: null })}><Unlink /></NodeButton>}</span></div>}
      {hasData ? <ChartFigure kind={kind} data={drawn} /> : (
        <NodeState icon={<ChartColumn />} title="Empty chart" hint={canEdit && !snapshot ? "Add a small table to plot: type it, or paste it from a spreadsheet." : "This chart has no data."}>
          {canEdit && !snapshot && <><NodeButton label="Start with sample data" text onClick={() => { apply(SAMPLE); setEditing(true); }}><Table2 /></NodeButton><NodeButton label="Paste a table" text onClick={() => setPasting(true)}><ClipboardPaste /></NodeButton><NodeButton label="Plot a database" text active={linking} onClick={() => setLinking((v) => !v)}><Database /></NodeButton></>}
        </NodeState>
      )}
      {canEdit && linking && !snapshot && <div className="ch-paste"><label className="flex items-center gap-2 text-ui text-fg-muted">Database<select className="nb-field min-w-0 flex-1" aria-label="Database to plot" defaultValue="" onChange={(e) => link(e.target.value)}><option value="">{dbs.isLoading ? "Loading…" : (dbs.data ?? []).length ? "Choose…" : "No database yet"}</option>{(dbs.data ?? []).map((d) => <option key={d.id} value={d.databaseId ?? d.id}>{d.title || "Untitled"}</option>)}</select></label><div className="nb-meta mt-1">The chart follows the database: its rows are read each time the page is shown, and the last version is kept in the page for offline reading.</div></div>}
      {canEdit && pasting && !snapshot && <PastePanel onCancel={() => setPasting(false)} onUse={replaceTable} replaces={hasData} />}
      {canEdit && editing && hasData && (
        <div className="ch-edit">
          <div className="nb-toolbar">
            <label className="ch-map"><span className="nb-meta">X</span>
              <select className="nb-field" aria-label="X column" value={data.x != null && data.columns.includes(data.x) ? data.x : ""} onChange={(e) => setX(e.target.value === "" ? null : e.target.value)}>
                <option value="">Row number</option>{data.columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <div className="ch-map" role="group" aria-label="Y columns"><span className="nb-meta">Y</span>
              {data.columns.filter((c) => c !== data.x).map((c) => <button key={c} type="button" className="ch-chip" aria-pressed={data.y.includes(c)} title={data.y.includes(c) ? `Hide ${c}` : `Plot ${c}`} onClick={() => toggleY(c)}>{data.y.includes(c) && <span className="ch-swatch" style={{ background: color(data.y.indexOf(c) % 8) }} />}{clip(c, 24)}</button>)}
            </div>
            {!snapshot && <span className="nb-actions"><NodeButton label="Paste a table" text onClick={() => setPasting((v) => !v)}><ClipboardPaste /></NodeButton></span>}
          </div>
          {!snapshot && (
            <>
              <div className="nb-scroll">
                <table className="ch-grid" data-testid="chart-grid" onPaste={onGridPaste}>
                  <thead><tr>
                    <th className="ch-num" scope="col"><span className="sr-only">Row</span></th>
                    {data.columns.map((c, i) => <th key={i} scope="col"><div className="ch-th"><NameInput name={c} index={i} onRename={rename} /><NodeButton label={`Remove column ${c}`} tone="danger" onClick={() => removeColumn(i)}><X /></NodeButton></div></th>)}
                    <th scope="col"><NodeButton label="Add column" onClick={addColumn}><Plus /></NodeButton></th>
                  </tr></thead>
                  <tbody>{shown.map((row, r) => (
                    <tr key={r}>
                      <th className="ch-num" scope="row">{r + 1}</th>
                      {data.columns.map((c, i) => <td key={i}><Cell value={row[i] ?? null} r={r} c={i} label={`${c}, row ${r + 1}`} onChange={setCell} /></td>)}
                      <td><NodeButton label={`Remove row ${r + 1}`} tone="danger" onClick={() => removeRow(r)}><X /></NodeButton></td>
                    </tr>))}</tbody>
                </table>
              </div>
              <div className="nb-toolbar ch-gridfoot">
                <NodeButton label="Add row" text onClick={addRow}><Plus /></NodeButton>
                {data.rows.length > shown.length && <NodeButton label={`Show all ${data.rows.length} rows`} text onClick={() => setAll(true)} />}
                <span className="nb-meta ml-auto">{data.rows.length} row{data.rows.length === 1 ? "" : "s"} × {data.columns.length} column{data.columns.length === 1 ? "" : "s"}</span>
              </div>
            </>
          )}
        </div>
      )}
    </NodeFrame>
  );
}

/** Grid cell: keeps what was typed (so "1." or "1,5" are not rewritten under the caret) and reports the coerced value. */
const Cell = React.memo(function Cell({ value, r, c, label, onChange }: { value: ChartCell; r: number; c: number; label: string; onChange: (r: number, c: number, v: ChartCell) => void }) {
  const [text, setText] = React.useState(() => show(value)); const ref = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => { if (ref.current !== document.activeElement) setText(show(value)); }, [value]);
  return <input ref={ref} className={`nb-field ch-cell${typeof value === "number" ? " ch-cell-num" : ""}`} value={text} aria-label={label} data-r={r} data-c={c} autoComplete="off" spellCheck={false} onChange={(e) => { setText(e.target.value); onChange(r, c, coerceCell(e.target.value)); }} />;
});
const NameInput = React.memo(function NameInput({ name, index, onRename }: { name: string; index: number; onRename: (c: number, text: string) => void }) {
  const [text, setText] = React.useState(name); const ref = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => { if (ref.current !== document.activeElement) setText(name); }, [name]);
  return <input ref={ref} className="nb-field ch-cell ch-name" value={text} aria-label={`Name of column ${index + 1}`} autoComplete="off" spellCheck={false} maxLength={80} onChange={(e) => { setText(e.target.value); onRename(index, e.target.value); }} onBlur={() => setText(name)} />;
});

function PastePanel({ onUse, onCancel, replaces }: { onUse: (t: { columns: string[]; rows: ChartCell[][] }) => void; onCancel: () => void; replaces: boolean }) {
  const [text, setText] = React.useState("");
  const use = () => { const t = parsePastedTable(text); if (!t.columns.length) return toast("Nothing to import", { description: "Paste rows copied from a spreadsheet, or CSV text.", tone: "danger" }); onUse(t); };
  return (
    <div className="ch-paste">
      <textarea className="nb-code" autoFocus rows={5} value={text} aria-label="Table to paste" placeholder={"Paste cells copied from a spreadsheet, or CSV:\nMonth\tValue\nJan\t12"} spellCheck={false} onChange={(e) => setText(e.target.value)} />
      <div className="ch-paste-foot"><span className="nb-meta min-w-0 flex-1">{replaces ? "Replaces the current table. " : ""}The first line is used as column names when it has no numbers.</span>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button><Button size="sm" onClick={use} disabled={text.trim() === ""}>Use this table</Button></div>
    </div>
  );
}

/** The figure: measures its own width (ResizeObserver, never per frame), builds the model, draws the SVG and the legend. */
const ChartFigure = React.memo(function ChartFigure({ kind, data }: { kind: ChartKind; data: Data }) {
  const box = React.useRef<HTMLDivElement | null>(null); const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const set = (w: number) => { const r = Math.round(w); if (r > 0) setWidth((p) => (p === r ? p : r)); };
    set(el.clientWidth); const ro = new ResizeObserver((entries) => set(entries[0].contentRect.width)); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const height = width ? Math.round(Math.max(180, Math.min(kind === "pie" ? 260 : 340, width * (kind === "pie" ? 0.6 : 0.5)))) : 180;
  const model = React.useMemo(() => (width ? chartModel({ kind, title: data.title, columns: data.columns, rows: data.rows, x: data.x, y: data.y }, { width, height }) : null), [kind, data.title, data.columns, data.rows, data.x, data.y, width, height]);
  return (
    <div ref={box} className="ch-figure" style={model ? undefined : { minHeight: height }}>
      {model && (model.problems.length ? <NodeState icon={<ChartColumn />} title="Nothing to plot yet" hint={model.problems[0]} /> : <>
        <ChartSvg m={model} />
        <ul className="ch-legend" aria-label="Legend">{model.series.map((s, i) => <li key={i}><span className="ch-swatch" style={{ background: color(s.color) }} aria-hidden /><span>{s.name}</span></li>)}</ul>
      </>)}
      {model && model.notes.length > 0 && <ul className="ch-notes">{model.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    </div>
  );
});

function ChartSvg({ m }: { m: ChartModel }) {
  const { plot } = m, name = (i: number) => m.series[i]?.name ?? "", hue = (i: number) => color(m.series[i]?.color ?? i), tip = (label: string, series: number, value: number) => `${label} · ${name(series)}: ${formatNumber(value)}`;
  const slot = m.xTicks.length ? plot.width / m.xTicks.length : plot.width, chars = Math.max(3, Math.floor(slot / 6.5)), dots = m.lines.reduce((a, l) => a + l.points.length, 0) <= 240;
  return (
    <svg data-testid="chart-svg" className="ch-svg" role="img" aria-label={m.summary} viewBox={`0 0 ${m.width} ${m.height}`} width={m.width} height={m.height} preserveAspectRatio="xMidYMid meet">
      {m.kind !== "pie" && <g aria-hidden>
        {m.yTicks.map((t, i) => <g key={i}><line className="ch-gridline" x1={plot.x} x2={plot.x + plot.width} y1={t.px} y2={t.px} /><text className="ch-tick" x={plot.x - 6} y={t.px} dy="0.32em" textAnchor="end">{t.label}</text></g>)}
        {m.xTicks.map((t, i) => { const linear = typeof t.value === "number", anchor = linear && i === 0 ? "start" : linear && i === m.xTicks.length - 1 ? "end" : "middle"; return <text key={i} className="ch-tick" x={t.px} y={plot.y + plot.height + 16} textAnchor={anchor}>{clip(t.label, chars)}</text>; })}
        {m.baseline != null && <line className="ch-axis" x1={plot.x} x2={plot.x + plot.width} y1={m.baseline} y2={m.baseline} />}
      </g>}
      {m.rects.map((r, i) => <rect key={i} className="ch-mark" x={r.x} y={r.height < 1 ? r.y - (1 - r.height) / 2 : r.y} width={r.width} height={Math.max(1, r.height)} rx={Math.min(2, r.width / 2)} fill={hue(r.series)}><title>{tip(r.label, r.series, r.value)}</title></rect>)}
      {m.lines.map((l, i) => <g key={i}>
        {l.area && <path d={l.area} fill={hue(l.series)} fillOpacity={0.16} />}
        <path d={l.path} fill="none" stroke={hue(l.series)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {dots && l.points.map((p, j) => p && <circle key={j} className="ch-dot" cx={p.x} cy={p.y} r={3.5} fill={hue(l.series)}><title>{tip(p.label, p.series, p.value)}</title></circle>)}
      </g>)}
      {m.points.map((p, i) => <circle key={i} className="ch-dot" cx={p.x} cy={p.y} r={4.5} fill={hue(p.series)} fillOpacity={0.85}><title>{tip(p.label, p.series, p.value)}</title></circle>)}
      {m.arcs.map((a) => <path key={a.index} className="ch-slice" d={a.path} fill={color(a.color)}><title>{`${a.label}: ${formatNumber(a.value)} (${a.percent})`}</title></path>)}
    </svg>
  );
}
