/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/editor/nodes/QueryView.tsx
 * Module           : components
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

"use client";
/**
 * file: src/components/editor/nodes/QueryView.tsx
 * description: `queryView` block — a "living" list / table / board resolved at display time through `POST /api/query` (SPEC §4.7).
 *   Config UI for the source, filters, layout and limit. The answer is read with the final contract (src/lib/editor/query.ts); the block
 *   refreshes on focus / visibility / reconnection and shows when its data was read (`LiveBadge`). When the server cannot be reached it
 *   shows the last answer kept on the device, flagged as a snapshot. A server without the endpoint (405/501) gets a neutral state.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ListFilter, RefreshCw, Settings2, ServerOff, WifiOff, List as ListIcon, Table2, Columns3, CircleCheck, Circle } from "lucide-react";
import type { QueryViewAttrs, QuerySource, QueryFilter } from "@/lib/editor/next-node-defs";
import { queryBody, groupByStatus, shortDate, isOverdue, tableColumns, type QueryRow } from "@/lib/editor/query";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { NodeFrame, NodeButton, NodeState, useDebounced, type LeafViewProps } from "./frame";
import { useLiveQuery, LiveBadge } from "./live";

const SOURCES: { id: QuerySource; label: string }[] = [{ id: "tasks", label: "Tasks" }, { id: "pages", label: "Pages" }, { id: "database", label: "Database" }, { id: "references", label: "References" }, { id: "backlinks", label: "Backlinks" }];
// only the filters the server applies to each source (API-NEXT §4.7)
const FILTERS: Record<QuerySource, (keyof QueryFilter)[]> = { tasks: ["status", "tag", "section", "parentId", "text", "dueBefore", "dueAfter"], pages: ["status", "section", "tag", "parentId", "text"], database: ["text"], references: ["status", "parentId", "text"], backlinks: ["section", "text"] };
const FILTER_LABEL: Record<keyof QueryFilter, string> = { tag: "Tag", section: "Section", status: "Status", parentId: "Parent page id", text: "Contains", dueBefore: "Due before", dueAfter: "Due after" };

function Row({ r }: { r: QueryRow }) {
  const body = <><span className="qv-check" aria-hidden>{r.status != null || r.done ? (r.done ? <CircleCheck className="text-success" /> : <Circle />) : <span className="qv-emoji">{r.icon ?? "•"}</span>}</span><span className="min-w-0 flex-1"><span className={cn("qv-title", r.done && "line-through text-fg-faint")}>{r.title}</span>{r.subtitle && <span className="qv-sub">{r.subtitle}</span>}</span>{r.due && <span className={cn("qv-due", isOverdue(r.due, r.done) && "is-late")}>{shortDate(r.due)}</span>}{r.status && <span className="qv-status">{r.status}</span>}</>;
  return r.href ? <Link href={r.href} className="qv-row">{body}</Link> : <div className="qv-row">{body}</div>;
}

export function QueryView({ attrs, update, editable, selected, pageId }: LeafViewProps<QueryViewAttrs>) {
  const [config, setConfig] = React.useState(false);
  const body = React.useMemo(() => { const b = queryBody(attrs); if (attrs.source === "backlinks" && pageId && !(b.filter as Record<string, unknown>).parentId) b.pageId = pageId; return b; }, [attrs, pageId]);
  const needsDb = attrs.source === "database" && !attrs.databaseId;
  const q = useLiveQuery(needsDb ? null : body, attrs.source);
  const dbs = useQuery({ queryKey: ["tree-databases"], enabled: config && attrs.source === "database", staleTime: 60_000, queryFn: async () => (await api<{ id: string; title: string; type: string; databaseId?: string | null }[]>("/api/tree")).filter((n) => n.type === "database") });
  const setFilter = useDebounced((k: keyof QueryFilter, v: string) => { const f = { ...(attrs.filter ?? {}) } as Record<string, unknown>; if (v.trim()) f[k] = v.trim(); else delete f[k]; update({ filter: f as QueryFilter }); }, 450);
  const setTitle = useDebounced((v: string) => update({ title: v }), 450);
  const result = q.result; const rows = result?.rows ?? []; const cols = result ? tableColumns(result) : [];
  const label = SOURCES.find((s) => s.id === attrs.source)?.label ?? attrs.source;
  return (
    <NodeFrame kind="queryView" icon={<ListFilter />} label="Live view" selected={selected} title={attrs.title || label}
      actions={<><LiveBadge live={q} className="mr-1" />{result && <span className="nb-meta mr-1" data-testid="query-count">{`${rows.length}${result.total > rows.length ? ` of ${result.total}` : ""}`}</span>}<NodeButton label="Refresh" onClick={q.refresh} disabled={needsDb || q.fetching}><RefreshCw /></NodeButton>{editable && <NodeButton label="Configure view" active={config} onClick={() => setConfig((c) => !c)}><Settings2 /></NodeButton>}</>}>
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
      {q.stale && <div className="live-stale" role="status" data-testid="live-stale"><WifiOff aria-hidden /><span>{q.reason === "offline" ? "You are offline — this is the last version received from the server." : `The server could not refresh this view (${q.error?.message ?? "error"}) — showing the last version received.`}</span><NodeButton label="Retry" text onClick={q.refresh} /></div>}
      {needsDb ? <NodeState icon={<Settings2 />} title="Choose a database" hint="Open the configuration to pick the database this view reads." />
        : q.loading ? <div className="p-3"><div className="skeleton mb-2 h-5 w-2/3" /><div className="skeleton mb-2 h-5 w-1/2" /><div className="skeleton h-5 w-3/5" /></div>
        : q.unavailable ? <NodeState icon={<ServerOff />} title="Live views are not available on this server yet" hint="The view and its filters are kept; it will fill in once the server is updated." />
        : !result ? <NodeState tone="danger" icon={q.reason === "offline" ? <WifiOff /> : <ServerOff />} title={q.reason === "offline" ? "You are offline and this view has no saved copy yet" : "This view could not be loaded"} hint={q.error?.message}><NodeButton label="Retry" text onClick={q.refresh} /></NodeState>
        : rows.length === 0 ? <NodeState icon={<ListFilter />} title="Nothing matches" hint="No item corresponds to this view's filters right now." />
        : attrs.layout === "table" ? <div className="nb-scroll"><table className="qv-table" data-testid="query-rows"><thead><tr><th>Title</th>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.map((r) => <tr key={r.key}><td>{r.href ? <Link href={r.href} className="qv-link">{r.title}</Link> : r.title}</td>{cols.map((c) => <td key={c.key} className={c.type === "number" ? "qv-num" : undefined}>{c.type === "date" ? shortDate(r.cells[c.key] || null) : r.cells[c.key] ?? ""}</td>)}</tr>)}</tbody></table></div>
        : attrs.layout === "board" ? <div className="qv-board nb-scroll" data-testid="query-rows">{groupByStatus(rows).map((g) => <section key={g.status} className="qv-col" aria-label={g.status}><h4>{g.status}<span>{g.rows.length}</span></h4>{g.rows.map((r) => <Row key={r.key} r={{ ...r, status: null }} />)}</section>)}</div>
        : <div className="qv-list" data-testid="query-rows">{rows.map((r) => <Row key={r.key} r={r} />)}</div>}
    </NodeFrame>
  );
}
