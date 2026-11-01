"use client";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, Sparkles, ArrowRight } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Empty, Spinner } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import type { Suggestion } from "@/lib/graph/types";

export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: "accepted" | "rejected" }) => api("/api/graph/suggestions", { method: "PATCH", json: v }),
    onSuccess: (_d, v) => { toast(v.status === "accepted" ? "Link accepted" : "Suggestion rejected", { tone: v.status === "accepted" ? "success" : "neutral" }); qc.invalidateQueries({ queryKey: ["graph"] }); qc.invalidateQueries({ queryKey: ["graph-suggestions"] }); qc.invalidateQueries({ queryKey: ["graph-neighbors"] }); qc.invalidateQueries({ queryKey: ["backlinks"] }); },
    onError: (e: any) => toast("Could not update suggestion", { description: e.message, tone: "danger" }),
  });
}
export function ConfidenceBar({ value }: { value: number | null }) {
  const v = Math.round((value ?? 0) * 100);
  return <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted"><span className="h-1.5 w-12 overflow-hidden rounded-full bg-bg-sunk"><span className={cn("block h-full rounded-full", v >= 70 ? "bg-success" : v >= 45 ? "bg-ai" : "bg-warning")} style={{ width: `${v}%` }} /></span>{v}%</span>;
}
export function SuggestionItem({ s, onFocus, dense }: { s: Suggestion; onFocus?: (id: string) => void; dense?: boolean }) {
  const decide = useDecide(); const busy = decide.isPending && decide.variables?.id === s.id;
  const P = ({ id, title, icon }: { id: string; title: string; icon: string | null }) => onFocus ? <button className="truncate text-left font-medium hover:underline" onClick={() => onFocus(id)}>{icon ?? "📄"} {title}</button> : <Link href={`/p/${id}`} className="truncate font-medium hover:underline">{icon ?? "📄"} {title}</Link>;
  return (
    <div className={cn("rounded-lg border border-ai/25 bg-ai-soft/30 p-2.5", dense && "p-2")}>
      <div className="flex min-w-0 items-center gap-1.5 text-[13px]"><P id={s.fromId} title={s.fromTitle} icon={s.fromIcon} /><ArrowRight className="size-3.5 shrink-0 text-fg-faint" /><P id={s.toId} title={s.toTitle} icon={s.toIcon} /></div>
      {s.rationale && <p className="mt-1 text-[12.5px] leading-5 text-fg-muted">{s.rationale}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><ConfidenceBar value={s.confidence} />{!dense && s.model && <span className="truncate text-[11px] text-fg-faint" title={`${s.model} · ${timeAgo(s.createdAt)}`}>{s.model}</span>}</div>
        <div className="flex gap-1">
          <Button size="xs" variant="outline" className="h-8 min-w-[64px] md:h-7" disabled={busy} onClick={() => decide.mutate({ id: s.id, status: "rejected" })}><X /> Reject</Button>
          <Button size="xs" className="h-8 min-w-[64px] md:h-7" disabled={busy} onClick={() => decide.mutate({ id: s.id, status: "accepted" })}>{busy ? <Spinner className="size-3" /> : <Check />} Accept</Button>
        </div>
      </div>
    </div>
  );
}
export function SuggestionList({ items, loading, onFocus, dense, emptyHint }: { items: Suggestion[]; loading?: boolean; onFocus?: (id: string) => void; dense?: boolean; emptyHint?: string }) {
  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (!items.length) return <Empty icon={<Sparkles />} title="No pending suggestions" hint={emptyHint ?? "Run “Suggest connections” on a page or on the whole workspace. Candidates come from embedding similarity and are confirmed by a quick model."} />;
  return <div className="space-y-2">{items.map((s) => <SuggestionItem key={s.id} s={s} onFocus={onFocus} dense={dense} />)}</div>;
}
