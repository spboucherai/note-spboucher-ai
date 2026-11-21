/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/TemplateChooser.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export function TemplateChooser({ dbId, onDone, onSkip, embedded }: { dbId: string; onDone: () => void; onSkip?: () => void; embedded?: boolean }) {
  const { data, isError, refetch } = useQuery<{ id: string; name: string; icon: string; description: string; properties: string[] }[]>({ queryKey: ["db-templates"], queryFn: () => api("/api/databases/templates") });
  const [busy, setBusy] = useState<string | null>(null);
  const apply = async (t: string) => { setBusy(t); try { await api(`/api/databases/${dbId}/apply-template`, { method: "POST", json: { template: t } }); toast("Template applied", { tone: "success" }); onDone(); } catch (e: any) { toast("Could not apply template", { description: e?.message, tone: "danger" }); } finally { setBusy(null); } };
  return (
    <div className={cn(!embedded && "rounded-xl border border-dashed border-line p-5")}>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium"><LayoutTemplate className="size-4 text-fg-muted" /> Start from a template</div>
      {/* 3.0 (U8): a failed load says so and offers Retry (it used to spin forever) */}
      {isError ? <p role="alert" className="text-[13px] text-fg-muted">The templates could not be loaded. <button type="button" onClick={() => { void refetch(); }} className="font-medium text-accent underline-offset-2 hover:underline">Retry</button></p> : !data ? <Spinner /> : <div className="grid gap-2 sm:grid-cols-3">{data.map((t) => (
        <button key={t.id} type="button" disabled={!!busy} onClick={() => apply(t.id)} className="flex min-h-[7rem] flex-col rounded-lg border border-line bg-bg-elev p-3 text-left transition-colors hover:border-accent/50 hover:bg-bg-sunk disabled:opacity-60">
          <span className="text-xl">{t.icon}</span><span className="mt-1 text-[13px] font-medium">{t.name}</span><span className="mt-0.5 line-clamp-2 text-[12px] text-fg-muted">{t.description}</span><span className="mt-auto pt-2 text-[11px] text-fg-faint">{t.properties.join(" · ")}</span>
          {busy === t.id && <Spinner className="mt-1" />}
        </button>))}</div>}
      {onSkip && <div className="mt-3 flex items-center gap-2 text-[12px] text-fg-muted">or <Button size="xs" variant="outline" onClick={onSkip}>Start empty</Button></div>}
    </div>
  );
}
