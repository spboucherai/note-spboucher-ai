"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export function TemplateChooser({ dbId, onDone, onSkip, embedded }: { dbId: string; onDone: () => void; onSkip?: () => void; embedded?: boolean }) {
  const { data } = useQuery<{ id: string; name: string; icon: string; description: string; properties: string[] }[]>({ queryKey: ["db-templates"], queryFn: () => api("/api/databases/templates") });
  const [busy, setBusy] = useState<string | null>(null);
  const apply = async (t: string) => { setBusy(t); try { await api(`/api/databases/${dbId}/apply-template`, { method: "POST", json: { template: t } }); toast("Template applied", { tone: "success" }); onDone(); } catch (e: any) { toast("Could not apply template", { description: e?.message, tone: "danger" }); } finally { setBusy(null); } };
  return (
    <div className={cn(!embedded && "rounded-xl border border-dashed border-line p-5")}>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium"><LayoutTemplate className="size-4 text-fg-muted" /> Start from a template</div>
      {!data ? <Spinner /> : <div className="grid gap-2 sm:grid-cols-3">{data.map((t) => (
        <button key={t.id} type="button" disabled={!!busy} onClick={() => apply(t.id)} className="flex min-h-[7rem] flex-col rounded-lg border border-line bg-bg-elev p-3 text-left transition-colors hover:border-accent/50 hover:bg-bg-sunk disabled:opacity-60">
          <span className="text-xl">{t.icon}</span><span className="mt-1 text-[13px] font-medium">{t.name}</span><span className="mt-0.5 line-clamp-2 text-[12px] text-fg-muted">{t.description}</span><span className="mt-auto pt-2 text-[11px] text-fg-faint">{t.properties.join(" · ")}</span>
          {busy === t.id && <Spinner className="mt-1" />}
        </button>))}</div>}
      {onSkip && <div className="mt-3 flex items-center gap-2 text-[12px] text-fg-muted">or <Button size="xs" variant="outline" onClick={onSkip}>Start empty</Button></div>}
    </div>
  );
}
