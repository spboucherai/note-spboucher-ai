/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/settings/JobsSection.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
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
import { useQuery } from "@tanstack/react-query";
import { Activity, CircleCheck, RotateCcw, TriangleAlert } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn, timeAgo } from "@/lib/utils";

interface Jobs { worker: { alive: boolean; lastBeatAt: string | null; version: string | null }; queues: { name: string; policy: { retryLimit: number; backoff: boolean; expireInSeconds: number } | null; created: number; retry: number; active: number; completed: number; failed: number }[]; stuck: { id: string; name: string; startedAt: string }[]; active: { id: string; name: string; startedAt: string; attempt: number }[]; failed: { id: string; name: string; at: string; attempts: number; error: string }[]; deadLetter: number }
const LABEL: Record<string, string> = { "index-source": "Indexing", "reindex-all": "Full re-index", "import-file": "Imports", backup: "Backups", "agent-run": "Agents", "suggest-links": "Link suggestions", "ai-property": "AI properties", maintenance: "Housekeeping" };

/** Background work: is the worker alive, what waits, what is stuck, what failed and why — with an explicit Retry. */
export function JobsSection() {
  const { data, error, refetch } = useQuery({ queryKey: ["jobs"], queryFn: () => api<Jobs>("/api/jobs"), refetchInterval: 10_000 });
  async function retry(j: { id: string; name: string }) { try { await api("/api/jobs", { method: "POST", json: { action: "retry", name: j.name, id: j.id } }); toast("Queued again"); refetch(); } catch (e: any) { toast("Could not retry", { description: e.message, tone: "danger" }); } }
  if (error) return <p className="text-[13px] text-danger-text">Could not read the job state. <button className="underline" onClick={() => refetch()}>Retry</button></p>;
  if (!data) return <Skeleton className="h-48 rounded-2xl" />;
  return (
    <div className="space-y-5">
      <div><h2 className="flex items-center gap-2 text-[15px] font-semibold"><Activity className="size-4 text-fg-muted" />Background jobs</h2><p className="text-[13px] leading-5 text-fg-muted">Indexing, imports, backups and agents run in a separate worker process. Safe jobs retry by themselves with a growing delay; paid or long ones wait for you.</p></div>
      <div className={cn("flex items-start gap-2.5 rounded-2xl border p-3.5 text-[13.5px] leading-5", data.worker.alive ? "border-success/30 bg-success/10" : "border-danger/35 bg-danger/10")}>{data.worker.alive ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" /> : <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" />}<div className="min-w-0 flex-1">{data.worker.alive ? `Worker running${data.worker.version ? ` (v${data.worker.version})` : ""}.` : "The worker is not responding: nothing is indexed, imported or backed up until it is restarted."}{data.worker.lastBeatAt && <span className="text-fg-muted"> Last sign of life {timeAgo(data.worker.lastBeatAt)}.</span>}{!data.worker.alive && <div className="mt-1 text-fg-muted">On the server: <code className="font-mono text-[12px]">pm2 restart note-worker</code> (runbook: docs/operations.md → Worker stuck).</div>}</div></div>
      {data.stuck.length > 0 && <div className="rounded-2xl border border-warning/40 bg-warning/15 p-3.5 text-[13.5px] leading-5"><b>{data.stuck.length} job(s) running longer than allowed.</b> They are released automatically when their time limit passes; if this persists, restart the worker.<ul className="mt-1 text-[12.5px] text-fg-muted">{data.stuck.map((s) => <li key={s.id}>{LABEL[s.name] ?? s.name} · started {timeAgo(s.startedAt)}</li>)}</ul></div>}
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bg-elev">{data.queues.map((q) => <li key={q.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-[13.5px]"><span className="min-w-0 flex-1 basis-32 font-medium">{LABEL[q.name] ?? q.name}</span><span className="tabular-nums text-fg-muted">{q.created + q.retry} waiting</span><span className="tabular-nums text-fg-muted">{q.active} running</span><span className={cn("tabular-nums", q.failed ? "text-danger-text" : "text-fg-faint")}>{q.failed} failed</span><span className="basis-full text-[11.5px] text-fg-faint">{q.policy ? (q.policy.retryLimit ? `retries ${q.policy.retryLimit}×${q.policy.backoff ? " with backoff" : ""}` : "no automatic retry") + ` · limit ${Math.round(q.policy.expireInSeconds / 60)} min` : ""}</span></li>)}</ul>
      <section><h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Failed in the last 7 days{data.deadLetter ? ` · ${data.deadLetter} in the dead-letter queue` : ""}</h3>
        {data.failed.length ? <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bg-elev">{data.failed.map((j) => <li key={j.id} className="flex items-start gap-2 px-3.5 py-2.5"><div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{LABEL[j.name] ?? j.name} <span className="font-normal text-fg-faint">· {timeAgo(j.at)} · {j.attempts} attempt{j.attempts > 1 ? "s" : ""}</span></div><div className="break-words text-[12.5px] text-danger-text [overflow-wrap:anywhere]">{j.error}</div></div><Button size="sm" variant="outline" className="h-10 shrink-0" onClick={() => retry(j)}><RotateCcw /> Retry</Button></li>)}</ul> : <p className="rounded-2xl border border-line bg-bg-elev px-3.5 py-4 text-[13.5px] text-fg-muted">Nothing failed.</p>}
      </section>
    </div>
  );
}
