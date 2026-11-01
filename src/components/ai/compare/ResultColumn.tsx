"use client";
import { Check, Copy, FilePlus2, Trophy } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Badge, Spinner } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { ms, providerTone, usd, type ModelRow } from "@/components/ai/models/format";
import { uniqueSentences } from "./diff";

export interface CompareResult { model: string; provider?: string; text?: string; usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number; reasoningTokens?: number }; costUsd?: number | null; latencyMs?: number; ttftMs?: number | null; refusal?: string | null; error?: string; pending?: boolean }
export function ResultColumn({ r, meta, others, diff, best, canVote, onCopy, onSave, onBest }: { r: CompareResult; meta: ModelRow | undefined; others: string[]; diff: boolean; best: boolean; canVote: boolean; onCopy: () => void; onSave: () => void; onBest: () => void }) {
  const provider = r.provider ?? meta?.provider ?? "";
  return (
    <div className={cn("flex min-h-[260px] w-[86vw] shrink-0 snap-center flex-col rounded-xl border bg-bg-elev shadow-card md:w-auto md:min-w-0 md:flex-1 md:snap-none", best ? "border-success/50 ring-1 ring-success/30" : "border-line")}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className={cn("size-2 rounded-full", providerTone(provider))} /><div className="min-w-0 flex-1"><div className="truncate font-mono text-[12.5px] font-medium">{r.model}</div><div className="text-[11px] text-fg-muted">{provider}{meta?.benchmark?.pass_rate != null && ` · ${Math.round(meta.benchmark.pass_rate * 100)}% pass`}{meta?.inputPrice != null && ` · $${meta.inputPrice}/$${meta.outputPrice} per M`}</div></div>
        {best && <Badge tone="success"><Trophy className="mr-0.5 size-3" />best</Badge>}{r.pending && <Spinner className="size-3.5" />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[14px]">
        {r.error ? <div className="rounded-md border border-danger/30 bg-danger/5 p-2 text-[12.5px] text-danger">{r.error}</div> : r.pending ? <div className="text-[13px] text-fg-faint">Waiting for {r.model}…</div> : diff ? <div className="prose-md whitespace-pre-wrap text-[14px] leading-6">{uniqueSentences(r.text ?? "", others).map((s, i) => <span key={i} className={cn(s.unique && "rounded bg-warning/25 px-0.5 box-decoration-clone")}>{s.s} </span>)}</div> : <Markdown text={r.text ?? ""} />}
        {r.refusal && <div className="mt-2 text-[11.5px] text-warning">Refusal detected: {r.refusal}</div>}
      </div>
      {!r.pending && !r.error && <div className="border-t border-line px-3 py-1.5">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fg-muted tabular-nums"><span title="Total latency">{ms(r.latencyMs)}</span><span title="Time to first token">TTFT {ms(r.ttftMs)}</span><span title="Tokens in / out (+reasoning)">{r.usage?.inputTokens ?? 0} → {r.usage?.outputTokens ?? 0}{r.usage?.reasoningTokens ? ` (+${r.usage.reasoningTokens} think)` : ""}</span><span title="Estimated cost">{usd(r.costUsd)}</span></div>
        <div className="mt-1 flex gap-1">
          <button onClick={onCopy} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-fg-muted hover:bg-bg-sunk hover:text-fg"><Copy className="size-3.5" />Copy</button>
          <button onClick={onSave} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-fg-muted hover:bg-bg-sunk hover:text-fg"><FilePlus2 className="size-3.5" />Save to note</button>
          <button onClick={onBest} disabled={!canVote} title={canVote ? "Mark this answer as the best of the comparison" : "Available once the comparison is saved"} className={cn("ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] disabled:opacity-40", best ? "text-success" : "text-fg-muted hover:bg-bg-sunk hover:text-fg")}>{best ? <Check className="size-3.5" /> : <Trophy className="size-3.5" />}{best ? "Best" : "Mark as best"}</button>
        </div>
      </div>}
    </div>
  );
}
