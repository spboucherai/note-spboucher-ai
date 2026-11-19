"use client";
/**
 * file: src/components/editor/nodes/live.tsx
 * description: the "living" side shared by `queryView` and by a `chart` fed by a database: one hook that resolves a `POST /api/query`
 *   body (contract of docs/next/API-NEXT.md §4.7), refreshes when the window regains focus, becomes visible or comes back online, and
 *   falls back to the last answer kept on the device when the server cannot be reached — always flagged as stale; and the small
 *   indicator that says which of the two the reader is looking at ("Live · updated 2 min ago" / "Offline · snapshot from 14:05").
 *   The pulse of the indicator is decoration only and stops under `prefers-reduced-motion` (blocks-ra.css).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { normaliseQueryResult, loadQuerySnapshot, saveQuerySnapshot, refreshedLabel, type QueryResult } from "@/lib/editor/query";
import { api, ApiError } from "@/lib/client/api";
import { useOnline } from "@/lib/client/hooks";

/** A server without the endpoint (older build): the block keeps its configuration and says so. */
const UNAVAILABLE = new Set([404, 405, 501]);
/** Focus / visibility / online events closer than this to the last answer do not refetch. */
const REFRESH_MIN_MS = 5_000;
const storage = (): Storage | null => { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } };

export interface LiveQuery {
  /** What to show: the live answer, or the last one known (previous answer of this session, else the copy kept on the device). */
  result: QueryResult | null;
  /** `result` is not the server's current answer. */
  stale: boolean; reason: "offline" | "error" | null;
  /** The endpoint does not exist on this server (404 with no body code / 405 / 501). */
  unavailable: boolean;
  loading: boolean; fetching: boolean; error: Error | null; refresh: () => void;
}
export function useLiveQuery(body: Record<string, unknown> | null, source: string): LiveQuery {
  const online = useOnline();
  const q = useQuery({ queryKey: ["query-view", body], enabled: body != null, staleTime: 30_000, retry: false, refetchOnWindowFocus: false,
    queryFn: async () => {
      let raw: unknown;
      try { raw = await api("/api/query", { method: "POST", json: body, idempotencyKey: false }); }
      catch (e) { if (e instanceof ApiError && UNAVAILABLE.has(e.status) && !(e.status === 404 && e.code)) return { ok: false as const }; throw e; }
      const data = normaliseQueryResult(raw, source); saveQuerySnapshot(storage(), body, raw); return { ok: true as const, data };
    } });
  const { refetch, dataUpdatedAt, errorUpdatedAt, isError } = q; const last = Math.max(dataUpdatedAt, errorUpdatedAt);
  const lastRef = React.useRef(last); lastRef.current = last; const errRef = React.useRef(isError); errRef.current = isError;
  const refresh = React.useCallback(() => { void refetch({ cancelRefetch: false }); }, [refetch]);
  React.useEffect(() => {
    if (body == null) return;
    const wake = (e: Event) => { if (document.visibilityState !== "visible") return; if (e.type !== "online" && !errRef.current && Date.now() - lastRef.current < REFRESH_MIN_MS) return; refresh(); };
    window.addEventListener("focus", wake); window.addEventListener("online", wake); document.addEventListener("visibilitychange", wake);
    return () => { window.removeEventListener("focus", wake); window.removeEventListener("online", wake); document.removeEventListener("visibilitychange", wake); };
  }, [body == null, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  // the copy kept on the device is read only when the server failed and this session has no earlier answer
  const kept = React.useMemo(() => (q.isError && !q.data?.ok && body != null ? loadQuerySnapshot(storage(), body, source) : null), [q.isError, q.data, body, source]);
  const result = q.data?.ok ? q.data.data : kept;
  const offline = !online || (q.error instanceof ApiError && q.error.status === 0);
  return { result, stale: q.isError && result != null, reason: q.isError ? (offline ? "offline" : "error") : null, unavailable: q.data?.ok === false, loading: q.isLoading, fetching: q.isFetching, error: q.isError ? (q.error as Error) : null, refresh };
}

/** Re-renders its caller every `ms` while mounted and the page is visible (relative times). */
function useTick(ms: number) {
  const [, set] = React.useState(0);
  React.useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") set((n) => n + 1); }, ms); return () => clearInterval(t); }, [ms]);
}
/** "Live · updated 2 min ago" (pulsing dot) or the stale state ("Offline · snapshot from 14:05"). Plain text: not a live region (it would be re-announced every minute). */
export function LiveBadge({ live, className }: { live: Pick<LiveQuery, "result" | "stale" | "reason" | "fetching">; className?: string }) {
  useTick(30_000);
  const at = live.result?.resolvedAt ?? null; if (!at && !live.fetching) return null;
  const state = live.stale ? (live.reason === "offline" ? "offline" : "stale") : live.fetching ? "updating" : "live";
  const when = refreshedLabel(at);
  const text = state === "offline" ? `Offline · snapshot from ${when}` : state === "stale" ? `Not refreshed · snapshot from ${when}` : state === "updating" ? (when ? `Updating… · ${when}` : "Updating…") : `Live · updated ${when}`;
  const title = at ? `${state === "live" || state === "updating" ? "Read from the server" : "Last answer received from the server"}: ${new Date(at).toLocaleString()}` : undefined;
  return <span className={`live-badge${className ? ` ${className}` : ""}`} data-state={state} data-testid="live-indicator" title={title}><span className="live-dot" aria-hidden /><span className="live-text">{text}</span></span>;
}
