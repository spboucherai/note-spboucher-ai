"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Trash2, RotateCcw, AlertTriangle, Clock } from "lucide-react";
import { api } from "@/lib/client/api";
import { fmtDate, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, DialogContent, Empty, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { withFreshAuth } from "@/lib/client/passkey";

interface TrashedPage { id: string; title: string; icon: string | null; section: string; type: string; deletedAt: string; wordCount: number; updatedAt: string }
const AUTO_PURGE_DAYS = 30;

export function TrashView() {
  const qc = useQueryClient(); const r = useRouter();
  const [purged, setPurged] = useState<number | null>(null);
  const { data: items = [], isLoading, refetch } = useQuery({ queryKey: ["trash"], queryFn: () => api<TrashedPage[]>("/api/pages?view=trash&limit=100"), enabled: purged !== null, staleTime: 5_000 });
  // Nothing is ever deleted by merely opening this screen: purging old items is an explicit, passkey-confirmed action.
  useEffect(() => { setPurged(0); }, []);
  async function purgeOld() { if (!window.confirm(`Delete forever everything trashed more than ${AUTO_PURGE_DAYS} days ago? This cannot be undone.`)) return; try { const res = await withFreshAuth(() => api("/api/trash", { method: "POST", json: { action: "purge-old", days: AUTO_PURGE_DAYS } })); setPurged(res.purged ?? 0); toast(res.purged ? `${res.purged} old item${res.purged === 1 ? "" : "s"} deleted forever` : "Nothing older than 30 days"); refresh(); } catch (e: any) { toast("Nothing was deleted", { description: e.message, tone: "danger" }); } }
  const [confirm, setConfirm] = useState<{ kind: "one"; page: TrashedPage } | { kind: "all" } | null>(null); const [busy, setBusy] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["trash"] }); qc.invalidateQueries({ queryKey: ["tree"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  async function restore(p: TrashedPage) { try { await api(`/api/pages/${p.id}?action=restore`, { method: "POST" }); toast("Restored", { description: p.title || "Untitled", tone: "success" }); refresh(); } catch (e: any) { toast("Restore failed", { description: e.message, tone: "danger" }); } }
  async function doConfirm() {
    if (!confirm) return; setBusy(true);
    try {
      if (confirm.kind === "one") { await withFreshAuth(() => api(`/api/pages/${confirm.page.id}?purge=1`, { method: "DELETE" })); toast("Deleted forever", { description: confirm.page.title || "Untitled" }); }
      else { const res = await withFreshAuth(() => api("/api/trash", { method: "DELETE" })); toast("Trash emptied", { description: `${res.purged} page${res.purged === 1 ? "" : "s"} deleted forever` }); }
      setConfirm(null); refresh();
    } catch (e: any) { toast("Delete failed", { description: e.message, tone: "danger" }); } finally { setBusy(false); }
  }
  const daysLeft = (iso: string) => Math.max(0, AUTO_PURGE_DAYS - Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold tracking-tight">Trash</h1><p className="mt-0.5 text-[13px] leading-5 text-fg-muted">Trashed pages stay here until you delete them. Nothing is removed automatically. <button type="button" onClick={purgeOld} className="font-medium text-accent underline-offset-2 hover:underline">Delete items older than {AUTO_PURGE_DAYS} days…</button></p></div>
        <Button size="sm" variant="outline" className="text-danger hover:bg-danger/10" disabled={!items.length} onClick={() => setConfirm({ kind: "all" })}><Trash2 /> Empty trash</Button>
      </div>
      {isLoading || purged === null ? <div className="flex justify-center py-16"><Spinner /></div> : !items.length ? <Empty icon={<Trash2 />} title="Trash is empty" hint="Pages you move to the trash can be restored from here for 30 days." action={<Button size="sm" variant="outline" onClick={() => r.push("/")}>Back home</Button>} /> : (
        <div className="overflow-hidden rounded-xl border border-line bg-bg-elev shadow-card">
          <div className="hidden grid-cols-[1fr_110px_150px_80px_170px] gap-2 border-b border-line bg-bg-sunk/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint md:grid"><span>Page</span><span>Section</span><span>Deleted</span><span className="text-right">Words</span><span /></div>
          {items.map((p) => (
            <div key={p.id} className="grid grid-cols-1 gap-2 border-b border-line px-3 py-2.5 last:border-b-0 md:grid-cols-[1fr_110px_150px_80px_170px] md:items-center">
              <Link href={`/p/${p.id}`} className="flex min-w-0 items-center gap-2 text-[13.5px] hover:text-accent"><span className="w-5 shrink-0 text-center">{p.icon ?? (p.type === "database" ? "🗂" : p.type === "research" ? "🔬" : "📄")}</span><span className="truncate">{p.title || "Untitled"}</span></Link>
              <div className="flex items-center gap-2 text-[12px] text-fg-muted md:contents">
                <span><Badge>{p.section}</Badge></span>
                <span className="flex items-center gap-1 text-[12px] text-fg-muted" title={fmtDate(p.deletedAt, { dateStyle: "medium", timeStyle: "short" })}><Clock className="size-3 md:hidden" />{timeAgo(p.deletedAt)}<span className="text-fg-faint"> · {daysLeft(p.deletedAt) > 0 ? `${daysLeft(p.deletedAt)} d before it counts as old` : "old"}</span></span>
                <span className="text-[12px] tabular-nums text-fg-muted md:text-right">{p.wordCount} w</span>
              </div>
              <div className="flex items-center gap-1 md:justify-end"><Button size="sm" variant="ghost" onClick={() => restore(p)}><RotateCcw /> Restore</Button><Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirm({ kind: "one", page: p })}><Trash2 /> Delete</Button></div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <DialogContent title={confirm?.kind === "all" ? "Empty the trash?" : "Delete forever?"} description={confirm?.kind === "all" ? `All ${items.length} page${items.length === 1 ? "" : "s"} in the trash, including their versions and attachments, will be permanently deleted.` : confirm ? `"${confirm.page.title || "Untitled"}" and its sub-pages will be permanently deleted. This cannot be undone.` : ""}>
          <div className="flex items-center gap-2 rounded-md bg-danger/5 px-3 py-2 text-[12px] text-danger"><AlertTriangle className="size-4 shrink-0" /> This action is irreversible.</div>
          <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button variant="danger" onClick={doConfirm} disabled={busy} autoFocus>{busy ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <Trash2 />} {confirm?.kind === "all" ? "Empty trash" : "Delete forever"}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
