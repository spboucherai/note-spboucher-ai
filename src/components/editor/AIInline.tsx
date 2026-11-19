"use client";
/**
 * AI actions on the editor selection. Contract:
 *  - the result is always previewed (streamed) first; the document only changes when the owner presses Replace / Insert below;
 *  - applying is ONE editor transaction, so ⌘Z or the Undo button restores the original text exactly;
 *  - the original selection is never lost: its text stays visible in the preview, its range is stored and put back on Discard, and
 *    Replace refuses to run if the document changed underneath (the range would no longer point at the same text);
 *  - the selected text goes to the routed provider only when an action is started; provider · model · cost are shown with the result.
 *  - 3.0: analysis actions (coherence, open questions, synthesis, structure) comment on the text — their result can only be inserted
 *    below, as an `aiBlock` carrying `action` and `sources` (the blocks it is about); "Suggest links" returns data, shown one
 *    suggestion at a time: each link is added only when the owner accepts it. Everything the model produced is marked AI (violet).
 * Bottom sheet on phones (large chips), dialog from `sm` up. The editor is never blurred programmatically.
 */
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, Check, Copy, Languages, Link2, List, ListTodo, ListTree, MessageCircleQuestion, RefreshCw, Replace, RotateCcw, ScanSearch, SkipForward, SpellCheck, Sparkles, Table2, Trash2, Wand2, WifiOff, AlignLeft, Expand, HelpCircle, Combine } from "lucide-react";
import { api, sse } from "@/lib/client/api";
import { useIsTouch, useOnline } from "@/lib/client/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent } from "@/components/ui/primitives";
import { Markdown } from "@/components/markdown";
import { markdownToDoc } from "@/lib/editor/markdown-client";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ActionPlan } from "@/lib/ai/chat";
import { ANALYSIS_ACTIONS, aiBlockAttrs, findAnchor, isAnalysisAction, linkHref, parseLinksResult, sourcesOfRange, type DocLike, type LinkSuggestion } from "@/lib/editor/ai-context";

export interface AIInlineState { mode: string; selection: string; replaceRange: { from: number; to: number } | null; insertAt: number; pageId?: string | null }
const ACTIONS: { id: string; label: string; icon: typeof Sparkles }[] = [
  { id: "rewrite", label: "Rewrite", icon: Wand2 }, { id: "fix", label: "Fix spelling & grammar", icon: SpellCheck }, { id: "summarize", label: "Summarise", icon: AlignLeft }, { id: "expand", label: "Expand", icon: Expand },
  { id: "explain", label: "Explain", icon: HelpCircle }, { id: "to_list", label: "To list", icon: List }, { id: "to_tasks", label: "To tasks", icon: ListTodo }, { id: "table", label: "To table", icon: Table2 },
];
const ANALYSIS_ICON: Record<string, typeof Sparkles> = { coherence: ScanSearch, questions: MessageCircleQuestion, synthesis: Combine, structure: ListTree, links: Link2 };
const LANGS: [string, string][] = [["fr", "Français"], ["en", "English"], ["es", "Español"], ["de", "Deutsch"], ["it", "Italiano"], ["pt", "Português"]];
const LABELS: Record<string, string> = { ...Object.fromEntries(ACTIONS.map((a) => [a.id, a.label])), ...Object.fromEntries(ANALYSIS_ACTIONS.map((a) => [a.id, a.label])), translate: "Translate", custom: "Custom instruction", continue: "Continue writing", translate_fr: "Translate → Français", translate_en: "Translate → English" };
const AUTO = new Set([...ACTIONS.map((a) => a.id), ...ANALYSIS_ACTIONS.map((a) => a.id), "continue", "shorten", "formal", "simplify", "translate_fr", "translate_en", "explain_math", "action_items"]);
interface RunOpts { language?: string; instruction?: string; confirmExpensive?: boolean }
interface Meta { model?: string; provider?: string; costUsd?: number | null; latencyMs?: number; budgetNote?: string | null }
const usd = (v: number | null | undefined) => (v == null ? "cost unknown" : v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);

export function AIInline({ state, editor, onClose }: { state: AIInlineState; editor: Editor; onClose: () => void }) {
  const isTouch = useIsTouch(); const online = useOnline();
  const range = state.replaceRange; const generate = state.mode === "write"; const source = generate ? "" : state.selection;
  const [instruction, setInstruction] = useState(""); const [lang, setLang] = useState("fr");
  const [out, setOut] = useState(""); const [busy, setBusy] = useState(false); const [meta, setMeta] = useState<Meta | null>(null); const [done, setDone] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string; retryable: boolean } | null>(null); const [confirm, setConfirm] = useState<{ act: string; opts: RunOpts; reason: string } | null>(null);
  const [last, setLast] = useState<{ act: string; opts: RunOpts } | null>(null); const [stale, setStale] = useState(false);
  // "Suggest links": the suggestions (data, never written by the server), the one being reviewed and what the owner decided for each
  const [links, setLinks] = useState<{ items: LinkSuggestion[]; candidates: number } | null>(null); const [linkAt, setLinkAt] = useState(0); const [decided, setDecided] = useState<{ pageId: string; title: string; accepted: boolean; how?: string }[]>([]);
  const abort = useRef<AbortController | null>(null); const inputRef = useRef<HTMLInputElement>(null); const applied = useRef(false);
  // Dry run (our server only): which provider/model each action would use. No selected text leaves the browser here — only its length.
  const plans = useQuery<Record<string, ActionPlan>>({ queryKey: ["ai-plan-actions", source.length], queryFn: () => api(`/api/ai/chat/plan?actions=1&chars=${source.length}`), staleTime: 30_000, enabled: online, retry: 1 });
  const anyPlan = plans.data ? Object.values(plans.data)[0] : undefined; const notConfigured = anyPlan ? !anyPlan.configured.any : false;
  const targets = plans.data ? [...new Set(Object.values(plans.data).filter((p) => p.provider).map((p) => `${p.provider} · ${p.model}`))] : [];

  async function run(act: string, opts: RunOpts = {}) {
    if (!online || notConfigured) return;
    abort.current?.abort(); const ac = new AbortController(); abort.current = ac;
    setBusy(true); setOut(""); setMeta(null); setDone(false); setError(null); setConfirm(null); setLast({ act, opts }); setLinks(null); setLinkAt(0); setDecided([]);
    let finished = false;
    await sse("/api/ai/action", { action: act, text: source || "(empty — generate new content from the instruction)", instruction: opts.instruction, language: opts.language, confirmExpensive: opts.confirmExpensive ?? false, ...(state.pageId ? { pageId: state.pageId } : {}) }, (ev) => {
      if (ev.type === "text") setOut((s) => s + ev.delta);
      else if (ev.type === "result" && act === "links") { const r = parseLinksResult(ev.data); setLinks({ items: r.links, candidates: r.candidates }); }
      else if (ev.type === "meta") setMeta({ model: ev.model, provider: ev.provider, budgetNote: ev.budgetNote });
      else if (ev.type === "done") { finished = true; setDone(true); setMeta((m) => ({ ...m, costUsd: ev.costUsd, latencyMs: ev.latencyMs })); }
      else if (ev.type === "error") { finished = true; if (ev.code === "confirm_expensive") setConfirm({ act, opts, reason: ev.message }); else setError({ message: ev.message ?? "The request failed", code: ev.code, retryable: ev.retryable ?? !["not_configured", "no_model", "bad_language", "no_instruction"].includes(ev.code) }); }
    }, ac.signal).catch(() => {});
    if (ac.signal.aborted) return; // superseded or closed
    if (!finished) setError({ message: "The answer stopped before it was complete.", retryable: true });
    setBusy(false);
  }
  // An action chosen from the slash menu / toolbar starts immediately (that choice is the explicit "send"); otherwise wait for a tap.
  useEffect(() => { if (AUTO.has(state.mode)) run(state.mode); return () => abort.current?.abort(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function stop() { abort.current?.abort(); setBusy(false); if (out) setError({ message: "Stopped. The preview is incomplete.", retryable: true }); }
  /** Put the original selection back, exactly as it was before the sheet opened (same range, editor focused). */
  function restoreSelection() {
    try {
      if (editor.isDestroyed) return;
      if (range && range.to <= editor.state.doc.content.size) editor.chain().focus().setTextSelection(range).run(); else editor.commands.focus();
    } catch { /* editor gone */ }
  }
  function close() { abort.current?.abort(); if (!applied.current) restoreSelection(); onClose(); }
  function apply(kind: "replace" | "insert") {
    const nodes = markdownToDoc(out); if (!nodes.length) return;
    const doc = editor.state.doc; const size = doc.content.size;
    const act = last?.act ?? "custom";
    // provenance: which action produced the block and which blocks of the page it is about (none when the block replaces its own source)
    const wrapped = [{ type: "aiBlock", attrs: aiBlockAttrs({ model: meta?.model, action: act, label: LABELS[act] ?? act, instruction: last?.opts.instruction, sources: kind !== "insert" ? [] : range ? sourcesOfRange(doc as unknown as DocLike, range, state.pageId) : state.pageId && !generate ? [{ pageId: state.pageId, blockId: null, title: "This page" }] : [] }), content: nodes }];
    let ok = false;
    if (kind === "replace" && range) {
      if (range.to > size || doc.textBetween(range.from, range.to, "\n") !== state.selection) { setStale(true); toast("The page changed since you selected this text", { description: "Replace is disabled so nothing else gets overwritten. Use Insert below or Copy.", tone: "danger" }); return; }
      const $from = doc.resolve(range.from); const $to = doc.resolve(range.to);
      const inline = nodes.length === 1 && nodes[0].type === "paragraph" && $from.sameParent($to) && $from.parent.isTextblock;
      ok = editor.chain().focus().insertContentAt(range, inline ? nodes[0].content ?? [] : wrapped).run(); // one transaction = one undo step
    } else {
      const anchor = Math.min(range ? range.to : state.insertAt, size); const $p = doc.resolve(anchor);
      const pos = range && $p.depth >= 1 ? $p.after(1) : anchor; // below the block that holds the end of the selection
      ok = editor.chain().focus().insertContentAt(pos, wrapped).run();
    }
    if (!ok) { toast("Could not apply the result", { description: "The document was left unchanged. Copy the text instead.", tone: "danger" }); return; }
    applied.current = true;
    toast(kind === "replace" ? "Selection replaced" : "Inserted below", { tone: "success", action: { label: "Undo", run: () => { editor.chain().focus().undo().run(); } } });
    close();
  }
  /** One accepted link suggestion = one explicit action = one undoable transaction: a link on the suggested words when they are in the selection, else a mention of the page after it. */
  function decideLink(accept: boolean) {
    const l = links?.items[linkAt]; if (!l) return;
    if (!accept) { setDecided((d) => [...d, { pageId: l.pageId, title: l.title, accepted: false }]); setLinkAt((i) => i + 1); return; }
    const doc = editor.state.doc; const size = doc.content.size; const scope = range && range.to <= size ? range : { from: 0, to: size };
    const at = findAnchor(doc as unknown as DocLike, scope, l.anchorText); let ok = false; let how = "";
    if (at) { ok = editor.chain().setTextSelection(at).setLink({ href: linkHref(l) }).run(); how = `linked “${l.anchorText}”`; }
    else { const end = Math.min(scope.to, size); const $p = doc.resolve(end); const pos = $p.parent.isTextblock ? end : Math.min(state.insertAt, size); ok = editor.chain().insertContentAt(pos, [{ type: "text", text: " " }, { type: "mention", attrs: { id: l.pageId, label: l.title } }]).run(); how = "mention added"; }
    if (!ok) { toast("Could not add this link", { description: "The document was left unchanged.", tone: "danger" }); return; }
    applied.current = true; setDecided((d) => [...d, { pageId: l.pageId, title: l.title, accepted: true, how }]); setLinkAt((i) => i + 1);
  }
  async function copy() { try { await navigator.clipboard.writeText(out); toast("Copied"); } catch { toast("Copy failed", { description: "The browser refused access to the clipboard.", tone: "danger" }); } }

  const analysis = isAnalysisAction(last?.act); const reviewing = links !== null && !busy && !error;
  const showPicker = !out && !busy && !error && !confirm && links === null; const what = range ? "The selected text" : generate ? "Your instruction" : "The text of this page";
  const chip = "flex min-h-11 items-center gap-2 rounded-xl border border-line bg-bg px-3 text-left text-[14px] font-medium hover:bg-bg-sunk disabled:opacity-50 sm:min-h-9 sm:text-[13px]";
  const blocked = !online || notConfigured;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent title={generate ? "Write with AI" : range ? "AI on the selection" : "AI on this page"} className="sm:w-[min(40rem,calc(100vw-2rem))]"
        onOpenAutoFocus={(e) => { e.preventDefault(); if (!isTouch && !AUTO.has(state.mode) && inputRef.current) inputRef.current.focus(); else (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true }); /* focus the sheet, not a field: no keyboard pops up over the preview */ }} onCloseAutoFocus={(e) => { e.preventDefault(); if (!applied.current) restoreSelection(); }}>
        <div className="grid min-w-0 gap-3 pb-1">
          {!online && <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-[12.5px] leading-5"><WifiOff className="mt-0.5 size-4 shrink-0 text-warning" />You are offline: nothing can be sent. Your selection is untouched.</div>}
          {notConfigured && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-2 text-[12.5px] leading-5"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" /><span><b>AI is not configured.</b> No provider API key is set on the server.</span></div>}
          {source && (
            <details className="min-w-0 rounded-xl border border-line bg-bg-sunk/60" open={showPicker && source.length < 400}>
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-[12.5px] font-medium text-fg-muted sm:min-h-9">{range ? "Original selection" : "Page text"} · {source.length.toLocaleString()} characters <span className="ml-auto text-[11.5px] font-normal">kept until you apply</span></summary>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-line px-3 py-2 text-[13.5px] leading-6 [overflow-wrap:anywhere]">{source.length > 6000 ? source.slice(0, 6000) + "…" : source}</div>
            </details>
          )}
          {showPicker && <>
            {!generate && <>
              <div className="grid grid-cols-2 gap-1.5">{ACTIONS.map((a) => <button key={a.id} type="button" disabled={blocked} onClick={() => run(a.id)} className={chip}><a.icon className="size-4 shrink-0 text-ai" /><span className="min-w-0 leading-tight">{a.label}</span></button>)}</div>
              <div className="rounded-xl border border-line p-2"><div className="mb-1.5 flex items-center gap-1.5 px-1 text-[12.5px] font-medium text-fg-muted"><Languages className="size-4 text-ai" />Translate</div>
                <div className="flex flex-wrap gap-1.5"><button type="button" disabled={blocked} className={cn(chip, "flex-1 justify-center")} onClick={() => run("translate", { language: "fr" })}>→ Français</button><button type="button" disabled={blocked} className={cn(chip, "flex-1 justify-center")} onClick={() => run("translate", { language: "en" })}>→ English</button>
                  <div className="flex w-full gap-1.5"><select aria-label="Other target language" value={lang} onChange={(e) => setLang(e.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-2 text-[16px] sm:h-9 sm:text-[13px]">{LANGS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select><Button type="button" variant="outline" disabled={blocked} className="h-11 sm:h-9" onClick={() => run("translate", { language: lang })}>Translate</Button></div></div>
              </div>
              <div className="rounded-xl border border-ai/25 bg-ai-soft/30 p-2" data-testid="ai-analysis"><div className="mb-1.5 flex items-center gap-1.5 px-1 text-[12.5px] font-medium text-ai"><Sparkles className="size-4" />Analyse</div>
                <div className="grid grid-cols-2 gap-1.5">{ANALYSIS_ACTIONS.map((a) => { const Icon = ANALYSIS_ICON[a.id] ?? Sparkles; return <button key={a.id} type="button" disabled={blocked} onClick={() => run(a.id)} title={a.hint} data-action={a.id} className={cn(chip, a.id === "links" && "col-span-2")}><Icon className="size-4 shrink-0 text-ai" /><span className="min-w-0 leading-tight">{a.label}{a.id === "links" && <span className="block text-[11.5px] font-normal text-fg-muted">{a.hint} — you confirm each one</span>}</span></button>; })}</div>
              </div>
            </>}
            <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (instruction.trim()) run("custom", { instruction: instruction.trim() }); }}>
              <input ref={inputRef} value={instruction} onChange={(e) => setInstruction(e.target.value)} aria-label="Custom instruction" enterKeyHint="go" placeholder={generate ? "What should AI write here?" : "Or tell AI what to do with it…"} className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-[16px] outline-none placeholder:text-fg-faint focus:border-ai/60 sm:h-9 sm:text-[14px]" />
              <Button type="submit" variant="ai" className="h-11 sm:h-9" disabled={blocked || !instruction.trim()}>Run</Button>
            </form>
            <p className="text-[11.5px] leading-4 text-fg-muted" role="note">{what}{source ? ` (${source.length.toLocaleString()} characters)` : ""} is sent to {targets.length ? <b className="font-medium text-fg">{targets.join(" or ")}</b> : "the routed AI provider"}{targets.length > 1 ? ", depending on the action" : ""} only when you start an action. Nothing changes in the page before you approve the preview.</p>
          </>}
          {confirm && (
            <div role="alertdialog" aria-label="Expensive request" className="rounded-xl border border-warning/50 bg-warning/10 p-3 text-[13px] leading-5">
              <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /><div><p className="font-semibold">Expensive request — not sent yet</p><p className="mt-0.5">{confirm.reason}.</p></div></div>
              <div className="mt-2 flex gap-2"><Button variant="outline" className="h-11 flex-1 sm:h-9" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="ai" className="h-11 flex-1 sm:h-9" onClick={() => run(confirm.act, { ...confirm.opts, confirmExpensive: true })}>Send anyway</Button></div>
            </div>
          )}
          {reviewing && links && (
            <div className="min-w-0 rounded-xl border border-ai/30 bg-ai-soft/25 p-3" data-testid="ai-links" aria-live="polite">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-ai"><span className="ai-mark"><Sparkles className="size-3" />AI</span><span className="min-w-0 flex-1 truncate">Suggested links{links.items.length ? ` · ${Math.min(linkAt + 1, links.items.length)} of ${links.items.length}` : ""}</span></div>
              {links.items.length === 0 ? <p className="text-[13px] leading-5 text-fg-muted">{links.candidates === 0 ? "No other page of yours is close enough to this passage — no model was called." : "The model found no link worth suggesting among the candidate pages."}</p>
                : linkAt < links.items.length ? (() => { const l = links.items[linkAt]; const here = l.anchorText && findAnchor(editor.state.doc as unknown as DocLike, range && range.to <= editor.state.doc.content.size ? range : { from: 0, to: editor.state.doc.content.size }, l.anchorText); return (
                  <div data-testid="ai-link-suggestion">
                    <div className="text-[14px] font-semibold leading-snug">{l.icon ?? "📄"} {l.title}</div>
                    {l.reason && <p className="mt-1 text-[13px] leading-5 text-ai">{l.reason}</p>}
                    {l.excerpt && <blockquote className="mt-1.5 line-clamp-3 border-l-2 border-line-strong pl-2.5 text-[12.5px] leading-5 text-fg-muted">{l.excerpt}</blockquote>}
                    <p className="mt-1.5 text-[12px] text-fg-muted">{here ? <>Accepting turns <b className="font-medium text-fg">“{l.anchorText}”</b> into a link to this page.</> : "Accepting adds a mention of this page after the passage."}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:flex"><Button variant="ai" className="h-11 sm:h-9" onClick={() => decideLink(true)}><Check />Add this link</Button><Button variant="outline" className="h-11 sm:h-9" onClick={() => decideLink(false)}><SkipForward />Skip</Button><a href={linkHref(l)} target="_blank" rel="noopener noreferrer" className="col-span-2 flex h-11 items-center justify-center rounded-md px-2 text-[12.5px] text-fg-muted hover:bg-bg-sunk sm:ml-auto sm:h-9">Open the page</a></div>
                  </div>); })()
                : <p className="text-[13px] leading-5" data-testid="ai-links-done">Review finished: {decided.filter((d) => d.accepted).length} link{decided.filter((d) => d.accepted).length === 1 ? "" : "s"} added, {decided.filter((d) => !d.accepted).length} skipped.{decided.some((d) => d.accepted) ? " Undo (⌘Z) removes them one by one." : " Nothing was changed."}</p>}
              {decided.length > 0 && <ul className="mt-2 space-y-0.5 border-t border-ai/20 pt-2 text-[12px] text-fg-muted">{decided.map((d) => <li key={d.pageId} className="flex items-center gap-1.5">{d.accepted ? <Check className="size-3.5 text-success" /> : <SkipForward className="size-3.5" />}<span className="min-w-0 truncate">{d.title}</span><span className="ml-auto shrink-0">{d.accepted ? d.how : "skipped"}</span></li>)}</ul>}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] leading-4 text-fg-muted"><span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{meta?.provider ? <>The passage was sent to <b className="font-medium text-fg">{meta.provider} · {meta.model}</b> · {usd(meta.costUsd)}.</> : null} Suggestions are generated by AI; nothing is added until you accept it.</span><Button variant="outline" className="h-11 sm:h-9" onClick={close}>{decided.some((d) => d.accepted) ? "Done" : "Close"}</Button></div>
            </div>
          )}
          {(out || busy) && (
            <div className="min-w-0 rounded-xl border border-ai/30 bg-bg" data-testid="ai-preview">
              <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] font-medium text-fg-muted"><span className="ai-mark"><Sparkles className="size-3" />AI</span><span className="min-w-0 flex-1 truncate">Preview · {LABELS[last?.act ?? ""] ?? last?.act}{last?.opts.language ? ` → ${LANGS.find(([id]) => id === last.opts.language)?.[1] ?? last.opts.language}` : ""}</span>{busy && <Button size="xs" variant="ghost" className="h-9" onClick={stop}>Stop</Button>}</div>
              <div className="chat-md max-h-[38dvh] min-w-0 overflow-y-auto px-3 py-2" aria-live="polite" aria-busy={busy}><Markdown text={out || "…"} />{busy && <span className="pulse-soft text-fg-faint">▍</span>}</div>
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-[13px] leading-5">
              <p className="font-medium text-danger">{error.code === "not_configured" ? "AI is not configured." : "The action failed."}</p><p className="mt-0.5 [overflow-wrap:anywhere]">{error.message}</p>
              <p className="mt-0.5 text-fg-muted">Your text was not changed.</p>
              <div className="mt-2 flex flex-wrap gap-2">{error.retryable && last && <Button variant="outline" className="h-11 sm:h-9" onClick={() => run(last.act, last.opts)}><RotateCcw />Retry</Button>}<Button variant="ghost" className="h-11 sm:h-9" onClick={() => { setError(null); setOut(""); setDone(false); }}>Choose another action</Button></div>
            </div>
          )}
          {meta?.budgetNote && <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-[12.5px] leading-5">{meta.budgetNote}</p>}
          {out && !busy && (
            <div className="sticky bottom-0 -mx-4 -mb-1 border-t border-line bg-bg-elev px-4 pb-1 pt-2 sm:-mx-5 sm:px-5">
              {done && <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {range && !analysis && <Button className="h-11 sm:h-9" disabled={stale} onClick={() => apply("replace")}><Replace />Replace selection</Button>}
                <Button variant={range && !stale && !analysis ? "secondary" : "default"} className={cn("h-11 sm:h-9", (!range || analysis) && "col-span-2")} onClick={() => apply("insert")}><ArrowDownToLine />{range ? "Insert below" : "Insert"}</Button>
                <Button variant="outline" className="h-11 sm:h-9" onClick={copy}><Copy />Copy</Button>
                <Button variant="outline" className="h-11 sm:h-9" onClick={close}><Trash2 />Discard</Button>
              </div>}
              {!done && <div className="grid grid-cols-2 gap-2"><Button variant="outline" className="h-11 sm:h-9" onClick={copy}><Copy />Copy partial text</Button><Button variant="outline" className="h-11 sm:h-9" onClick={close}><Trash2 />Discard</Button></div>}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] leading-4 text-fg-muted">
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{meta?.provider ? <>{what} was sent to <b className="font-medium text-fg">{meta.provider} · {meta.model}</b>{done ? ` · ${usd(meta.costUsd)}` : ""}{meta.latencyMs ? ` · ${(meta.latencyMs / 1000).toFixed(1)} s` : ""}.</> : null} {done ? "Undo (⌘Z) restores the original after applying." : ""}</span>
                {last && <button type="button" className="flex h-9 shrink-0 items-center gap-1 rounded-md px-2 font-medium hover:bg-bg-sunk" onClick={() => run(last.act, last.opts)} title="Sends the text again (a new, billed request)"><RefreshCw className="size-3.5" />Regenerate (new request)</button>}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Dialog>
  );
}
