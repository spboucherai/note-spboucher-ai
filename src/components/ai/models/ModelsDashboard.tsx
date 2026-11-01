"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/primitives";
import { ProviderCards } from "./ProviderCards";
import { CatalogueTable } from "./CatalogueTable";
import { Heatmap } from "./Heatmap";
import { Scatter } from "./Scatter";
import { RoutingTable } from "./RoutingTable";
import { UsagePanel, type UsagePayload } from "./UsagePanel";
import { Provenance } from "./Provenance";
import { hasBench, type ModelsPayload, type RouteDef } from "./format";

const SECTIONS = [["providers", "Providers"], ["catalogue", "Catalogue"], ["heatmap", "Per-task heatmap"], ["scatter", "Trade-offs"], ["routing", "Routing"], ["usage", "Usage"], ["provenance", "Provenance"]] as const;
function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return <section id={id} className="scroll-mt-16"><div className="mb-2 flex items-baseline gap-2"><h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>{hint && <span className="text-[12px] text-fg-muted">{hint}</span>}</div>{children}</section>;
}
export function ModelsDashboard() {
  const qc = useQueryClient(); const [discovering, setDiscovering] = useState(false); const [saving, setSaving] = useState(false);
  const { data, isLoading, error } = useQuery<ModelsPayload>({ queryKey: ["ai-models", "all"], queryFn: () => api("/api/ai/models?all=1"), staleTime: 30_000 });
  const { data: usage } = useQuery<UsagePayload>({ queryKey: ["ai-usage", 30], queryFn: () => api("/api/ai/usage?days=30"), staleTime: 30_000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["ai-models"] }); };
  async function discover() { setDiscovering(true); try { const r = await api("/api/ai/models", { method: "POST", json: { action: "discover" } }); toast("Discovery finished", { description: Object.entries(r).map(([p, v]: any) => `${p}: ${v.status}${v.listed ? ` (${v.listed} listed)` : ""}`).join(" · "), tone: "success" }); refresh(); } catch (e: any) { toast("Discovery failed", { description: e.message, tone: "danger" }); } finally { setDiscovering(false); } }
  async function toggle(id: string, enabled: boolean) { qc.setQueryData<ModelsPayload>(["ai-models", "all"], (d) => d && { ...d, models: d.models.map((m) => (m.id === id ? { ...m, enabled } : m)) }); try { await api("/api/ai/models", { method: "POST", json: { action: "toggle", id, enabled } }); refresh(); } catch (e: any) { toast("Could not update model", { description: e.message, tone: "danger" }); refresh(); } }
  async function saveRoutes(routes: Record<string, RouteDef>) { setSaving(true); try { await api("/api/ai/models", { method: "POST", json: { action: "routes", routes } }); toast("Routes saved", { tone: "success" }); refresh(); } catch (e: any) { toast("Could not save routes", { description: e.message, tone: "danger" }); } finally { setSaving(false); } }
  async function saveBudget(usd: number) { try { await api("/api/ai/models", { method: "POST", json: { action: "budget", usd } }); toast(`Daily budget set to $${usd}`, { tone: "success" }); } catch (e: any) { toast("Could not save budget", { description: e.message, tone: "danger" }); } }
  if (isLoading) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  if (error || !data) return <div className="p-6 text-sm text-danger">Could not load the model catalogue{error ? `: ${(error as Error).message}` : ""}.</div>;
  const benchmarked = data.models.filter(hasBench); const text = data.models.filter((m) => m.category !== "embedding");
  const highlights = [...new Set(Object.values(data.routes).map((r) => r.primary))];
  const pricing = { openai: data.models.find((m) => m.provider === "openai" && m.pricingSource)?.pricingSource, anthropic: data.models.find((m) => m.provider === "anthropic" && m.pricingSource)?.pricingSource };
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div><h1 className="text-2xl font-semibold tracking-tight">AI models</h1><p className="mt-0.5 text-[13px] text-fg-muted">{text.length} text models in the catalogue · {benchmarked.length} benchmarked on {data.benchmark?.runs ?? 0} real runs · routing decided from measurements, not marketing.</p></div>
        <nav className="ml-auto hidden flex-wrap gap-1 md:flex">{SECTIONS.map(([id, l]) => <a key={id} href={`#${id}`} className="rounded-md px-2 py-1 text-[12px] text-fg-muted hover:bg-bg-sunk hover:text-fg">{l}</a>)}</nav>
      </div>
      <div className="space-y-8">
        <Section id="providers" title="Providers"><ProviderCards providers={data.providers} models={data.models} onDiscover={discover} discovering={discovering} /></Section>
        <Section id="catalogue" title="Catalogue" hint="click a header to sort · toggle “On” to allow a model in automatic routing"><CatalogueTable models={data.models} onToggle={toggle} /></Section>
        <Section id="heatmap" title="Per-task heatmap" hint="models × benchmark categories, sorted by mean score"><Heatmap models={data.models} categories={data.benchmark?.categories ?? []} /></Section>
        <Section id="scatter" title="Trade-offs" hint="hover a point for details">
          <div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-line bg-bg-elev p-3 shadow-card"><div className="mb-1 text-[13px] font-medium">Latency vs score</div><Scatter models={data.models} metric="latency" highlight={highlights} /></div><div className="rounded-xl border border-line bg-bg-elev p-3 shadow-card"><div className="mb-1 text-[13px] font-medium">Cost per run vs score</div><Scatter models={data.models} metric="cost" highlight={highlights} /></div></div>
        </Section>
        <Section id="routing" title="Routing" hint="task class → primary / fallback / effort"><RoutingTable key={JSON.stringify(data.routes)} routes={data.routes} defaults={data.defaultRoutes} labels={data.taskLabels} models={data.models} onSave={saveRoutes} saving={saving} /></Section>
        <Section id="usage" title="Usage" hint="last 30 days, from ai_usage"><UsagePanel usage={usage} budget={null} onBudget={saveBudget} /></Section>
        <Section id="provenance" title="Provenance & method"><Provenance benchmark={data.benchmark} benchmarked={benchmarked.length} pricing={pricing} /></Section>
      </div>
    </div>
  );
}
