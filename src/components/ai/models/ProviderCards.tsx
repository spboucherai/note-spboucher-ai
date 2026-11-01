"use client";
import { KeyRound, RefreshCw } from "lucide-react";
import { Badge, Spinner } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import { hasBench, providerTone, type ModelRow, type ProviderRow } from "./format";

export function ProviderCards({ providers, models, onDiscover, discovering }: { providers: ProviderRow[]; models: ModelRow[]; onDiscover: () => void; discovering: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {providers.map((p) => {
        const mine = models.filter((m) => m.provider === p.id); const avail = mine.filter((m) => m.available); const enabled = avail.filter((m) => m.enabled && m.category !== "embedding"); const tested = mine.filter(hasBench);
        const tone = p.configured ? (p.status === "error" ? "danger" : "success") : "warning";
        return (
          <div key={p.id} className="rounded-xl border border-line bg-bg-elev p-4 shadow-card">
            <div className="flex items-center gap-2"><span className={cn("size-2.5 rounded-full", providerTone(p.id))} /><div className="text-sm font-semibold">{p.name}</div>
              <Badge tone={tone} className="ml-auto">{p.configured ? (p.status === "error" ? "error" : "key configured") : "no API key"}</Badge></div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[["listed", mine.length], ["available", avail.length], ["enabled", enabled.length], ["benchmarked", tested.length]].slice(0, 3).map(([l, n]) => <div key={String(l)} className="rounded-lg bg-bg-sunk px-2 py-1.5"><div className="text-lg font-semibold leading-tight">{n}</div><div className="text-[11px] text-fg-muted">{l}</div></div>)}
            </div>
            <div className="mt-3 flex items-center justify-between text-[12px] text-fg-muted"><span className="inline-flex items-center gap-1"><KeyRound className="size-3.5" />{tested.length} benchmarked</span><span title={p.statusDetail ?? ""}>{p.lastDiscoveryAt ? `discovered ${timeAgo(p.lastDiscoveryAt)}` : "never discovered"}</span></div>
          </div>
        );
      })}
      <div className="flex flex-col justify-between rounded-xl border border-dashed border-line-strong p-4">
        <div><div className="text-sm font-semibold">Live discovery</div><p className="mt-1 text-[12.5px] leading-5 text-fg-muted">Re-lists <code className="font-mono text-[11px]">/v1/models</code> on each configured provider, flips availability, and adds new ids as disabled/untested. Benchmarks are only refreshed by <code className="font-mono text-[11px]">pnpm bench:*</code>.</p></div>
        <Button variant="secondary" size="sm" className="mt-3 self-start" onClick={onDiscover} disabled={discovering}>{discovering ? <Spinner className="size-3.5" /> : <RefreshCw />}Re-discover models</Button>
      </div>
    </div>
  );
}
