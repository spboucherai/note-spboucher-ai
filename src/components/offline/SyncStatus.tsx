"use client";
/**
 * file: src/components/offline/SyncStatus.tsx
 * description: visible sync status of the device (pending count, last sync, errors) and the "what is waiting" inspector: every journal
 *   entry, page draft, capture and queued image still on this device, with retry / discard for what the server refused, the conflicts
 *   to settle, "Sync now", and the on-demand integrity check (content hashes vs the server). Used by the top bar, the phone header and
 *   the offline app.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useCallback, useEffect, useState } from "react";
import { Check, CloudOff, CloudUpload, RefreshCw, ShieldCheck, TriangleAlert, Trash2, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, Spinner } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useOnline } from "@/lib/client/hooks";
import { describe, discardEntry, pendingState, retryEntry, syncNow, type PendingState } from "@/lib/client/journal";
import { syncInfo, verifyIntegrity, listReplicaPages, type IntegrityReport, type SyncInfo } from "@/lib/client/replica";
import { discardOutboxItem, flushOutbox, outboxState } from "@/lib/client/outbox";
import { getMeta, type OutboxItem } from "@/lib/client/offline";
import { cn, timeAgo } from "@/lib/utils";

export interface SyncSummary { ready: boolean; online: boolean; syncing: boolean; pending: number; failed: number; info: SyncInfo | null; state: PendingState | null; captures: OutboxItem[] }
/** Live summary of what is waiting on this device. */
export function useSyncSummary(): SyncSummary & { refresh: () => void } {
  const online = useOnline(); const [s, setS] = useState<Omit<SyncSummary, "online">>({ ready: false, syncing: false, pending: 0, failed: 0, info: null, state: null, captures: [] });
  const refresh = useCallback(() => {
    Promise.all([pendingState(), syncInfo(), outboxState()]).then(([state, info, out]) => setS((p) => ({ ...p, ready: true, state, info, captures: out.items, pending: state.pending + out.waiting, failed: state.failed + out.failed }))).catch(() => setS((p) => ({ ...p, ready: true })));
  }, []);
  useEffect(() => {
    refresh(); const onSync = (e: Event) => { setS((p) => ({ ...p, syncing: Boolean((e as CustomEvent).detail?.syncing) })); refresh(); };
    const evs = ["note:journal-changed", "note:local-changed", "note:outbox-changed", "note:replica-changed", "online", "offline"];
    for (const n of evs) window.addEventListener(n, refresh); window.addEventListener("note:sync-state", onSync);
    return () => { for (const n of evs) window.removeEventListener(n, refresh); window.removeEventListener("note:sync-state", onSync); };
  }, [refresh]);
  return { ...s, online, refresh };
}

/** Small status button; opens the inspector. `quiet` hides it while everything is synced and the network is there (phone header). */
export function SyncStatus({ className, quiet = false }: { className?: string; quiet?: boolean }) {
  const s = useSyncSummary(); const [open, setOpen] = useState(false);
  useEffect(() => { const h = () => setOpen(true); window.addEventListener("note:sync-inspector", h); return () => window.removeEventListener("note:sync-inspector", h); }, []);
  const tone = !s.online ? "offline" : s.failed ? "error" : s.pending ? "pending" : "synced";
  const label = tone === "offline" ? (s.pending ? `Offline · ${s.pending} waiting` : "Offline") : tone === "error" ? `${s.failed} to review` : tone === "pending" ? `${s.pending} to sync` : "Synced";
  const title = `${label}${s.info?.lastSync ? ` · last sync ${timeAgo(s.info.lastSync)}` : ""}`;
  return (
    <>
      {!(quiet && tone === "synced") && <button type="button" data-testid="sync-status" data-state={tone} data-pending={s.pending} aria-label={`Sync status: ${title}`} title={title} onClick={() => setOpen(true)}
        className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors", tone === "synced" ? "text-fg-muted hover:bg-bg-hover" : tone === "pending" ? "bg-accent-soft text-accent" : tone === "offline" ? "bg-warning/20 text-fg" : "bg-danger/15 text-danger", className)}>
        {s.syncing ? <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" /> : tone === "offline" ? <CloudOff className="size-4" /> : tone === "error" ? <TriangleAlert className="size-4" /> : tone === "pending" ? <CloudUpload className="size-4" /> : <Check className="size-4" />}
        <span className={cn(tone === "synced" && "max-lg:hidden")}>{label}</span>
      </button>}
      <SyncInspector open={open} onOpenChange={setOpen} summary={s} />
    </>
  );
}

const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);
export function SyncInspector({ open, onOpenChange, summary }: { open: boolean; onOpenChange: (o: boolean) => void; summary: SyncSummary & { refresh: () => void } }) {
  const s = summary; const [busy, setBusy] = useState<string | null>(null); const [report, setReport] = useState<IntegrityReport | null>(null); const [error, setError] = useState<string | null>(null); const [titles, setTitles] = useState<Record<string, string>>({}); const [usage, setUsage] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return; s.refresh();
    listReplicaPages().then((ps) => setTitles(Object.fromEntries(ps.map((p) => [p.id, p.title])))).catch(() => {});
    getMeta<IntegrityReport>("integrity").then((r) => setReport(r ?? null));
    navigator.storage?.estimate?.().then((e) => setUsage(e.usage ? fmtBytes(e.usage) : null)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  async function run(name: string, fn: () => Promise<unknown>) { setBusy(name); setError(null); try { await fn(); } catch (e: any) { setError(e?.message ?? "Failed"); } finally { setBusy(null); s.refresh(); } }
  const st = s.state; const journal = st?.journal ?? []; const drafts = st?.drafts ?? []; const total = journal.length + drafts.length + s.captures.length;
  const row = "flex min-h-11 items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-[13px]";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Sync" description="What this device holds and what is still waiting to reach the server." wide>
        <div data-testid="sync-inspector" className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-muted">
            <span data-testid="sync-online" className={cn("font-medium", s.online ? "text-success" : "text-warning")}>{s.online ? "Online" : "Offline"}</span>
            <span data-testid="sync-last">Last sync: {s.info?.lastSync ? timeAgo(s.info.lastSync) : "never"}</span>
            <span data-testid="sync-replica">On this device: {s.info?.pages ?? 0} notes · {s.info?.tasks ?? 0} tasks{usage ? ` · ${usage}` : ""}</span>
          </div>
          {s.info?.lastError && <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">Last sync failed: {s.info.lastError}</div>}
          {error && <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</div>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!s.online || !!busy} onClick={() => run("sync", async () => { await flushOutbox(); const r = await syncNow(); if (r.error) throw new Error(r.error); })}>{busy === "sync" ? <Spinner /> : <RefreshCw />} Sync now</Button>
            <Button size="sm" variant="outline" disabled={!s.online || !!busy} onClick={() => run("verify", async () => setReport(await verifyIntegrity()))}>{busy === "verify" ? <Spinner /> : <ShieldCheck />} Verify integrity</Button>
          </div>
          {report && <div data-testid="integrity-report" data-ok={report.mismatched.length - report.repaired === 0 ? "1" : "0"} className="rounded-lg border border-line bg-bg-sunk px-3 py-2 text-[13px]">
            <div className="font-medium">{report.mismatched.length === 0 ? "Integrity verified" : report.repaired === report.mismatched.length ? "Integrity repaired" : "Integrity problems"} <span className="font-normal text-fg-muted">· {timeAgo(report.at)}</span></div>
            <div className="text-fg-muted">{report.ok} of {report.checked} notes identical to the server (SHA-256 of the content){report.stale ? ` · ${report.stale} behind (fixed by a sync)` : ""}{report.missingLocal ? ` · ${report.missingLocal} not yet on this device` : ""}{report.localOnly ? ` · ${report.localOnly} only on this device (waiting)` : ""}{report.mismatched.length ? ` · ${report.mismatched.length} different, ${report.repaired} replaced by the server copy` : ""}.</div>
          </div>}
          {!!st?.conflicts.length && <section aria-label="Conflicts"><h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">Conflicts ({st.conflicts.length})</h3>
            <ul className="space-y-1.5">{st.conflicts.map((c) => <li key={c.pageId} data-testid="sync-conflict" className={row}><TriangleAlert className="size-4 shrink-0 text-warning" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.title || "Untitled"}</span><span className="block text-[12px] text-fg-muted">Changed elsewhere while you edited it offline. Nothing was overwritten: open the note to compare and choose.</span></span><a href={`/p/${c.pageId}`} className="shrink-0 rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-medium text-accent-fg">Open</a></li>)}</ul></section>}
          <section aria-label="Waiting to sync"><h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">Waiting to sync ({total})</h3>
            {total === 0 ? <p data-testid="sync-empty" className="text-[13px] text-fg-muted">Nothing is waiting. Everything on this device has reached the server.</p> : <ul className="max-h-[42dvh] space-y-1.5 overflow-y-auto">
              {journal.map((e) => <li key={e.seq} data-testid="sync-entry" data-kind={e.kind} data-state={e.state} className={row}>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{describe(e)}{e.kind !== "page.create" && e.kind !== "task.create" && titles[e.entityId] ? ` · ${titles[e.entityId]}` : ""}</span><span className={cn("block text-[12px]", e.state === "failed" ? "text-danger" : "text-fg-muted")}>{e.state === "failed" ? `Refused by the server: ${e.lastError}` : `${timeAgo(new Date(e.createdAt).toISOString())}${e.attempts ? ` · ${e.attempts} attempt${e.attempts > 1 ? "s" : ""}${e.lastError ? ` · ${e.lastError}` : ""}` : ""}`}</span></span>
                {e.state === "failed" && <><button aria-label="Retry" className="icon-btn" onClick={() => run("retry", () => retryEntry(e.seq!))}><RotateCcw className="size-4" /></button><button aria-label="Discard" className="icon-btn" onClick={() => { if (window.confirm("Discard this change? It will not be sent.")) run("discard", () => discardEntry(e.seq!)); }}><Trash2 className="size-4" /></button></>}
              </li>)}
              {drafts.map((d) => <li key={d.pageId} data-testid="sync-draft" className={row}><span className="min-w-0 flex-1"><span className="block truncate font-medium">Text of “{(d.patch.title as string) || titles[d.pageId] || "Untitled"}”</span><span className="block text-[12px] text-fg-muted">Edited {timeAgo(new Date(d.updatedAt).toISOString())} · kept on this device until the server confirms it</span></span><a href={`/p/${d.pageId}`} className="shrink-0 text-[12px] font-medium text-accent hover:underline">Open</a></li>)}
              {s.captures.map((c) => <li key={c.id} data-testid="sync-capture" className={row}><span className="min-w-0 flex-1"><span className="block truncate font-medium">Capture: {(c.body.text || c.body.url || c.body.kind).slice(0, 80)}</span><span className={cn("block text-[12px]", c.lastError ? "text-danger" : "text-fg-muted")}>{c.lastError ? c.lastError : timeAgo(new Date(c.createdAt).toISOString())}{c.files?.length ? ` · ${c.files.length} file${c.files.length > 1 ? "s" : ""}` : ""}</span></span>{c.attempts > 0 && <button aria-label="Discard capture" className="icon-btn" onClick={() => { if (window.confirm("Discard this capture? It will not be sent.")) run("discard", () => discardOutboxItem(c.id)); }}><Trash2 className="size-4" /></button>}</li>)}
            </ul>}
            {!!st?.blobs && <p data-testid="sync-blobs" className="mt-2 text-[12px] text-fg-muted">{st.blobs} image{st.blobs > 1 ? "s" : ""} added offline ({fmtBytes(st.blobBytes)}) waiting to upload. Limit: 10 MB per image, 100 MB in total.</p>}
          </section>
          <p className="text-[12px] leading-5 text-fg-muted">Notes are kept on this device so they can be read and edited without a connection. “Lock this device” erases this copy.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
