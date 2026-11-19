"use client";
/**
 * File: src/components/database/window.ts
 * Description: Databases Next Generation — windowed loading of a view. Rows are fetched in pages of 100 by offset (`POST …/query`),
 *   only for the ranges a view asks for (`ensure`), so a 20 000-row database never loads more than what is on screen. The first page
 *   also carries the whole-database counts: total, groups (count / offset / aggregates) and column aggregates. Every page lives in the
 *   react-query cache under ["db-rows", dbId, …], so optimistic edits and invalidations reach all of them.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient, keepPreviousData, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { QueryResult, RowOut, FilterGroup, GroupOut, NumAgg } from "@/lib/databases/types";
import { isPending } from "@/lib/databases/types";

export const PAGE = 100;
export interface WinOpts { groupBy?: string | null; extraFilter?: FilterGroup | null; enabled?: boolean; /** pages kept mounted at most (table: small; list / gallery / cards: every page loaded so far) */ keep?: number }
export interface Win {
  total: number; groups: GroupOut[] | undefined; aggregates: Record<string, NumAgg> | undefined; engine: "sql" | "js" | undefined; fallback: string[] | undefined;
  /** Row at index `i` of the view's order, or undefined while its page is not loaded. */
  rowAt: (i: number) => RowOut | undefined;
  /** Declare the index ranges [from, to) that are on screen (replaces the previous declaration). */
  ensure: (ranges: [number, number][]) => void;
  /** Every loaded row, in order (gaps skipped). */
  loaded: RowOut[];
  /** Ids of the rows in [from, to), fetching the pages that are not loaded (shift-range selection). */
  idsInRange: (from: number, to: number) => Promise<string[]>;
  loading: boolean; fetching: boolean; error: Error | null; refetch: () => void;
}
const body = (viewId: string, search: string, o: WinOpts, page: number) => ({ viewId, search: search || undefined, limit: PAGE, offset: page * PAGE, ...(o.groupBy ? { groupBy: o.groupBy, ...(page > 0 ? { skipGroups: true } : {}) } : page === 0 ? { aggregates: true } : {}), ...(o.extraFilter ? { extraFilter: o.extraFilter } : {}) });
const keyOf = (dbId: string | undefined, viewId: string | undefined, search: string, o: WinOpts, page: number) => ["db-rows", dbId, viewId, search, { g: o.groupBy ?? null, x: o.extraFilter ?? null }, page] as const;

export function useWindow(dbId: string | undefined, viewId: string | undefined, search: string, opts: WinOpts = {}): Win {
  const qc = useQueryClient(); const keep = opts.keep ?? 12; const sig = `${dbId}|${viewId}|${search}|${opts.groupBy ?? ""}|${JSON.stringify(opts.extraFilter ?? null)}`;
  const [want, setWant] = useState<{ sig: string; pages: number[] }>({ sig, pages: [0] });
  const pages = want.sig === sig ? want.pages : [0]; // a new view / search starts again from the first page
  const enabled = !!dbId && !!viewId && opts.enabled !== false; const o = useRef(opts); o.current = opts;
  const results = useQueries({ queries: pages.map((page) => ({
    queryKey: keyOf(dbId, viewId, search, opts, page), enabled, placeholderData: keepPreviousData, staleTime: 10_000,
    queryFn: () => api<QueryResult>(`/api/databases/${dbId}/query`, { method: "POST", idempotencyKey: false, json: body(viewId!, search, o.current, page) }),
    refetchInterval: (q: { state: { data?: QueryResult } }) => (q.state.data?.rows.some((r) => Object.values(r.values).some(isPending)) ? 2500 : false),
  })) });
  const head = results[pages.indexOf(0)]?.data ?? results.find((r) => r.data)?.data;
  const byPage = new Map<number, RowOut[]>(); pages.forEach((p, i) => { const d = results[i]?.data; if (d && d.offset === p * PAGE) byPage.set(p, d.rows); });
  const stamp = results.map((r) => r.dataUpdatedAt).join(",") + "|" + pages.join(",");
  const rowAt = useCallback((i: number) => byPage.get(Math.floor(i / PAGE))?.[i % PAGE], [stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = useMemo(() => [...byPage.keys()].sort((a, b) => a - b).flatMap((p) => byPage.get(p)!), [stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  // A fast scroll (dragging the scrollbar across 20 000 rows) crosses a window per frame: the wanted set is applied at most every
  // 120 ms (leading + trailing), so only the windows where the scroll slows down or stops are fetched.
  const gate = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null; next: (() => void) | null }>({ at: 0, timer: null, next: null });
  useEffect(() => () => { if (gate.current.timer) clearTimeout(gate.current.timer); }, []);
  const ensure = useCallback((ranges: [number, number][]) => {
    const g = gate.current; const run = () => { g.at = Date.now(); g.next = null; apply(ranges); }; const wait = 120 - (Date.now() - g.at);
    if (wait <= 0 && !g.timer) return run();
    g.next = run; if (!g.timer) g.timer = setTimeout(() => { g.timer = null; g.next?.(); }, Math.max(0, wait));
  }, [sig, keep]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = useCallback((ranges: [number, number][]) => {
    const need = new Set<number>([0]); for (const [a, b] of ranges) for (let p = Math.max(0, Math.floor(a / PAGE)); p <= Math.floor(Math.max(a, b - 1) / PAGE) && need.size < keep; p++) need.add(p);
    const next = [...need].sort((x, y) => x - y);
    setWant((cur) => (cur.sig === sig && cur.pages.length === next.length && cur.pages.every((x, i) => x === next[i]) ? cur : { sig, pages: next }));
  }, [sig, keep]);
  const idsInRange = useCallback(async (from: number, to: number) => {
    const out: string[] = [];
    for (let p = Math.floor(from / PAGE); p <= Math.floor((to - 1) / PAGE); p++) {
      const d = await qc.fetchQuery({ queryKey: keyOf(dbId, viewId, search, o.current, p), staleTime: 10_000, queryFn: () => api<QueryResult>(`/api/databases/${dbId}/query`, { method: "POST", idempotencyKey: false, json: body(viewId!, search, o.current, p) }) });
      d.rows.forEach((r, i) => { const at = p * PAGE + i; if (at >= from && at < to) out.push(r.id); });
    }
    return out;
  }, [qc, dbId, viewId, search]);
  const first = results[pages.indexOf(0)];
  return { total: head?.total ?? 0, groups: head?.groups, aggregates: head?.aggregates, engine: head?.engine, fallback: head?.fallback, rowAt, ensure, loaded, idsInRange,
    loading: enabled && !head && results.some((r) => r.isLoading), fetching: results.some((r) => r.isFetching), error: first?.isError && !first.data ? (first.error as Error) : results.find((r) => r.isError)?.error as Error ?? null, refetch: () => { results.forEach((r) => void r.refetch()); } };
}
/** Any cached copy of a row of this database (whatever the view, the window or the search it was loaded for). */
export function findCachedRow(qc: QueryClient, dbId: string, rowId: string): RowOut | undefined {
  for (const [, d] of qc.getQueriesData<QueryResult>({ queryKey: ["db-rows", dbId] })) { const r = d?.rows?.find((x) => x.id === rowId); if (r) return r; }
  return undefined;
}
