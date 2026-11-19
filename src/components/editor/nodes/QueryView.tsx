"use client";
/**
 * file: src/components/editor/nodes/QueryView.tsx
 * description: `queryView` block — a "living" list / table / board resolved at display time through `POST /api/query` (SPEC §4.7).
 *   Config UI for the source, filters, layout and limit. The endpoint belongs to the backend workstream: when the server answers
 *   404/405/501 the block shows a neutral "not available on this server yet" state and keeps its configuration untouched.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ListFilter, RefreshCw, Settings2, ServerOff, List as ListIcon, Table2, Columns3, CircleCheck, Circle } from "lucide-react";
import type { QueryViewAttrs, QuerySource, QueryFilter } from "@/lib/editor/next-node-defs";
import { queryBody, normaliseQueryResult, groupByStatus, shortDate, isOverdue, type QueryRow } from "@/lib/editor/query";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { NodeFrame, NodeButton, NodeState, useDebounced, type LeafViewProps } from "./frame";

const SOURCES: { id: QuerySource; label: string }[] = [{ id: "tasks", label: "Tasks" }, { id: "pages", label: "Pages" }, { id: "database", label: "Database" }, { id: "references", label: "References" }, { id: "backlinks", label: "Backlinks" }];
const FILTERS: Record<QuerySource, (keyof QueryFilter)[]> = { tasks: ["status", "tag", "text", "dueBefore", "dueAfter"], pages: ["section", "tag", "parentId", "text"], database: ["status", "text"], references: ["tag", "text"], backlinks: ["text"] };
const FILTER_LABEL: Record<keyof QueryFilter, string> = { tag: "Tag", section: "Section", status: "Status", parentId: "Parent page id", text: "Contains", dueBefore: "Due before", dueAfter: "Due after" };
const UNAVAILABLE = new Set([404, 405, 501]);

function Row({ r }: { r: QueryRow }) {
  const body = <><span className="qv-check" aria-hidden>{r.status != null || r.done ? (r.done ? <CircleCheck className="text-success" /> : <Circle />) : <span className="qv-emoji">{r.icon ?? "•"}</span>}</span><span className="min-w-0 flex-1"><span className={cn("qv-title", r.done && "line-through text-fg-faint")}>{r.title}</span>{r.subtitle && <span className="qv-sub">{r.subtitle}</span>}</span>{r.due && <span className={cn("qv-due", isOverdue(r.due, r.done) && "is-late")}>{shortDate(r.due)}</span>}{r.status && <span className="qv-status">{r.status}</span>}</>;
  return r.href ? <Link href={r.href} className="qv-row">{body}</Link> : <div className="qv-row">{body}</div>;
}

export function QueryView({ attrs, update, editable, selected, pageId }: LeafViewProps<QueryViewAttrs>) {
  const [config, setConfig] = React.useState(false);
  const body = React.useMemo(() => { const b = queryBody(attrs); if (attrs.source === "backlinks" && pageId && !(b.filter as Record<string, unknown>).parentId) b.pageId = pageId; return b; }, [attrs, pageId]);
  const needsDb = attrs.source === "database" && !attrs.databaseId;
  const q = useQuery({ queryKey: ["query-view", body], enabled: !needsDb, staleTime: 30_000, retry: false, refetchOnWindowFocus: true,
    queryFn: async () => { try { return { ok: true as const, data: normaliseQueryResult(await api("/api/query", { method: "POST", json: body, idempotencyKey: false }), attrs.source) }; } catch (e) { if (e instanceof ApiError && UNAVAILABLE.has(e.status)) return { ok: false as const }; throw e; } } });
  const dbs = useQuery({ queryKey: ["tree-databases"], enabled: config && attrs.source === "database", staleTime: 60_000, queryFn: async () => (await api<{ id: string; title: string; type: string; databaseId?: string | null }[]>("/api/tree")).filter((n) => n.type === "database") });
  const setFilter = useDebounced((k: keyof QueryFilter, v: string) => { const f = { ...(attrs.filter ?? {}) } as Record<string, unknown>; if (v.trim()) f[k] = v.trim(); else delete f[k]; update({ filter: f as QueryFilter }); }, 450);
  const setTitle = useDebounced((v: string) => update({ title: v }), 450);
  const result = q.data?.ok ? q.data.data : null; const rows = result?.rows ?? [];
  const label = SOURCES.find((s) => s.id === attrs.source)?.label ?? attrs.source;
  return (
    <NodeFrame kind="queryView" icon={<ListFilter />} label="Live view" selected={selected} title={attrs.title || label}
      actions={<><span className="nb-meta mr-1">{q.isFetching ? "Updating…" : result ? `${rows.length}${result.total != null && result.total > rows.length ? ` of ${result.total}` : ""}` : ""}</span><NodeButton label="Refresh" onClick={() => q.refetch()} disabled={needsDb}><RefreshCw /></NodeButton>{editable && <NodeButton label="Configure view" active={config} onClick={() => setConfig((c) => !c)}><Settings2 /></NodeButton>}</>}>
      {config && editable && (
        <div className="qv-config" data-testid="query-config">
          <label className="qv-f"><span>Title</span><input className="nb-field" defaultValue={attrs.title} placeholder={label} onChange={(e) => setTitle(e.target.value)} onBlur={() => setTitle.flush()} /></label>
          <label className="qv-f"><span>Source</span><select className="nb-field" aria-label="Source" value={attrs.source} onChange={(e) => update({ source: e.target.value as QuerySource })}>{SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}{!SOURCES.some((s) => s.id === attrs.source) && <option value={attrs.source}>{attrs.source}</option>}</select></label>
          {attrs.source === "database" && <label className="qv-f"><span>Database</span><select className="nb-field" aria-label="Database" value={attrs.databaseId ?? ""} onChange={(e) => update({ databaseId: e.target.value || null, viewId: null })}><option value="">Choose…</option>{(dbs.data ?? []).map((d) => <option key={d.id} value={d.databaseId ?? d.id}>{d.title || "Untitled"}</option>)}{attrs.databaseId && !(dbs.data ?? []).some((d) => (d.databaseId ?? d.id) === attrs.databaseId) && <option value={attrs.databaseId}>{attrs.databaseId.slice(0, 8)}…</option>}</select></label>}
          <div className="qv-f"><span>Layout</span><div className="flex gap-1" role="group" aria-label="Layout">{([["list", "List", <ListIcon key="l" />], ["table", "Table", <Table2 key="t" />], ["board", "Board", <Columns3 key="b" />]] as const).map(([id, name, ic]) => <NodeButton key={id} label={name} text active={attrs.layout === id} onClick={() => update({ layout: id })}>{ic}</NodeButton>)}</div></div>
          <label className="qv-f"><span>Limit</span><input className="nb-field w-20" type="number" min={1} max={200} defaultValue={attrs.limit} aria-label="Limit" onChange={(e) => { const n = Math.round(Number(e.target.value)); if (n >= 1 && n <= 200) update({ limit: n }); }} /></label>
          {(FILTERS[attrs.source] ?? ["text"]).map((k) => <label key={`${attrs.source}-${k}`} className="qv-f"><span>{FILTER_LABEL[k]}</span><input className="nb-field" type={k === "dueBefore" || k === "dueAfter" ? "date" : "text"} defaultValue={(attrs.filter?.[k] as string | undefined) ?? ""} aria-label={FILTER_LABEL[k]} onChange={(e) => setFilter(k, e.target.value)} onBlur={() => setFilter.flush()} /></label>)}
        </div>
      )}
      {needsDb ? <NodeState icon={<Settings2 />} title="Choose a database" hint="Open the configuration to pick the database this view reads." />
        : q.isLoading ? <div className="p-3"><div className="skeleton mb-2 h-5 w-2/3" /><div className="skeleton mb-2 h-5 w-1/2" /><div className="skeleton h-5 w-3/5" /></div>
        : q.data && !q.data.ok ? <NodeState icon={<ServerOff />} title="Live views are not available on this server yet" hint="The view and its filters are kept; it will fill in once the server is updated." />
        : q.isError ? <NodeState tone="danger" icon={<ServerOff />} title="This view could not be loaded" hint={(q.error as Error)?.message}><NodeButton label="Retry" text onClick={() => q.refetch()} /></NodeState>
        : rows.length === 0 ? <NodeState icon={<ListFilter />} title="Nothing matches" hint="No item corresponds to this view's filters right now." />
        : attrs.layout === "table" ? <div className="nb-scroll"><table className="qv-table" data-testid="query-rows"><thead><tr><th>Title</th>{(result!.columns.length ? result!.columns : ["Status", "Due"]).map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r) => <tr key={r.key}><td>{r.href ? <Link href={r.href} className="qv-link">{r.title}</Link> : r.title}</td>{result!.columns.length ? result!.columns.map((c) => <td key={c}>{r.cells[c] ?? ""}</td>) : <><td>{r.status ?? ""}</td><td>{shortDate(r.due)}</td></>}</tr>)}</tbody></table></div>
        : attrs.layout === "board" ? <div className="qv-board nb-scroll" data-testid="query-rows">{groupByStatus(rows).map((g) => <section key={g.status} className="qv-col" aria-label={g.status}><h4>{g.status}<span>{g.rows.length}</span></h4>{g.rows.map((r) => <Row key={r.key} r={{ ...r, status: null }} />)}</section>)}</div>
        : <div className="qv-list" data-testid="query-rows">{rows.map((r) => <Row key={r.key} r={r} />)}</div>}
    </NodeFrame>
  );
}
