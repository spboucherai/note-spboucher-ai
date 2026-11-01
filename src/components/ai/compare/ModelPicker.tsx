"use client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";
import { perM, pct, providerTone, usd, type ModelRow } from "@/components/ai/models/format";

export const MIN_MODELS = 2, MAX_MODELS = 6;
export function ModelPicker({ models, selected, onChange, disabled }: { models: ModelRow[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const toggle = (id: string) => { if (selected.includes(id)) onChange(selected.filter((x) => x !== id)); else if (selected.length < MAX_MODELS) onChange([...selected, id]); };
  const groups = ["openai", "anthropic"].map((p) => ({ p, items: models.filter((m) => m.provider === p && m.available && m.category !== "embedding" && m.probes?.text?.status === "ok").sort((a, b) => (b.benchmark?.mean_score ?? -1) - (a.benchmark?.mean_score ?? -1) || a.id.localeCompare(b.id)) }));
  const presets: [string, string[]][] = [["Cheap duo", ["claude-haiku-5-5", "gpt-5.4-mini"]], ["Routing primaries", ["gpt-6-sol", "claude-sonnet-5-5", "claude-haiku-5-5", "gpt-5.4-mini"]], ["Frontier", ["claude-fable-5-1", "gpt-6-astra", "claude-opus-5-5"]]];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px]"><span className="text-fg-muted">{selected.length} / {MAX_MODELS} selected{selected.length < MIN_MODELS && ` · pick at least ${MIN_MODELS}`}</span>{presets.map(([l, ids]) => <button key={l} type="button" disabled={disabled} onClick={() => onChange(ids.filter((id) => models.some((m) => m.id === id && m.available)))} className="rounded-full border border-line px-2 py-0.5 hover:bg-bg-sunk disabled:opacity-50">{l}</button>)}{selected.length > 0 && <button type="button" disabled={disabled} onClick={() => onChange([])} className="text-fg-muted hover:text-fg">clear</button>}</div>
      <div className="grid gap-3 sm:grid-cols-2">{groups.map((g) => <div key={g.p} className="rounded-xl border border-line bg-bg-elev shadow-card">
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-[12px] font-medium"><span className={cn("size-2 rounded-full", providerTone(g.p))} />{g.p === "openai" ? "OpenAI" : "Anthropic"}<span className="ml-auto font-normal text-fg-muted">{g.items.length}</span></div>
        <ul className="max-h-56 overflow-y-auto p-1">{g.items.map((m) => { const on = selected.includes(m.id); const full = !on && selected.length >= MAX_MODELS; return <li key={m.id}><label className={cn("flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12.5px] hover:bg-bg-sunk", on && "bg-accent-soft/60", (full || disabled) && "cursor-not-allowed opacity-60")}><input type="checkbox" className="accent-accent" checked={on} disabled={full || disabled} onChange={() => toggle(m.id)} /><span className="min-w-0 flex-1 truncate font-mono text-[12px]">{m.id}</span><span className="hidden text-[11px] text-fg-muted tabular-nums sm:inline">{perM(m.inputPrice)}/{perM(m.outputPrice)} per M</span>{m.benchmark?.pass_rate != null ? <Badge tone={m.benchmark.pass_rate === 1 ? "success" : "warning"}>{pct(m.benchmark.pass_rate)} · {usd(m.benchmark.cost_mean)}</Badge> : <Badge>untested</Badge>}</label></li>; })}</ul>
      </div>)}</div>
    </div>
  );
}
