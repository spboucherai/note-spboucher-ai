/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/ai/ModelPicker.tsx
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
 * Model selector (SPEC §4.11) — replaces a bare <select> wherever the owner chooses a model.
 * Each row shows the creator's logo, the model name, the API route it is called through (a badge distinct from the creator: a Claude
 * model reached through OpenRouter shows the Anthropic mark and an "OpenRouter" badge), its capabilities, context window, price and
 * availability. Models are grouped by creator, searchable, and fully keyboard navigable (type to filter, ↑ ↓ Home End, Enter, Esc).
 * "Auto (measured routing)" stays the first choice; models that never went through the benchmark are marked "manual only" — choosing
 * one is allowed, automatic routing never picks them. Unavailable models (provider without key…) are hidden behind a toggle and cannot
 * be selected. Logos are single-colour SVGs used as CSS masks, so they follow the text colour in both themes.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search, Sparkles } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { GENERIC_LOGO } from "@/lib/ai/creators";
import { capabilityChips, formatContext, formatPrice, groupModels, modelName, moveActive, selectableIds, REASON_LABEL, type PickerModel } from "@/lib/ai/picker";

export function CreatorLogo({ logo, monogram, name, className }: { logo: string; monogram: string; name: string; className?: string }) {
  if (!logo || logo === GENERIC_LOGO) return <span aria-hidden title={name} className={cn("grid size-5 shrink-0 place-items-center rounded-[5px] border border-line bg-bg-sunk font-mono text-[9px] font-semibold leading-none text-fg-muted", className)}>{monogram}</span>;
  return <span aria-hidden title={name} className={cn("inline-block size-5 shrink-0 bg-current", className)} style={{ maskImage: `url(${logo})`, WebkitMaskImage: `url(${logo})`, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }} />;
}

interface Props { value: string | null; onChange: (id: string | null) => void; className?: string; autoLabel?: string; allowAuto?: boolean; "aria-label"?: string; compact?: boolean }
export function ModelPicker({ value, onChange, className, autoLabel = "Auto (measured routing)", allowAuto = true, compact, ...rest }: Props) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [showAll, setShowAll] = useState(false); const [active, setActive] = useState(0);
  const { data, isLoading } = useQuery<{ models: PickerModel[]; hiddenUnavailable?: number }>({ queryKey: ["ai-models"], queryFn: () => api("/api/ai/models"), staleTime: 60_000 });
  // models of providers without key (hundreds for OpenRouter) are fetched only when the owner asks to see them
  const full = useQuery<{ models: PickerModel[] }>({ queryKey: ["ai-models", "unavailable"], queryFn: () => api("/api/ai/models?unavailable=1"), staleTime: 60_000, enabled: showAll });
  const listId = useId(); const listRef = useRef<HTMLDivElement>(null); const inputRef = useRef<HTMLInputElement>(null);
  const models = (showAll && full.data?.models) || data?.models || [];
  const groups = useMemo(() => groupModels(models, query, { showUnavailable: showAll }), [models, query, showAll]);
  const ids = useMemo(() => selectableIds(groups, query).filter((id) => allowAuto || id !== null), [groups, query, allowAuto]);
  const hidden = showAll ? models.filter((m) => !m.available && m.category !== "embedding").length : (data?.hiddenUnavailable ?? 0) + (data?.models ?? []).filter((m) => !m.available && m.category !== "embedding").length;
  const current = value ? models.find((m) => m.id === value) ?? null : null;
  useEffect(() => { if (open) { setQuery(""); setActive(Math.max(0, ids.indexOf(value))); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  useEffect(() => { setActive((a) => Math.min(Math.max(a, 0), Math.max(ids.length - 1, 0))); }, [ids.length]);
  useEffect(() => { if (open) listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);
  const choose = (id: string | null) => { onChange(id); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(e.key)) { if ((e.key === "Home" || e.key === "End") && query) return; e.preventDefault(); setActive((a) => moveActive(a, e.key, ids.length)); }
    else if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && active < ids.length) choose(ids[active]); }
  };
  const optId = (i: number) => `${listId}-opt-${i}`;
  const label = current ? modelName(current) : value ? value : autoLabel;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={rest["aria-label"] ?? "Model"} title={current ? `${current.creatorName} · ${modelName(current)} · via ${current.routeLabel}` : label}
          className={cn("flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[16px] font-medium text-fg outline-none hover:bg-bg-sunk focus-visible:ring-2 focus-visible:ring-accent/40 md:h-8 md:text-[12.5px]", className)}>
          {current ? <CreatorLogo logo={current.logo} monogram={current.monogram} name={current.creatorName} className="size-4" /> : <Sparkles aria-hidden className="size-3.5 shrink-0 text-ai" />}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {current && !compact && <span className="hidden shrink-0 rounded border border-line px-1 text-[10px] font-normal text-fg-muted sm:inline">{current.routeLabel}</span>}
          <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(94vw,30rem)] p-0" onKeyDown={onKey}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search aria-hidden className="size-4 shrink-0 text-fg-faint" />
          <input ref={inputRef} autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} placeholder="Search a model, a creator, a provider…" role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? optId(active) : undefined}
            className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-faint md:h-10 md:text-[13px]" />
        </div>
        {/* never taller than the room Radix measured on the side it opened (keeps the search field on screen when it opens upwards) */}
        <div ref={listRef} id={listId} role="listbox" aria-label="Models" className="overflow-y-auto overscroll-contain py-1" style={{ maxHeight: "min(26rem, 60vh, calc(var(--radix-popover-content-available-height, 100vh) - 6.5rem))" }}>
          {ids[0] === null && (
            <div id={optId(0)} data-idx={0} role="option" aria-selected={value === null} onMouseMove={() => setActive(0)} onClick={() => choose(null)}
              className={cn("mx-1 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2", active === 0 && "bg-bg-hover")}>
              <Sparkles aria-hidden className="size-5 shrink-0 text-ai" />
              <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{autoLabel}</div><div className="truncate text-[11.5px] text-fg-muted">The measured routing table picks the model for each request.</div></div>
              {value === null && <Check aria-hidden className="size-4 shrink-0 text-accent" />}
            </div>
          )}
          {isLoading && <div className="px-3 py-6 text-center text-[12.5px] text-fg-muted" role="status">Loading the catalogue…</div>}
          {!isLoading && !groups.length && <div className="px-3 py-6 text-center text-[12.5px] text-fg-muted" role="status">No model matches “{query}”.</div>}
          {groups.map((g) => (
            <div key={g.creator} role="group" aria-label={g.creatorName} className="mt-1">
              <div className="sticky top-0 z-[1] flex items-center gap-2 bg-bg-elev/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted backdrop-blur"><CreatorLogo logo={g.logo} monogram={g.monogram} name={g.creatorName} className="size-3.5 text-[7px]" />{g.creatorName}<span className="font-normal normal-case tracking-normal text-fg-faint">{g.models.length}</span></div>
              {g.models.map((m) => {
                const i = m.available ? ids.indexOf(m.id) : -1; const price = formatPrice(m.priceIn, m.priceOut); const ctx = formatContext(m.context); const chips = capabilityChips(m);
                return (
                  <div key={m.id} id={i >= 0 ? optId(i) : undefined} data-idx={i >= 0 ? i : undefined} role="option" aria-selected={value === m.id} aria-disabled={!m.available}
                    onMouseMove={() => i >= 0 && setActive(i)} onClick={() => m.available && choose(m.id)}
                    className={cn("mx-1 flex items-center gap-2.5 rounded-md px-2 py-1.5", m.available ? "cursor-pointer" : "cursor-not-allowed opacity-50", i >= 0 && active === i && "bg-bg-hover")}>
                    <CreatorLogo logo={m.logo} monogram={m.monogram} name={m.creatorName} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">{modelName(m)}</span>
                        <span className="shrink-0 rounded border border-line px-1 text-[10px] leading-4 text-fg-muted" title={`API route: ${m.routeLabel}`}>{m.routeLabel}</span>
                        {!m.autoRoutable && m.available && <span className="shrink-0 rounded bg-bg-sunk px-1 text-[10px] leading-4 text-fg-muted" title="Not benchmarked: usable when chosen by hand, never picked by automatic routing">manual only</span>}
                        {!m.available && <span className="shrink-0 rounded bg-bg-sunk px-1 text-[10px] leading-4 text-fg-muted">{REASON_LABEL[m.unavailableReason ?? ""] ?? "unavailable"}</span>}
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-[11.5px] text-fg-muted">
                        {ctx && <span title="Context window (tokens)">{ctx} ctx</span>}
                        {price && <span title="Input / output price, USD per 1M tokens">{price}</span>}
                        {chips.map((c) => <span key={c}>{c}</span>)}
                        {!ctx && !price && !chips.length && <span className="text-fg-faint">no published details</span>}
                      </div>
                    </div>
                    {value === m.id && <Check aria-hidden className="size-4 shrink-0 text-accent" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {hidden > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[11.5px] text-fg-muted">
            <span>{showAll ? (full.isLoading ? "Loading unavailable models…" : `${hidden} unavailable shown (greyed)`) : `${hidden} unavailable hidden`}</span>
            <button type="button" onClick={() => { setShowAll((s) => !s); inputRef.current?.focus(); }} className="rounded px-1.5 py-1 font-medium text-accent hover:bg-bg-sunk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{showAll ? "Hide" : "Show"}</button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
