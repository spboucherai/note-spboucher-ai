"use client";
/**
 * file: src/components/inbox/InboxSuggestions.tsx
 * description: Smart Inbox (SPEC §4.12) — AI suggestions for one capture, asked for explicitly (this component is only mounted after
 *   the owner pressed "Suggest", and that is the only moment `GET /api/inbox/<id>/suggestions` is called). They are shown as a
 *   checklist, always marked as AI (violet tokens, model named): title, tags, destination, related pages, summary. Nothing is ticked at
 *   the start; "Apply" sends only the ticked subset (`POST /api/inbox/<id>/apply`) and answers with Undo. Loading, error and empty
 *   states; usable on a phone (44 px rows, no sideways scroll).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw, X, FolderInput, Tag, Link2, Type, AlignLeft, TriangleAlert } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";
import { buildApplyBody, countChosen, countOffered, destinationLabel, emptyChoice, hasSuggestions, selectAll, suggestionError, type ApplyResult, type Choice, type SuggestionResult } from "@/lib/client/inbox-suggest";

/** One suggestion: a real checkbox (keyboard, screen reader), its kind in violet, then the suggested value — editable for the title and the summary. */
function Row({ id, checked, onChange, icon, label, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <li className="flex min-h-11 items-start gap-2.5 py-1.5">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="mt-1 size-5 shrink-0 accent-[var(--ai)]" />
      <div className="min-w-0 flex-1 text-[14px] leading-5"><label htmlFor={id} className="mb-0.5 flex cursor-pointer items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ai [&_svg]:size-3.5">{icon}{label.split(":")[0]}</label>{children}</div>
    </li>
  );
}

type State = { phase: "loading" } | { phase: "error"; error: ReturnType<typeof suggestionError> } | { phase: "ready"; result: SuggestionResult };

export function InboxSuggestions({ pageId, title, onClose, onApplied }: { pageId: string; title: string; onClose: () => void; /** the chosen subset was applied: the parent refreshes the list and offers Undo */ onApplied: (r: ApplyResult) => void }) {
  const [state, setState] = useState<State>({ phase: "loading" }); const [choice, setChoice] = useState<Choice | null>(null); const [applying, setApplying] = useState(false); const [applyError, setApplyError] = useState<ReturnType<typeof suggestionError> | null>(null);
  const alive = useRef(true); const ctrl = useRef<AbortController | null>(null);
  const load = useCallback(async (refresh = false) => {
    ctrl.current?.abort(); const c = new AbortController(); ctrl.current = c; setState({ phase: "loading" }); setApplyError(null);
    try {
      const result = await api<SuggestionResult>(`/api/inbox/${pageId}/suggestions${refresh ? "?refresh=1" : ""}`, { signal: c.signal });
      if (!alive.current || c.signal.aborted) return; setChoice(emptyChoice(result.suggestions)); setState({ phase: "ready", result });
    } catch (e) { if (!alive.current || c.signal.aborted) return; setState({ phase: "error", error: suggestionError(e as ApiError) }); }
  }, [pageId]);
  // Mounted = the owner asked. React runs effects twice in development: the abort above keeps a single answer.
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; ctrl.current?.abort(); }; }, [load]);

  const s = state.phase === "ready" ? state.result.suggestions : null; const chosen = s && choice ? countChosen(s, choice) : 0;
  async function apply() {
    if (!s || !choice || applying) return; const body = buildApplyBody(s, choice); if (!body) return;
    setApplying(true); setApplyError(null);
    try { const r = await api<ApplyResult>(`/api/inbox/${pageId}/apply`, { method: "POST", json: body }); if (alive.current) onApplied(r); }
    catch (e) { if (alive.current) setApplyError(suggestionError(e as ApiError)); }
    finally { if (alive.current) setApplying(false); }
  }
  return (
    <section aria-label={`AI suggestions for ${title}`} data-testid="inbox-suggestions" className="ai-surface mx-3 mb-3 rounded-xl p-3">
      <header className="flex items-center gap-2">
        <span className="ai-mark"><Sparkles aria-hidden className="size-3" />AI suggestions</span>
        {state.phase === "ready" && state.result.model && <span className="min-w-0 truncate text-[12px] text-fg-muted">{state.result.model}{state.result.cached ? " · cached" : ""}</span>}
        <span className="ml-auto flex shrink-0 items-center">
          {state.phase === "ready" && state.result.ai && <button type="button" aria-label="Regenerate suggestions" title="Regenerate suggestions" onClick={() => void load(true)} className="grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-ai-soft hover:text-ai"><RefreshCw className="size-4" /></button>}
          <button type="button" aria-label="Close suggestions" title="Close suggestions" onClick={onClose} className="grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-ai-soft hover:text-ai"><X className="size-4" /></button>
        </span>
      </header>
      {state.phase === "loading" && <div role="status" className="flex min-h-16 items-center gap-2.5 py-3 text-[13.5px] text-fg-muted"><Spinner className="border-ai/25 border-t-ai" /><span>Reading the capture and your workspace…</span><button type="button" onClick={() => { ctrl.current?.abort(); onClose(); }} className="ml-auto h-9 px-2 text-[13px] font-medium text-fg-muted">Cancel</button></div>}
      {state.phase === "error" && <div role="alert" className="flex items-start gap-2.5 py-2 text-[13.5px] leading-5"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /><div className="min-w-0 flex-1"><div className="font-medium">{state.error.title}</div><div className="break-words text-fg-muted [overflow-wrap:anywhere]">{state.error.hint}</div>{state.error.retry && <Button size="sm" variant="outline" className="mt-2 h-9" onClick={() => void load()}>Try again</Button>}</div></div>}
      {state.phase === "ready" && s && choice && (!hasSuggestions(s)
        ? <p role="status" className="py-3 text-[13.5px] leading-5 text-fg-muted">{state.result.status === "empty" ? "This capture has no title and no text: there is nothing to analyse." : "Nothing to suggest: the title is already good and no tag, destination or related page stood out."}</p>
        : <>
          <p className="mt-1.5 text-[12.5px] leading-5 text-fg-muted">Tick what you want to keep. Nothing is changed until you apply, and you can undo it.</p>
          <ul className="mt-1 divide-y divide-ai/15">
            {s.title && <Row id={`sg-title-${pageId}`} checked={choice.title} onChange={(v) => setChoice({ ...choice, title: v })} icon={<Type />} label="Title: rename the capture">
              <input value={choice.titleValue} onChange={(e) => setChoice({ ...choice, titleValue: e.target.value, title: true })} aria-label="Suggested title" maxLength={300} className="block h-10 w-full min-w-0 rounded-lg border border-ai/25 bg-bg px-2.5 text-[15px] outline-none focus:border-ai/60" />
              <span className="mt-0.5 block truncate text-[12px] text-fg-muted">Now: {s.title.current || "Untitled"}</span></Row>}
            {s.tags.map((t) => <Row key={t.name} id={`sg-tag-${pageId}-${t.name}`} checked={Boolean(choice.tags[t.name])} onChange={(v) => setChoice({ ...choice, tags: { ...choice.tags, [t.name]: v } })} icon={<Tag />} label={`Tag: ${t.name}`}><span className="break-words [overflow-wrap:anywhere]">#{t.name}</span> <span className="text-[12px] text-fg-muted">{t.existing ? "existing tag" : "new tag"}</span></Row>)}
            {s.destination && <Row id={`sg-dest-${pageId}`} checked={choice.destination} onChange={(v) => setChoice({ ...choice, destination: v })} icon={<FolderInput />} label={`File in: ${destinationLabel(s.destination)}`}><span className="break-words [overflow-wrap:anywhere]">{destinationLabel(s.destination)}</span><span className="block text-[12px] text-fg-muted">Leaves the inbox only if you tick this.</span></Row>}
            {s.relations.map((r) => <Row key={r.pageId} id={`sg-rel-${pageId}-${r.pageId}`} checked={Boolean(choice.relations[r.pageId])} onChange={(v) => setChoice({ ...choice, relations: { ...choice.relations, [r.pageId]: v } })} icon={<Link2 />} label={`Related: ${r.title || "Untitled"}`}><span className="break-words [overflow-wrap:anywhere]">{r.icon ? `${r.icon} ` : ""}{r.title || "Untitled"}</span>{r.reason && <span className="block break-words text-[12.5px] text-fg-muted [overflow-wrap:anywhere]">{r.reason}</span>}</Row>)}
            {s.summary && <Row id={`sg-sum-${pageId}`} checked={choice.summary} onChange={(v) => setChoice({ ...choice, summary: v })} icon={<AlignLeft />} label="Summary: add it at the top, marked as AI">
              <textarea value={choice.summaryValue} onChange={(e) => setChoice({ ...choice, summaryValue: e.target.value, summary: true })} aria-label="Suggested summary" rows={3} maxLength={1000} className="block w-full min-w-0 resize-none rounded-lg border border-ai/25 bg-bg p-2.5 text-[14px] leading-5 outline-none [field-sizing:content] focus:border-ai/60" /></Row>}
          </ul>
          {applyError && <div role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[13px] leading-5"><span className="font-medium">{applyError.title}.</span> {applyError.hint}</div>}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button variant="ai" className="h-11 sm:h-9" disabled={!chosen || applying} onClick={() => void apply()}>{applying ? <Spinner className="border-white/40 border-t-white" /> : <Sparkles />}Apply{chosen ? ` ${chosen} selected` : ""}</Button>
            <Button variant="ghost" className="h-11 sm:h-9" disabled={applying} onClick={() => setChoice(selectAll(s, choice, chosen < countOffered(s)))}>{chosen < countOffered(s) ? "Select all" : "Clear"}</Button>
          </div>
        </>)}
    </section>
  );
}
