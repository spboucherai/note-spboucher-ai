/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/graph/SuggestionList.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-17
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
 * Review flow for AI-suggested links. Each suggestion shows where it comes from (source page → target page), the model's
 * explanation, its confidence and the model name; nothing becomes a link until Accept is pressed, and every decision
 * can be undone from the toast. Suggestions under LOW_CONFIDENCE_THRESHOLD are collapsed under "Low confidence".
 */
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, Check, ChevronDown, RefreshCw, Sparkles, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useOnline } from "@/lib/client/hooks";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge, Empty, Skeleton, Spinner } from "@/components/ui/primitives";
import { cn, timeAgo } from "@/lib/utils";
import { LOW_CONFIDENCE_THRESHOLD, type Suggestion, type SuggestionStatus } from "@/lib/graph/types";

const GRAPH_KEYS = ["graph", "graph-suggestions", "graph-neighbors", "backlinks"] as const;
export const isLowConfidence = (s: { confidence: number | null }) => s.confidence == null || s.confidence < LOW_CONFIDENCE_THRESHOLD;
const pct = (v: number | null) => (v == null ? null : Math.round(v * 100));

/** Removes a suggestion from every cached list that may contain it (review lists, per-page connection data). */
function dropFromCache(old: any, id: string) {
  if (!old || typeof old !== "object") return old;
  let next = old;
  if (Array.isArray(old.items)) next = { ...next, items: old.items.filter((s: Suggestion) => s.id !== id), counts: old.counts ? { ...old.counts, suggested: Math.max(0, (old.counts.suggested ?? 0) - 1) } : old.counts };
  if (Array.isArray(old.suggestions)) next = { ...next, suggestions: old.suggestions.filter((s: Suggestion) => s.id !== id) };
  return next;
}

/** Accept / reject (optimistic, rolled back with an error toast on failure) with an Undo toast that puts the suggestion back in the queue. */
export function useDecide() {
  const qc = useQueryClient();
  const invalidate = () => { for (const k of GRAPH_KEYS) qc.invalidateQueries({ queryKey: [k] }); };
  const send = (id: string, status: SuggestionStatus) => api("/api/graph/suggestions", { method: "PATCH", json: { id, status } });

  const undo = async (id: string, was: "accepted" | "rejected") => {
    try {
      await send(id, "suggested");
      toast("Decision undone", { description: was === "accepted" ? "The link was removed and the suggestion is back in the review list." : "The suggestion is back in the review list." });
    } catch (e: any) {
      toast("Could not undo", { description: e?.message ?? "The decision is unchanged. Try again from the review list.", tone: "danger" });
    } finally { invalidate(); }
  };

  return useMutation({
    mutationFn: (v: { id: string; status: "accepted" | "rejected" }) => send(v.id, v.status),
    onMutate: async (v) => {
      await Promise.all([qc.cancelQueries({ queryKey: ["graph-suggestions"] }), qc.cancelQueries({ queryKey: ["graph-neighbors"] })]);
      const snapshot: [QueryKey, unknown][] = [...qc.getQueriesData({ queryKey: ["graph-suggestions"] }), ...qc.getQueriesData({ queryKey: ["graph-neighbors"] })];
      qc.setQueriesData({ queryKey: ["graph-suggestions"] }, (old) => dropFromCache(old, v.id));
      qc.setQueriesData({ queryKey: ["graph-neighbors"] }, (old) => dropFromCache(old, v.id));
      return { snapshot };
    },
    onError: (e: any, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      toast("Decision not saved", { description: e?.message ?? "The suggestion is still waiting for review.", tone: "danger" });
    },
    onSuccess: (_d, v) => {
      toast(v.status === "accepted" ? "Link accepted" : "Suggestion rejected", {
        description: v.status === "accepted" ? "It is now a link between the two pages." : "It will not be suggested again.",
        tone: v.status === "accepted" ? "success" : "neutral",
        action: { label: "Undo", run: () => undo(v.id, v.status) },
      });
    },
    onSettled: invalidate,
  });
}

export interface SuggestResponse { queued: boolean; result?: { candidates: number; suggested: number; declined: number; skipped?: string } }
/** What leaves the device when suggestions are generated — shown next to every button that starts a generation. */
export const SUGGEST_DISCLOSURE_PAGE = "Sends the beginning of this page and excerpts of up to 8 similar pages to your AI provider. Nothing is sent until you press the button.";
export const SUGGEST_DISCLOSURE_WORKSPACE = "Sends excerpts of your most recently edited pages (up to 150, each with its closest pages) to your AI provider, in the background.";

/** Explicit generation only: never called on mount or on page open. `pageId: null` = whole-workspace background pass. */
export function useSuggest(onDone?: (r: SuggestResponse, pageId: string | null) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string | null) => api<SuggestResponse>("/api/graph/suggestions", { method: "POST", json: { action: "suggest", pageId, inline: Boolean(pageId) }, timeoutMs: pageId ? 150_000 : undefined }),
    onSuccess: (d, pageId) => {
      if (d.queued) {
        toast("Workspace pass queued", { description: "Suggestions will appear in the review list as they are found. Nothing is linked until you accept.", tone: "ai" });
      } else {
        const x = d.result!;
        const none = x.skipped === "no candidates" ? "No similar unlinked page was found (or this page is not indexed yet)." : x.skipped;
        toast(x.suggested ? `${x.suggested} new suggestion${x.suggested > 1 ? "s" : ""} to review` : "No new suggestion", {
          description: none ?? `${x.candidates} candidate${x.candidates === 1 ? "" : "s"} checked, ${x.declined} declined by the model.`,
          tone: "ai",
        });
      }
      for (const k of GRAPH_KEYS) qc.invalidateQueries({ queryKey: [k] });
      onDone?.(d, pageId);
    },
    onError: (e: any) => toast("Suggestions were not generated", { description: e?.message ?? "Nothing was changed. Try again.", tone: "danger" }),
  });
}

/** The explicit "generate" button with its disclosure. For the whole workspace a confirmation spells out what is sent. */
export function SuggestButton({ pageId, onDone, className, compact }: { pageId: string | null; onDone?: (r: SuggestResponse, pageId: string | null) => void; className?: string; compact?: boolean }) {
  const suggest = useSuggest(onDone);
  const online = useOnline();
  const disclosure = pageId ? SUGGEST_DISCLOSURE_PAGE : SUGGEST_DISCLOSURE_WORKSPACE;
  const run = () => {
    if (!pageId && !confirm(`Scan the whole workspace for possible links?\n\n${SUGGEST_DISCLOSURE_WORKSPACE}\n\nSuggestions only appear in the review list; nothing is linked until you accept.`)) return;
    suggest.mutate(pageId);
  };
  return (
    <div className={className}>
      <Button variant="ai" size="sm" className="max-md:h-11 max-md:w-full max-md:text-[15px]" disabled={suggest.isPending || !online} onClick={run} aria-describedby={`suggest-note-${pageId ?? "ws"}`}>
        {suggest.isPending ? <Spinner className="size-3.5 border-t-white" /> : <Sparkles />}
        {suggest.isPending ? "Asking the AI…" : pageId ? "Suggest connections with AI" : "Suggest for the whole workspace"}
      </Button>
      <p id={`suggest-note-${pageId ?? "ws"}`} className={cn("mt-1.5 text-[12px] leading-5 text-fg-muted", compact && "text-[11.5px] leading-4")}>
        {online ? disclosure : "You are offline: suggestions need a connection to the AI provider."}
      </p>
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number | null }) {
  const v = pct(value);
  if (v == null) return <span className="text-[12px] text-fg-muted">Confidence not recorded</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted" role="img" aria-label={`Confidence ${v} percent`}>
      <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-bg-sunk"><span className={cn("block h-full rounded-full", v >= 70 ? "bg-success" : v >= LOW_CONFIDENCE_THRESHOLD * 100 ? "bg-ai" : "bg-warning")} style={{ width: `${v}%` }} /></span>
      <span aria-hidden className="tabular-nums">{v}% confidence</span>
    </span>
  );
}

/** Model, confidence and age of an AI edge — the provenance line, shown wherever an AI link or suggestion appears. */
export function Provenance({ model, confidence, at, className }: { model: string | null | undefined; confidence: number | null; at?: string | null; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <ConfidenceBar value={confidence} />
      <span className="min-w-0 text-[12px] text-fg-muted [overflow-wrap:anywhere]">Suggested by {model ? <span className="font-medium text-fg">{model}</span> : "an unrecorded model"}{at ? ` · ${timeAgo(at)}` : ""}</span>
    </div>
  );
}

function PageRef({ id, title, icon, role, onFocus }: { id: string; title: string; icon: string | null; role: "Source" | "Target"; onFocus?: (id: string) => void }) {
  const cls = "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left hover:bg-bg-sunk md:min-h-8";
  const inner = (
    <>
      <span className="w-12 shrink-0 text-[11px] font-medium uppercase tracking-wide text-fg-faint">{role}</span>
      <span aria-hidden className="w-5 shrink-0 text-center">{icon ?? "📄"}</span>
      <span className="min-w-0 flex-1 text-[14px] font-medium [overflow-wrap:anywhere] md:text-[13px]">{title || "Untitled"}</span>
    </>
  );
  return onFocus ? <button type="button" className={cls} onClick={() => onFocus(id)}>{inner}</button> : <Link href={`/p/${id}`} className={cls}>{inner}</Link>;
}

export function SuggestionItem({ s, onFocus, dense }: { s: Suggestion; onFocus?: (id: string) => void; dense?: boolean }) {
  const decide = useDecide();
  const busy = decide.isPending && decide.variables?.id === s.id;
  const low = isLowConfidence(s);
  return (
    <article aria-label={`Suggested link from ${s.fromTitle || "Untitled"} to ${s.toTitle || "Untitled"}`} className={cn("rounded-xl border bg-ai-soft/30 p-2.5", low ? "border-warning/40" : "border-ai/25", dense && "p-2")}>
      <div className="-mx-1">
        <PageRef id={s.fromId} title={s.fromTitle} icon={s.fromIcon} role="Source" onFocus={onFocus} />
        <div aria-hidden className="flex h-3 items-center pl-[4.25rem] text-fg-faint"><ArrowDown className="size-3.5" /></div>
        <PageRef id={s.toId} title={s.toTitle} icon={s.toIcon} role="Target" onFocus={onFocus} />
      </div>
      <p className="mt-2 text-[13px] leading-5 text-fg-muted">
        <span className="font-medium text-fg">Why: </span>
        {s.rationale?.trim() ? s.rationale : <span className="italic">the model gave no explanation.</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {low && <Badge tone="warning">Low confidence</Badge>}
        <Provenance model={s.model} confidence={s.confidence} at={s.createdAt} />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 md:flex md:justify-end">
        <Button size="xs" variant="outline" className="h-11 text-[14px] md:h-7 md:min-w-[72px] md:text-xs" disabled={busy} onClick={() => decide.mutate({ id: s.id, status: "rejected" })}><X /> Reject</Button>
        <Button size="xs" className="h-11 text-[14px] md:h-7 md:min-w-[72px] md:text-xs" disabled={busy} onClick={() => decide.mutate({ id: s.id, status: "accepted" })}>{busy ? <Spinner className="size-3" /> : <Check />} Accept</Button>
      </div>
    </article>
  );
}

export function SuggestionList({ items, loading, error, onRetry, onFocus, dense, emptyHint, emptyAction }: {
  items: Suggestion[]; loading?: boolean; error?: unknown; onRetry?: () => void; onFocus?: (id: string) => void; dense?: boolean; emptyHint?: string; emptyAction?: React.ReactNode;
}) {
  const [showLow, setShowLow] = useState(false);
  if (loading) return <div role="status" aria-label="Loading suggestions" className="space-y-2"><Skeleton className="h-36 rounded-xl" /><Skeleton className="h-36 rounded-xl" /></div>;
  if (error && !items.length) {
    return (
      <div role="alert">
        <Empty icon={<AlertTriangle />} title="Could not load the suggestions" hint={(error as any)?.message ?? "Check your connection and try again."} action={onRetry ? <Button size="sm" className="max-md:h-11 max-md:px-4" onClick={onRetry}><RefreshCw /> Retry</Button> : undefined} />
      </div>
    );
  }
  if (!items.length) {
    return <Empty icon={<Sparkles />} title="No suggestion to review" hint={emptyHint ?? "Suggestions are only generated when you ask for them. Candidates come from text similarity and are checked by a model; nothing becomes a link until you accept it."} action={emptyAction} />;
  }
  const confident = items.filter((s) => !isLowConfidence(s));
  const low = items.filter(isLowConfidence);
  const threshold = Math.round(LOW_CONFIDENCE_THRESHOLD * 100);
  return (
    <div className="space-y-2">
      {confident.map((s) => <SuggestionItem key={s.id} s={s} onFocus={onFocus} dense={dense} />)}
      {!confident.length && <p className="rounded-lg bg-bg-sunk px-3 py-2 text-[13px] leading-5 text-fg-muted">No suggestion reaches {threshold}% confidence. The uncertain ones are below.</p>}
      {low.length > 0 && (
        <section>
          <button type="button" aria-expanded={showLow} aria-controls="low-confidence-suggestions" onClick={() => setShowLow((v) => !v)} className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-line px-3 text-left text-[14px] hover:bg-bg-sunk md:min-h-9 md:text-[13px]">
            <ChevronDown className={cn("size-4 shrink-0 text-fg-muted transition-transform", !showLow && "-rotate-90")} />
            <span className="font-medium">Low confidence</span>
            <span className="tabular-nums text-fg-muted">{low.length}</span>
            <span className="ml-auto text-[12px] text-fg-muted">below {threshold}%</span>
          </button>
          {showLow && (
            <div id="low-confidence-suggestions" className="mt-2 space-y-2">
              <p className="text-[12px] leading-5 text-fg-muted">The model was not sure about these. Read the explanation before accepting.</p>
              {low.map((s) => <SuggestionItem key={s.id} s={s} onFocus={onFocus} dense={dense} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
