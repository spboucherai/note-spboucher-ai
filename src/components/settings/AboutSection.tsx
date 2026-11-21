/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/settings/AboutSection.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-09
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
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { Badge } from "@/components/ui/primitives";
const DOCS = [["docs/architecture.md", "Architecture overview"], ["docs/dev-conventions.md", "Developer conventions"], ["docs/ai-routing-strategy.md", "AI routing strategy (measured)"], ["docs/ai-provider-discovery.md", "Provider discovery"], ["docs/ai-model-comparison.md", "Model comparison"], ["docs/openai-model-benchmarks.md", "OpenAI benchmarks"], ["docs/anthropic-model-benchmarks.md", "Anthropic benchmarks"]];
export function AboutSection({ version }: { version: string }) {
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: () => api("/api/health"), retry: 0, staleTime: 30_000 });
  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-xl border border-line bg-bg-elev p-4">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-fg text-base font-semibold text-bg">N</span><div><div className="text-[15px] font-semibold">Note SPBoucher AI</div><div className="text-[12px] text-fg-muted">Private AI-native knowledge operating system · v{version}</div></div><Badge tone={health ? "success" : "neutral"} className="ml-auto">{health ? "healthy" : "…"}</Badge></div>
        <dl className="mt-4 grid grid-cols-[120px_1fr] gap-y-1 text-[13px]"><dt className="text-fg-muted">Stack</dt><dd>Next.js 16 · React 19 · PostgreSQL 17 + pgvector · pg-boss</dd><dt className="text-fg-muted">AI</dt><dd>OpenAI + Anthropic, measured routing per task class</dd><dt className="text-fg-muted">Auth</dt><dd>Shared-password gate or bookmark unlock → 400-day device cookie (no accounts)</dd><dt className="text-fg-muted">Shortcuts</dt><dd>⌘K search · ⌘/ AI · ⌘⇧N new page · ⌘\ sidebar · ⌘. focus</dd></dl>
      </section>
      <section><h2 className="mb-2 text-[15px] font-semibold">Documentation</h2><ul className="divide-y divide-line rounded-xl border border-line bg-bg-elev">{DOCS.map(([path, label]) => <li key={path} className="flex items-center gap-3 px-3 py-2 text-[13px]"><span className="flex-1">{label}</span><code className="font-mono text-[11px] text-fg-faint">{path}</code></li>)}</ul><p className="mt-2 text-[12px] text-fg-faint">Docs live in the repository next to the code.</p></section>
    </div>
  );
}
