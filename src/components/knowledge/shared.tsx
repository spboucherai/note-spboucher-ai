/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/knowledge/shared.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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
/**
 * file: src/components/knowledge/shared.tsx
 * description: small building blocks shared by the knowledge screens (graph 2.0, constellation, timeline, time machine, health,
 *   brief, semantic zoom, ask): the AI mark, a screen header, a segmented control, a page picker over the workspace tree, date
 *   formatters. Everything sits on the Lumen tokens.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Search, Check } from "lucide-react";
import { api } from "@/lib/client/api";
import { fuzzyRank } from "@/lib/client/commands";
import { cn } from "@/lib/utils";
import { Dialog, SheetContent } from "@/components/ui/primitives";
import type { TreeNode } from "@/components/shell/types";

export const fmtDateTime = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "");
export const fmtDay = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(new Date(iso)) : "");
export const fmtTime = (iso: string) => new Intl.DateTimeFormat("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
export const pageGlyph = (p: { icon?: string | null; type?: string }) => p.icon ?? (p.type === "database" ? "🗂" : p.type === "research" ? "🔬" : p.type === "canvas" ? "🧭" : "📄");

/** The mark every model output carries (SPEC §0.10): violet, labelled "AI", with the model and date when known. */
export function AIBadge({ model, at, label = "AI", className }: { model?: string | null; at?: string | null; label?: string; className?: string }) {
  return <span className={cn("ai-mark", className)} data-ai-mark title={[model, at ? fmtDateTime(at) : null].filter(Boolean).join(" · ") || "Produced by an AI model"}><Sparkles className="size-3" aria-hidden />{label}{model ? <span className="font-normal normal-case tracking-normal opacity-90"> · {model}</span> : null}</span>;
}
export function ScreenHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2 font-serif text-[1.625rem] font-semibold leading-tight tracking-[-0.018em] sm:text-h1">{icon && <span className="grid size-8 shrink-0 place-items-center rounded-pop bg-accent-soft text-accent [&_svg]:size-4">{icon}</span>}<span className="min-w-0 [overflow-wrap:anywhere]">{title}</span></h1>
        {subtitle && <p className="mt-1 max-w-[46rem] text-ui leading-5 text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}
/** Single-choice control (role=radiogroup, arrow keys). Scrolls inside itself on narrow screens — it never widens the page. */
export function Segmented<T extends string | number>({ value, onChange, options, label, className, size = "md" }: { value: T; onChange: (v: T) => void; options: { id: T; label: React.ReactNode; title?: string; disabled?: boolean; testId?: string }[]; label: string; className?: string; size?: "sm" | "md" }) {
  const move = (dir: 1 | -1) => { const ok = options.filter((o) => !o.disabled); const i = ok.findIndex((o) => o.id === value); const n = ok[(i + dir + ok.length) % ok.length]; if (n) onChange(n.id); };
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex max-w-full items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-pop border border-line bg-bg-sunk p-0.5 [scrollbar-width:none]", className)}
      onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); } }}>
      {options.map((o) => <button key={String(o.id)} type="button" role="radio" aria-checked={o.id === value} tabIndex={o.id === value ? 0 : -1} disabled={o.disabled} title={o.title} data-testid={o.testId} onClick={() => onChange(o.id)}
        className={cn("shrink-0 whitespace-nowrap rounded-control px-2.5 font-medium text-fg-muted transition-colors duration-fast hover:text-fg disabled:opacity-45 max-md:h-11 max-md:px-3.5 max-md:text-[14px]", size === "sm" ? "h-7 text-micro" : "h-8 text-ui", o.id === value && "bg-bg-elev text-fg shadow-card")}>{o.label}</button>)}
    </div>
  );
}
export const useTree = () => useQuery({ queryKey: ["tree"], queryFn: () => api<TreeNode[]>("/api/tree"), staleTime: 10_000 });

/** Pick a page of the workspace (fuzzy search over the tree already in memory — no request per keystroke). */
export function PagePicker({ open, onOpenChange, onPick, title = "Choose a page", description, filter, exclude, current }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (p: TreeNode) => void; title?: string; description?: string; filter?: (n: TreeNode) => boolean; exclude?: string[]; current?: string | null }) {
  const { data: tree = [] } = useTree(); const [q, setQ] = React.useState("");
  React.useEffect(() => { if (open) setQ(""); }, [open]);
  const rows = React.useMemo(() => { const pool = tree.filter((n) => !exclude?.includes(n.id) && (!filter || filter(n))); return fuzzyRank(q, pool, (n) => ({ title: n.title || "Untitled", keywords: n.section }), undefined, 60).map((r) => r.item); }, [tree, q, filter, exclude]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent title={title} description={description} onOpenAutoFocus={(e) => { e.preventDefault(); if (window.matchMedia("(pointer: fine)").matches) (e.currentTarget as HTMLElement).querySelector("input")?.focus(); }}>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" /><input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search pages" placeholder="Search pages…" className="h-11 w-full rounded-control border border-line bg-bg pl-9 pr-3 text-[16px] outline-none focus:border-accent/60 sm:h-9 sm:text-ui" onKeyDown={(e) => { if (e.key === "Enter" && rows[0]) { e.preventDefault(); onPick(rows[0]); onOpenChange(false); } }} /></div>
        <ul role="listbox" aria-label="Pages" className="mt-2 max-h-[50dvh] overflow-y-auto overscroll-contain">
          {rows.length ? rows.map((n) => <li key={n.id} role="option" aria-selected={n.id === current}><button type="button" onClick={() => { onPick(n); onOpenChange(false); }} className={cn("flex min-h-11 w-full items-center gap-2 rounded-control px-2 text-left text-[15px] hover:bg-bg-hover sm:min-h-9 sm:text-ui", n.id === current && "bg-accent-soft")}><span className="w-5 shrink-0 text-center">{pageGlyph(n)}</span><span className="min-w-0 flex-1 truncate">{n.title || "Untitled"}</span><span className="shrink-0 text-micro text-fg-muted">{n.section}</span>{n.id === current && <Check className="size-4 shrink-0 text-accent" />}</button></li>) : <li className="px-2 py-6 text-center text-ui text-fg-muted">No page matches.</li>}
        </ul>
      </SheetContent>
    </Dialog>
  );
}
/** Inline state blocks used by every screen: loading rows and a retry-able error. */
export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return <div role="alert" className="rounded-card border border-danger/30 bg-danger/5 p-3 text-ui"><p className="text-danger-text">Could not load {what}: {(error as Error)?.message ?? "unknown error"}</p><button type="button" onClick={onRetry} className="mt-2 h-11 rounded-control border border-line bg-bg-elev px-3 font-medium sm:h-8">Retry</button></div>;
}
