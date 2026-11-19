"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, CircleCheck, TriangleAlert } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Skeleton, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { timeAgo } from "@/lib/utils";

/** Search index: state, pending/failed items and the two re-index commands (same data as Search → Index). */
export function IndexSection() {
  const { data: s, refetch, error } = useQuery({ queryKey: ["index-stats"], queryFn: () => api<any>("/api/search/index-state"), refetchInterval: 8000 });
  async function run(scope: "all" | "pending") { try { const r = await api<{ queued: number }>("/api/search/index-state", { method: "POST", json: { scope } }); toast(scope === "all" ? "Full re-index queued" : `${r.queued} item${r.queued === 1 ? "" : "s"} queued`); setTimeout(() => refetch(), 2500); } catch (e: any) { toast("Could not queue", { description: e.message, tone: "danger" }); } }
  if (error) return <p className="text-[13px] text-danger-text">Could not read the index state. <button className="underline" onClick={() => refetch()}>Retry</button></p>;
  if (!s) return <Skeleton className="h-40 rounded-2xl" />;
  const pending = s.health.pending.length + s.health.pendingFiles; const failed = s.health.failed.length;
  return (
    <div className="space-y-4">
      <div><h2 className="text-[15px] font-semibold">Search index</h2><p className="text-[13px] leading-5 text-fg-muted">Pages and files with text are cut into passages and indexed by the background worker after each edit. Meaning-based search sends each changed passage to the embedding provider ({s.model}).</p></div>
      <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-bg-elev p-3.5 text-[13.5px] leading-5">{failed ? <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" /> : pending ? <Spinner className="mt-0.5" /> : <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" />}<div className="min-w-0 flex-1">{failed ? `${failed} item(s) failed to index.` : pending ? `${pending} item(s) waiting · ${s.health.queued} job(s) in the queue.` : "Everything is indexed."} {s.last_indexed ? `Last indexing ${timeAgo(s.last_indexed)}.` : ""}{!s.health.embeddingsConfigured && <div className="mt-1 text-fg-muted">No embedding provider key on the server: meaning-based search is not configured, exact-word search still works.</div>}{pending > 0 && s.health.queued === 0 && <div className="mt-1 text-fg-muted">Nothing is queued — if this stays, the worker may be stopped (docs/operations.md → Worker).</div>}</div></div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Pages", s.pages], ["Passages", s.chunks], ["With vectors", s.embedded], ["Old model", s.stale]].map(([l, v]) => <div key={l as string} className="rounded-xl border border-line bg-bg-elev px-3 py-2.5"><dt className="text-[11px] uppercase tracking-wider text-fg-faint">{l}</dt><dd className="text-lg font-semibold tabular-nums">{String(v)}</dd></div>)}</dl>
      <div className="grid gap-2 sm:grid-cols-2"><Button className="h-11" disabled={!pending && !failed} onClick={() => run("pending")}><RefreshCw /> Index pending</Button><Button variant="outline" className="h-11" onClick={() => run("all")}><RefreshCw /> Rebuild everything</Button></div>
      <Link href="/search" className="inline-block text-[13px] font-medium text-accent">Details in Search → Index</Link>
    </div>
  );
}
