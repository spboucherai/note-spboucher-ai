import { fmtDate } from "@/lib/utils";
import { usd, type ModelsPayload } from "./format";
export function Provenance({ benchmark, benchmarked, pricing }: { benchmark: ModelsPayload["benchmark"]; benchmarked: number; pricing: { openai?: string | null; anthropic?: string | null } }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-line bg-bg-elev p-4 shadow-card text-[12.5px] leading-5">
        <div className="text-[13px] font-semibold">Benchmark provenance</div>
        {benchmark ? <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums"><dt className="text-fg-muted">Generated</dt><dd>{fmtDate(benchmark.generated, { dateStyle: "medium", timeStyle: "short" })}</dd><dt className="text-fg-muted">Real runs</dt><dd>{benchmark.runs} across {benchmarked} models · 2 trials per cell</dd><dt className="text-fg-muted">Categories</dt><dd>{benchmark.categories.length} ({benchmark.categories.map((c) => c.label).join(", ")})</dd><dt className="text-fg-muted">LLM judges</dt><dd className="font-mono text-[11.5px]">{benchmark.judges.join(", ")}</dd><dt className="text-fg-muted">Total cost</dt><dd>{usd(benchmark.total_cost, 2)} (estimated)</dd><dt className="text-fg-muted">Report</dt><dd><code className="font-mono text-[11.5px]">docs/ai-model-comparison.md</code> · routing policy in <code className="font-mono text-[11.5px]">docs/ai-routing-strategy.md</code></dd></dl> : <p className="mt-2 text-fg-muted">No benchmark summary seeded — run <code className="font-mono text-[11.5px]">pnpm bench:run && pnpm bench:report && pnpm seed:ai</code>.</p>}
      </div>
      <div className="rounded-xl border border-line bg-bg-elev p-4 shadow-card text-[12.5px] leading-5">
        <div className="text-[13px] font-semibold">Measured vs estimated</div>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-fg-muted">
          <li><span className="text-fg">Measured:</span> pass rates, scores, TTFT, latency and tok/s come from real API calls on the benchmark date; provider load at that time affects latency. Two trials per cell — differences of a few points are noise.</li>
          <li><span className="text-fg">Judged (1–5):</span> an experimental two-judge LLM rubric for writing and synthesis only; never used for pass rates or routing eligibility.</li>
          <li><span className="text-fg">Estimated:</span> $/run and the usage panel multiply provider-reported tokens by list prices ({pricing.openai ? <a className="text-accent underline-offset-2 hover:underline" href={pricing.openai} target="_blank" rel="noopener noreferrer">OpenAI</a> : "OpenAI"}, {pricing.anthropic ? <a className="text-accent underline-offset-2 hover:underline" href={pricing.anthropic} target="_blank" rel="noopener noreferrer">Anthropic</a> : "Anthropic"}); invoices are authoritative.</li>
          <li><span className="text-fg">Probes:</span> capability badges (text, streaming, tools, JSON, vision, reasoning control) are live checks from discovery, not vendor claims. Pro-tier models were discovered but not benchmarked (cost).</li>
        </ul>
      </div>
    </div>
  );
}
