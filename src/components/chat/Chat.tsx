/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/chat/Chat.tsx
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
/**
 * Assistant grounded in the notes. Rules this component enforces on the client:
 *  - nothing is sent before the owner presses Send (the "plan" request is a dry run on our own server, no provider involved);
 *  - what is sent, to which provider and model, is stated before the first send and under the composer;
 *  - a failed answer is never re-sent automatically: the owner presses Retry, which repeats the same `clientId` so an answer that the
 *    server already stored is replayed instead of being generated (and billed) again;
 *  - citations open the page and the exact block; answers without support say so.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelPicker } from "@/components/ai/ModelPicker";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpenText, ChevronDown, Copy, FilePlus2, FileText, History, ListChecks, MessageCircle, Paperclip, PenLine, Plus, RotateCcw, Scale, SearchX, Send, ShieldCheck, Sparkles, Square, ArrowDownToLine, WifiOff, X, ListTodo } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, sse, newKey } from "@/lib/client/api";
import { useIsPhone, useIsTouch, useOnline } from "@/lib/client/hooks";
import { useUI } from "@/lib/client/store";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ChatMode, ChatPlan, Evidence, Sent, SourceRef } from "@/lib/ai/chat";
// NEXT-K (Ask My Knowledge): scope selector, starter questions, the "insufficient evidence" wording
import { SCOPES, evidenceNotice, scopeApplies, scopeAvailable, scopeBody, scopeUnavailableReason, starterQuestions, type AskScope } from "@/lib/client/knowledge";
import { useEditorSelection } from "@/components/knowledge/useEditorSelection";

type Img = { mime: string; dataBase64: string; name: string };
interface Payload { clientId: string; message: string; mode: ChatMode; model: string | null; images: Img[]; confirmExpensive?: boolean; scope?: AskScope; selection?: string | null; selectionBlockId?: string | null }
interface Failure { message: string; code?: string; retryable: boolean; alternative?: { model: string; provider: string } | null }
interface Msg {
  key: string; id?: string; role: "user" | "assistant"; content: string; mode?: ChatMode; model?: string | null; provider?: string | null; sources?: SourceRef[]; weak?: SourceRef[];
  costUsd?: number | null; latencyMs?: number | null; streaming?: boolean; stopped?: boolean; evidence?: Evidence; invalidCitations?: number[]; uncited?: boolean; replayed?: boolean; sent?: Sent | null;
  budgetNote?: string | null; failure?: Failure; payload?: Payload; tasksCreated?: number; scope?: AskScope; scopePages?: number | null;
}
const MODES: { id: ChatMode; label: string; hint: string; icon: typeof Sparkles; page: boolean; sends: string; placeholder: string; preset?: string }[] = [
  { id: "notes", label: "Answer with my notes", hint: "Searches your workspace and answers only from what it finds, with citations.", icon: BookOpenText, page: false, sends: "your question + up to 8 excerpts found in your notes", placeholder: "Ask your notes…" },
  { id: "summarise", label: "Summarise this page", hint: "Overview, key points and open questions of the open page.", icon: FileText, page: true, sends: "your request + the text of this page", placeholder: "Summarise this page (add a focus if you want)…", preset: "Summarise this page." },
  { id: "actions", label: "Extract actions", hint: "Returns a checklist you can turn into tasks or insert in the page.", icon: ListChecks, page: true, sends: "your request + the text of this page", placeholder: "Extract the action items…", preset: "Extract the action items from this page." },
  { id: "contradictions", label: "Find contradictions", hint: "Inside the page, and between the page and related notes.", icon: Scale, page: true, sends: "your request + the text of this page + up to 8 excerpts from other notes", placeholder: "Find contradictions…", preset: "Find contradictions in this page and with my other notes." },
  { id: "draft", label: "Draft from references", hint: "Writes from extracts of your reference documents, every claim cited.", icon: PenLine, page: false, sends: "your request + up to 8 extracts from your reference documents (+ their bibliographic entries)", placeholder: "What should be drafted from your references?" },
  { id: "general", label: "General question", hint: "No note is used or sent. The answer comes from the model alone.", icon: MessageCircle, page: false, sends: "your question only — no workspace content", placeholder: "Ask anything (your notes are not used)…" },
];
const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ChatMode, (typeof MODES)[number]>;
const SENTINEL = "[[INSUFFICIENT]]";
const usd = (v: number | null | undefined) => (v == null ? null : v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);
const tasksOf = (md: string) => [...md.matchAll(/^\s*[-*]\s*\[( |x|X)\]\s+(.+)$/gm)].filter((m) => m[1] === " ").map((m) => m[2].replace(/\*\*|__|`/g, "").trim().slice(0, 500)).filter(Boolean);
function sentLine(s: Sent | null | undefined) {
  if (!s) return null; const parts = ["question"];
  if (s.pageChars) parts.push(`this page (${s.pageChars.toLocaleString()} characters)`); if (s.excerpts) parts.push(`${s.excerpts} excerpt${s.excerpts === 1 ? "" : "s"}`); if (s.references) parts.push(`${s.references} reference entr${s.references === 1 ? "y" : "ies"}`);
  if (s.images) parts.push(`${s.images} image${s.images === 1 ? "" : "s"}`); if (s.history) parts.push(`${s.history} earlier message${s.history === 1 ? "" : "s"}`);
  return parts.join(" + ");
}
const tap = "size-11 md:size-8"; // 44 px on phones

export function Chat({ pageId, conversationId: initialConv, prefill, compact, onInsert }: { pageId?: string | null; conversationId?: string | null; prefill?: string | null; compact?: boolean; onInsert?: (md: string) => void }) {
  const r = useRouter(); const qc = useQueryClient(); const isPhone = useIsPhone(); const isTouch = useIsTouch(); const online = useOnline();
  const [conv, setConv] = useState<string | null>(initialConv ?? null); const [msgs, setMsgs] = useState<Msg[]>([]); const [input, setInput] = useState(prefill ?? ""); const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ChatMode>("notes"); const [model, setModel] = useState<string | null>(null); const [images, setImages] = useState<Img[]>([]);
  const [modeOpen, setModeOpen] = useState(false); const [histOpen, setHistOpen] = useState(false); const [confirm, setConfirm] = useState<{ payload: Payload; reason: string; plan: ChatPlan } | null>(null); const [loadErr, setLoadErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null); const list = useRef<HTMLDivElement>(null); const ta = useRef<HTMLTextAreaElement>(null); const liveConv = useRef<string | null>(null); const stick = useRef(true);
  const def = MODE_BY_ID[mode]; const pageMissing = def.page && !pageId;
  // NEXT-K: where the evidence may come from (all / this page / this project / the selection). `all` sends the 2.x request unchanged.
  const [scope, setScope] = useState<AskScope>("all"); const { selection: picked, clear: clearPicked } = useEditorSelection(compact ? null : pageId);
  const scopeCtx = { pageId: pageId ?? null, selection: picked?.text ?? null, selectionBlockId: picked?.blockId ?? null };
  const scoped = SCOPES.some((x) => x.id !== "all" && scopeApplies(mode, x.id)); const activeScope: AskScope = scopeApplies(mode, scope) && scopeAvailable(scope, scopeCtx) ? scope : "all";
  useEffect(() => { setScope("all"); }, [pageId]);

  const { data: convs = [], isLoading: convsLoading, isError: convsError, refetch: refetchConvs } = useQuery<{ id: string; title: string; updatedAt: string }[]>({ queryKey: ["convs", pageId ?? "all"], queryFn: () => api(`/api/ai/conversations${pageId ? `?pageId=${pageId}` : ""}`), staleTime: 10_000, enabled: histOpen });
  // Dry run on our own server (routing tables + page length): tells which provider/model would get what. No provider is contacted.
  const planQ = useQuery<ChatPlan>({ queryKey: ["ai-plan", mode, pageId ?? null, model, images.length], queryFn: () => api(`/api/ai/chat/plan?mode=${mode}${pageId ? `&pageId=${pageId}` : ""}${model ? `&model=${encodeURIComponent(model)}` : ""}${images.length ? `&images=${images.length}` : ""}`), staleTime: 30_000, enabled: online && !pageMissing, retry: 1 });
  const plan = planQ.data; const notConfigured = plan ? !plan.configured.any : false;

  useEffect(() => { if (prefill) { setInput(prefill); ta.current?.focus(); } }, [prefill]);
  useEffect(() => { if (def.page && !pageId) setMode("notes"); }, [pageId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Load a stored conversation (history or a restored panel) — never while it is the one being streamed.
  const loadConv = useCallback((id: string) => {
    setLoadErr(null);
    api(`/api/ai/conversations?id=${id}`).then((c) => {
      setMsgs((c.messages as any[]).map((m) => ({ key: m.id, id: m.id, role: m.role, content: m.content, mode: m.meta?.mode, model: m.model, provider: m.provider, sources: (m.sources ?? []).filter((s: any) => typeof s.n === "number"), costUsd: m.costUsd, latencyMs: m.latencyMs, evidence: m.meta?.evidence, invalidCitations: m.meta?.invalidCitations, uncited: m.meta?.uncited, sent: m.meta?.sent ?? null })));
      if (c.model) setModel(c.model);
    }).catch((e) => setLoadErr(e?.message ?? "Could not load the conversation"));
  }, []);
  useEffect(() => { if (!conv) { setMsgs([]); return; } if (liveConv.current === conv) return; loadConv(conv); }, [conv, loadConv]);
  useEffect(() => { if (!compact) { const ui = useUI.getState(); ui.set({ aiContext: { ...ui.aiContext, pageId: pageId ?? null, conversationId: conv } }); } }, [conv, pageId, compact]);
  useEffect(() => { const el = list.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [msgs]); // scroll the message list only, never the page
  useEffect(() => () => abort.current?.abort(), []);

  const patch = (clientId: string, f: (m: Msg) => Msg) => setMsgs((ms) => ms.map((m) => (m.role === "assistant" && m.key === `a:${clientId}` ? f(m) : m)));
  async function run(p: Payload) {
    if (busy) return; setBusy(true); setConfirm(null); stick.current = true;
    setMsgs((ms) => ms.some((m) => m.key === `a:${p.clientId}`)
      ? ms.map((m) => (m.key === `a:${p.clientId}` ? { key: m.key, role: "assistant" as const, content: "", streaming: true, mode: p.mode, payload: p } : m))
      : [...ms, { key: `u:${p.clientId}`, role: "user" as const, content: p.message, mode: p.mode }, { key: `a:${p.clientId}`, role: "assistant" as const, content: "", streaming: true, mode: p.mode, payload: p }]);
    const ac = new AbortController(); abort.current = ac; let finished = false;
    await sse("/api/ai/chat", { conversationId: conv, clientId: p.clientId, message: p.message, mode: p.mode, pageId: pageId ?? null, model: p.model, confirmExpensive: p.confirmExpensive ?? false, images: p.images.map(({ mime, dataBase64 }) => ({ mime, dataBase64 })), ...scopeBody(p.mode, p.scope ?? "all", { pageId: pageId ?? null, selection: p.selection ?? null, selectionBlockId: p.selectionBlockId ?? null }) }, (ev) => {
      if (ev.type === "meta") { liveConv.current = ev.conversationId; setConv(ev.conversationId); patch(p.clientId, (m) => ({ ...m, model: ev.model, provider: ev.provider, sources: ev.sources, weak: ev.weak, evidence: ev.evidence, sent: ev.sent, budgetNote: ev.budgetNote, replayed: ev.replayed, content: "", scope: ev.scope ?? "all", scopePages: ev.scopePages ?? null })); }
      else if (ev.type === "text") patch(p.clientId, (m) => ({ ...m, content: m.content + ev.delta }));
      else if (ev.type === "done") { finished = true; patch(p.clientId, (m) => ({ ...m, id: ev.messageId, streaming: false, content: ev.content, costUsd: ev.costUsd, latencyMs: ev.latencyMs, sources: ev.sources, evidence: ev.evidence, invalidCitations: ev.invalidCitations, uncited: ev.uncited, replayed: ev.replayed })); }
      else if (ev.type === "needs_confirmation") { finished = true; setMsgs((ms) => ms.filter((m) => m.key !== `a:${p.clientId}` && m.key !== `u:${p.clientId}`)); setConfirm({ payload: p, reason: ev.reason, plan: ev.plan }); }
      else if (ev.type === "error") { finished = true; if (ev.conversationId) { liveConv.current = ev.conversationId; setConv(ev.conversationId); } patch(p.clientId, (m) => ({ ...m, streaming: false, failure: { message: ev.message ?? "The request failed", code: ev.code, retryable: ev.retryable ?? ev.code === "network", alternative: ev.alternative ?? null } })); }
    }, ac.signal).catch(() => {});
    if (!finished) patch(p.clientId, (m) => (m.streaming ? { ...m, streaming: false, stopped: true } : m)); // stopped by the owner
    setBusy(false); qc.invalidateQueries({ queryKey: ["convs"] });
  }
  function send(text = input, m: ChatMode = mode) {
    const message = (text.trim() || MODE_BY_ID[m].preset || "").trim(); if (!message || busy || !online || notConfigured || (MODE_BY_ID[m].page && !pageId)) return;
    const sc: AskScope = scopeApplies(m, scope) && scopeAvailable(scope, scopeCtx) ? scope : "all";
    const p: Payload = { clientId: newKey(), message, mode: m, model, images, scope: sc, ...(sc === "selection" ? { selection: picked?.text ?? null, selectionBlockId: picked?.blockId ?? null } : {}) }; setInput(""); setImages([]); if (ta.current) ta.current.style.height = "auto";
    run(p);
  }
  function pickMode(id: ChatMode) {
    const d = MODE_BY_ID[id];
    if (d.page && !pageId) { toast("Open a page first", { description: `“${d.label}” works on the page you are reading. Open a note, then come back.` }); return; }
    setMode(id); setModeOpen(false); if (!isTouch) ta.current?.focus();
  }
  function newConversation() { abort.current?.abort(); liveConv.current = null; setConv(null); setMsgs([]); setConfirm(null); setLoadErr(null); }
  function openSource(s: SourceRef) {
    if (!s.pageId) { toast("This source is a file without a page", { description: s.title }); return; }
    if (s.pageId === pageId && s.blockId) {
      const el = document.getElementById(`block-${s.blockId}`);
      if (el) { if (isPhone) useUI.getState().set({ aiOpen: false }); requestAnimationFrame(() => { el.scrollIntoView({ block: "center" }); el.classList.add("bg-accent-soft"); setTimeout(() => el.classList.remove("bg-accent-soft"), 2000); }); return; }
    }
    if (isPhone) useUI.getState().set({ aiOpen: false });
    r.push(`/p/${s.pageId}${s.blockId ? `#block-${s.blockId}` : ""}`);
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Copy failed", { description: "The browser refused access to the clipboard.", tone: "danger" }); } }
  async function saveToNote(m: Msg) {
    try {
      const { markdownToDoc } = await import("@/lib/editor/markdown-client");
      const p = await api("/api/pages", { method: "POST", json: { title: m.content.split("\n")[0].replace(/^#+\s*/, "").replace(/\*\*/g, "").slice(0, 80) || "AI answer", content: { type: "doc", content: markdownToDoc(m.content) } } });
      qc.invalidateQueries({ queryKey: ["tree"] }); toast("Saved as a note", { tone: "success", action: { label: "Open", run: () => { if (isPhone) useUI.getState().set({ aiOpen: false }); r.push(`/p/${p.id}`); } } });
    } catch (e: any) { toast("Could not save the note", { description: e?.message, tone: "danger" }); }
  }
  async function createTasks(m: Msg) {
    const titles = tasksOf(m.content); if (!titles.length) return; const ids: string[] = [];
    try { for (const title of titles) { const t = await api("/api/tasks", { method: "POST", json: { title, pageId: pageId ?? null } }); ids.push(t.id); } }
    catch (e: any) { toast(ids.length ? `Only ${ids.length} of ${titles.length} tasks were created` : "Could not create the tasks", { description: e?.message, tone: "danger" }); if (!ids.length) return; }
    setMsgs((ms) => ms.map((x) => (x.key === m.key ? { ...x, tasksCreated: ids.length } : x)));
    toast(`${ids.length} task${ids.length === 1 ? "" : "s"} created`, { tone: "success", action: { label: "Undo", run: async () => { await Promise.all(ids.map((id) => api(`/api/tasks?id=${id}`, { method: "DELETE" }).catch(() => {}))); setMsgs((ms) => ms.map((x) => (x.key === m.key ? { ...x, tasksCreated: undefined } : x))); toast("Tasks removed"); } } });
  }
  const addImage = (f: File) => { if (f.size > 5_000_000) { toast("Image too large", { description: "5 MB maximum per image.", tone: "danger" }); return; } const rd = new FileReader(); rd.onload = () => setImages((s) => [...s, { mime: f.type, dataBase64: String(rd.result).split(",")[1], name: f.name }].slice(0, 4)); rd.readAsDataURL(f); };

  const target = plan?.provider ? `${plan.provider} · ${plan.model}` : null;
  const disclosure = useMemo(() => {
    const extra: string[] = [];
    if (plan?.sends.embeddedBy) extra.push("the search step sends your question to OpenAI to compute its embedding");
    if (plan?.sends.rankedBy) extra.push(`short candidate excerpts may be ranked by ${plan.sends.rankedBy.provider} · ${plan.sends.rankedBy.model}`);
    return extra;
  }, [plan]);
  const canSend = !busy && online && !notConfigured && !pageMissing && Boolean(input.trim() || def.preset);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        {/* NEXT-AI: model selector with creator logo, route badge, capabilities, context, price (same choices as before: Auto + every selectable model) */}
        <ModelPicker value={model} onChange={setModel} aria-label="Model" />
        <button type="button" onClick={() => setHistOpen(true)} className={cn("grid shrink-0 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk", tap)} aria-label="Conversation history"><History className="size-[18px] md:size-4" /></button>
        <button type="button" onClick={newConversation} className={cn("grid shrink-0 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk", tap)} aria-label="New conversation"><Plus className="size-[18px] md:size-4" /></button>
      </div>

      <div ref={list} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4 sm:px-4" aria-live="polite">
        {loadErr && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-[13px]"><p className="text-danger-text">{loadErr}</p><Button variant="outline" className="mt-2 h-11 md:h-8" onClick={() => conv && loadConv(conv)}><RotateCcw />Retry</Button></div>}
        {!msgs.length && !loadErr && (
          <div className="mx-auto max-w-md">
            {!compact && <><div className="flex items-center gap-2"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ai-soft text-ai"><Sparkles className="size-4" /></span><div><p className="text-[15px] font-semibold tracking-[-0.01em]">What do you want to do?</p><p className="text-[12.5px] leading-5 text-fg-muted">{pageId ? "A page is open: page modes are available." : "No page is open: page modes are unavailable."}</p></div></div></>}
            <ul className="mt-3 grid gap-1.5">{MODES.map((m) => { const off = m.page && !pageId; const Icon = m.icon; return (
              <li key={m.id}><button type="button" aria-pressed={mode === m.id} aria-disabled={off} onClick={() => pickMode(m.id)} className={cn("flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors", mode === m.id ? "border-ai bg-ai-soft/50" : "border-line bg-bg-elev hover:bg-bg-sunk", off && "opacity-55")}>
                <Icon className={cn("size-[18px] shrink-0", mode === m.id ? "text-ai" : "text-fg-muted")} /><span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">{m.label}</span>{!compact && <span className="block text-[12px] leading-4 text-fg-muted">{off ? "Needs an open page — open a note first." : m.hint}</span>}</span>
              </button></li>); })}</ul>
            <div className="mt-4 rounded-xl border border-line bg-bg-sunk/60 p-3 text-[12.5px] leading-5" role="note">
              <div className="mb-1 flex items-center gap-1.5 font-semibold"><ShieldCheck className="size-4 text-success" />What gets sent</div>
              <p><b>Nothing has been sent.</b> Opening this panel or a page never contacts an AI provider. When you press Send in “{def.label}”, the server sends {def.sends}{target ? <> to <b>{target}</b></> : " to the routed provider"}, plus the earlier messages of this conversation.</p>
              {disclosure.length > 0 && <p className="mt-1 text-fg-muted">Also: {disclosure.join("; ")}.</p>}
            </div>
            {!compact && mode === "notes" && <div className="mt-4" data-testid="starter-questions"><div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-muted">Starter questions — pick one, then press Send</div><ul className="grid gap-1.5">{starterQuestions({ pageId, hasSelection: Boolean(picked) }).map((sq) => <li key={sq.text}><button type="button" onClick={() => { setScope(scopeAvailable(sq.scope, scopeCtx) ? sq.scope : "all"); setInput(sq.text); if (!isTouch) ta.current?.focus(); }} className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-bg-elev px-3 py-1.5 text-left text-[13.5px] hover:bg-bg-sunk md:min-h-9"><span className="min-w-0 flex-1">{sq.text}</span><span className="shrink-0 rounded-full bg-bg-sunk px-2 py-0.5 text-[11px] text-fg-muted">{SCOPES.find((x) => x.id === sq.scope)!.label}</span></button></li>)}</ul></div>}
          </div>
        )}
        {msgs.map((m) => m.role === "user" ? (
          <div key={m.key} className="ml-auto w-fit max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[15px] leading-6 text-accent-fg shadow-card [overflow-wrap:anywhere] md:text-[14px]">{m.mode && m.mode !== "notes" && <span className="mb-0.5 block text-[11px] font-medium opacity-80">{MODE_BY_ID[m.mode]?.label}</span>}{m.content}</div>
        ) : <Answer key={m.key} m={m} busy={busy} pageOpen={Boolean(pageId)} onInsert={onInsert} onCite={openSource} onCopy={copy} onSave={saveToNote} onTasks={createTasks}
            onRetry={(alt) => m.payload && run(alt ? { ...m.payload, model: alt } : m.payload)}
            onGeneral={() => { const q = msgs.find((x) => x.key === m.key.replace(/^a:/, "u:"))?.content ?? m.payload?.message; if (q) { setMode("general"); send(q, "general"); } }} />)}
      </div>

      <div className="shrink-0 border-t border-line px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        {!online && <div role="status" className="mb-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-[12.5px] leading-5"><WifiOff className="mt-0.5 size-4 shrink-0 text-warning" /><span>You are offline. Nothing can be sent; what you typed stays here until you are back online.</span></div>}
        {notConfigured && <div role="alert" className="mb-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-2 text-[12.5px] leading-5"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" /><span><b>AI is not configured.</b> No provider API key is set on the server, so nothing can be sent.</span></div>}
        {plan?.budgetNote && <div role="status" className="mb-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-[12.5px] leading-5">{plan.budgetNote}</div>}
        {confirm && (
          <div role="alertdialog" aria-label="Expensive request" className="mb-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-[13px] leading-5">
            <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /><div className="min-w-0"><p className="font-semibold">Expensive request — not sent yet</p><p className="mt-0.5">{confirm.reason}{confirm.plan.model ? <> ({confirm.plan.provider} · {confirm.plan.model}, about {Math.round(confirm.plan.estTokens / 1000)}K tokens in{confirm.plan.estCostUsd != null ? `, roughly ${usd(confirm.plan.estCostUsd)} or more` : ""})</> : null}.</p>{confirm.plan.budgetNote && <p className="mt-1 text-fg-muted">{confirm.plan.budgetNote}</p>}</div></div>
            <div className="mt-2 flex gap-2"><Button variant="outline" className="h-11 flex-1 md:h-9" onClick={() => { setInput(confirm.payload.message); setImages(confirm.payload.images); setConfirm(null); }}>Cancel</Button><Button variant="ai" className="h-11 flex-1 md:h-9" onClick={() => run({ ...confirm.payload, confirmExpensive: true })}>Send anyway</Button></div>
          </div>
        )}
        {images.length > 0 && <div className="mb-1.5 flex flex-wrap gap-1.5">{images.map((im, i) => <span key={i} className="flex max-w-full items-center gap-1 rounded-lg border border-line pl-2 text-[12px]"><span className="truncate">{im.name}</span><button type="button" aria-label={`Remove ${im.name}`} className="grid size-9 shrink-0 place-items-center" onClick={() => setImages((s) => s.filter((_, j) => j !== i))}><X className="size-3.5" /></button></span>)}</div>}
        {scoped && <div className="mb-1.5" data-testid="ask-scope" data-scope={activeScope}>
          <div role="radiogroup" aria-label="Search in" className="flex items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none]"><span className="shrink-0 pl-1 pr-0.5 text-[11.5px] text-fg-muted">Search in</span>{SCOPES.map((x) => { const applies = scopeApplies(mode, x.id); const ok = applies && scopeAvailable(x.id, scopeCtx); return <button key={x.id} type="button" role="radio" aria-checked={activeScope === x.id} aria-disabled={!ok} data-scope-option={x.id} title={ok ? x.hint : applies ? scopeUnavailableReason(x.id) : "Not available in this mode."} onClick={() => { if (ok) setScope(x.id); else toast(x.label, { description: applies ? scopeUnavailableReason(x.id) : "This scope is not available in this mode." }); }} className={cn("h-11 shrink-0 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium transition-colors md:h-7 md:px-2.5 md:text-[12px]", activeScope === x.id ? "border-ai bg-ai-soft/60 text-ai" : "border-line bg-bg-elev text-fg-muted hover:text-fg", !ok && "opacity-50")}>{x.label}</button>; })}</div>
          {activeScope === "selection" && picked && <div className="mt-1 flex items-start gap-1.5 rounded-lg border border-line bg-bg-sunk/60 px-2 py-1.5 text-[12px] leading-4 text-fg-muted" data-testid="ask-selection"><span className="line-clamp-2 min-w-0 flex-1">“{picked.text.slice(0, 240)}{picked.text.length > 240 ? "…" : ""}”</span><button type="button" aria-label="Forget this selection" className="grid size-6 shrink-0 place-items-center rounded hover:bg-bg-hover" onClick={() => { clearPicked(); setScope("all"); }}><X className="size-3.5" /></button></div>}
        </div>}
        <button type="button" onClick={() => setModeOpen(true)} aria-haspopup="dialog" className="mb-1.5 flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-line bg-bg-elev px-3 text-left text-[13.5px] font-medium hover:bg-bg-sunk md:h-9 md:text-[12.5px]"><def.icon className="size-4 shrink-0 text-ai" /><span className="min-w-0 flex-1 truncate">{def.label}</span><span className="shrink-0 text-[11.5px] font-normal text-fg-muted">Change</span><ChevronDown className="size-3.5 shrink-0 text-fg-faint" /></button>
        <div className="flex items-end gap-1 rounded-2xl border border-line bg-bg-elev p-1.5 shadow-card transition-colors focus-within:border-ai/50 focus-within:ring-4 focus-within:ring-ai/10">
          <label className={cn("grid shrink-0 cursor-pointer place-items-center rounded-lg text-fg-faint hover:bg-bg-sunk", "size-11 md:size-8")}><span className="sr-only">Attach an image</span><Paperclip className="size-[18px] md:size-4" /><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => { Array.from(e.target.files ?? []).forEach(addImage); e.target.value = ""; }} /></label>
          <textarea ref={ta} value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder={def.placeholder} aria-label="Message" enterKeyHint={isTouch ? "enter" : "send"} className="max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-[16px] leading-6 outline-none placeholder:text-fg-faint md:min-h-8 md:py-1.5 md:text-[14px]"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isTouch && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(160, el.scrollHeight) + "px"; }} />
          {busy ? <Button type="button" variant="secondary" className={cn("shrink-0 p-0", tap)} aria-label="Stop" onClick={() => abort.current?.abort()}><Square /></Button> : <Button type="button" variant="ai" className={cn("shrink-0 p-0", tap)} aria-label="Send" onClick={() => send()} disabled={!canSend}><Send /></Button>}
        </div>
        <p className="mt-1.5 px-1 text-[11.5px] leading-4 text-fg-muted" role="note">
          {pageMissing ? "This mode needs an open page." : notConfigured ? "AI is not configured on this server." : planQ.isLoading ? <Skeleton className="inline-block h-3 w-56 align-middle" /> : planQ.isError ? <>Could not check the routing. <button type="button" className="underline" onClick={() => planQ.refetch()}>Retry</button></> : plan?.error ? plan.error
            : <>Send = {def.sends}{images.length ? ` + ${images.length} image${images.length === 1 ? "" : "s"}` : ""} → <b className="font-medium text-fg">{target ?? "routed provider"}</b>{plan?.expensive ? " · expensive class, you will be asked to confirm" : ""}. Nothing is sent until you press Send.</>}
        </p>
      </div>

      <Dialog open={modeOpen} onOpenChange={setModeOpen}>
        <SheetContent title="Mode" description="The mode decides what is sent to the AI provider.">
          <ul className="grid gap-1.5 pb-1">{MODES.map((m) => { const off = m.page && !pageId; const Icon = m.icon; return (
            <li key={m.id}><button type="button" aria-pressed={mode === m.id} aria-disabled={off} onClick={() => pickMode(m.id)} className={cn("flex min-h-14 w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left", mode === m.id ? "border-ai bg-ai-soft/50" : "border-line hover:bg-bg-sunk", off && "opacity-55")}>
              <Icon className={cn("mt-0.5 size-[18px] shrink-0", mode === m.id ? "text-ai" : "text-fg-muted")} /><span className="min-w-0 flex-1"><span className="block text-[14.5px] font-medium">{m.label}</span><span className="block text-[12.5px] leading-[1.35] text-fg-muted">{off ? "Needs an open page — open a note first." : m.hint}</span><span className="mt-0.5 block text-[11.5px] leading-[1.35] text-fg-faint">Sends {m.sends}.</span></span>
            </button></li>); })}</ul>
        </SheetContent>
      </Dialog>
      <Dialog open={histOpen} onOpenChange={setHistOpen}>
        <SheetContent title="Conversations" description={pageId ? "Conversations started on this page." : "All conversations."}>
          {convsLoading ? <div className="grid gap-2 py-2"><Skeleton className="h-11" /><Skeleton className="h-11" /><Skeleton className="h-11" /></div>
            : convsError ? <div className="py-4 text-[13px]"><p className="text-danger-text">Could not load the conversations.</p><Button variant="outline" className="mt-2 h-11" onClick={() => refetchConvs()}><RotateCcw />Retry</Button></div>
            : !convs.length ? <p className="py-6 text-center text-[13px] text-fg-muted">No conversation yet. Ask something to start one.</p>
            : <ul className="grid gap-0.5 pb-1">{convs.map((c) => <li key={c.id}><button type="button" aria-current={c.id === conv} onClick={() => { abort.current?.abort(); liveConv.current = null; setConv(c.id); setHistOpen(false); }} className={cn("flex min-h-12 w-full items-center gap-2 rounded-lg px-2 text-left text-[14px] hover:bg-bg-sunk", c.id === conv && "bg-accent-soft")}><span className="min-w-0 flex-1 truncate">{c.title}</span><span className="shrink-0 text-[11.5px] text-fg-faint">{new Date(c.updatedAt).toLocaleDateString()}</span></button></li>)}</ul>}
        </SheetContent>
      </Dialog>
    </div>
  );
}

function Answer({ m, busy, pageOpen, onInsert, onCite, onCopy, onSave, onTasks, onRetry, onGeneral }: { m: Msg; busy: boolean; pageOpen: boolean; onInsert?: (md: string) => void; onCite: (s: SourceRef) => void; onCopy: (t: string) => void; onSave: (m: Msg) => void; onTasks: (m: Msg) => void; onRetry: (altModel?: string) => void; onGeneral: () => void }) {
  const text = m.content.replace(SENTINEL, "").trimStart(); const noEvidence = m.evidence === "none" || m.evidence === "insufficient";
  const tasks = m.mode === "actions" && !m.streaming && !m.failure ? tasksOf(m.content) : []; const complete = !m.streaming && !m.failure && !m.stopped && Boolean(text);
  const who = [m.provider, m.model].filter(Boolean).join(" · "); const sent = sentLine(m.sent);
  const iconBtn = cn("grid place-items-center rounded-md text-fg-muted hover:bg-bg-sunk hover:text-fg", tap);
  return (
    <div className="min-w-0">
      {noEvidence && !m.streaming && (() => { const n = evidenceNotice(m.evidence, m.uncited, m.mode, m.scope ?? "all"); return <div role="status" data-testid="insufficient-evidence" data-evidence={m.evidence} className="mb-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-[12.5px] leading-5"><SearchX className="mt-0.5 size-4 shrink-0 text-warning" /><span><b className="font-semibold">{n?.title ?? "Insufficient evidence"}</b> — no supporting {m.mode === "draft" ? "reference" : "note"} found. {n?.detail}</span></div>; })()}
      {m.streaming && !text ? <div className="flex items-center gap-2 text-[13px] text-fg-muted" role="status"><span className="pulse-soft">▍</span>{m.model ? "Writing…" : m.mode === "summarise" || m.mode === "actions" || m.mode === "general" ? "Sending…" : "Searching your notes…"}</div>
        : <div className="chat-md min-w-0"><Markdown text={text} onCite={m.sources?.length ? (n) => { const s = m.sources?.find((x) => x.n === n); if (s) onCite(s); } : undefined} />{m.streaming && <span className="pulse-soft text-fg-faint">▍</span>}</div>}
      {(m.failure || m.stopped) && (
        <div role="alert" className="mt-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-[13px] leading-5">
          <p className="font-medium text-danger-text">{m.stopped ? "Stopped before the answer was complete." : m.failure!.code === "not_configured" ? "AI is not configured." : "The answer failed."}</p>
          {m.failure && <p className="mt-0.5 [overflow-wrap:anywhere]">{m.failure.message}</p>}
          {text && <p className="mt-0.5 text-fg-muted">The text above is incomplete and was not saved.</p>}
          {(m.stopped || m.failure?.retryable) && <>
            <div className="mt-2 flex flex-wrap gap-2"><Button variant="outline" className="h-11 md:h-9" disabled={busy} onClick={() => onRetry()}><RotateCcw />Retry</Button>{m.failure?.alternative && <Button variant="ghost" className="h-11 md:h-9" disabled={busy} onClick={() => onRetry(m.failure!.alternative!.model)}>Retry with {m.failure.alternative.provider} · {m.failure.alternative.model}</Button>}</div>
            <p className="mt-1.5 text-[11.5px] text-fg-muted">Nothing is re-sent on its own. If the answer had already been stored, Retry shows it without a new provider call.</p>
          </>}
        </div>
      )}
      {complete && m.replayed && <p role="status" className="mt-1.5 text-[11.5px] text-fg-muted">Stored answer shown — nothing was sent again.</p>}
      {complete && Boolean(m.invalidCitations?.length) && <p role="status" className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-[12.5px] leading-5"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /><span>{m.invalidCitations!.length} citation marker{m.invalidCitations!.length === 1 ? "" : "s"} ({m.invalidCitations!.map((n) => `[${n}]`).join(", ")}) pointed to a source that was not retrieved and {m.invalidCitations!.length === 1 ? "was" : "were"} removed.</span></p>}
      {complete && m.uncited && <p role="status" className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-[12.5px] leading-5"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /><span>This answer cites none of the retrieved notes — treat it as unsupported.</span></p>}
      {complete && m.budgetNote && <p role="status" className="mt-2 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-[12.5px] leading-5">{m.budgetNote}</p>}
      {!m.streaming && Boolean(m.sources?.length) && <div className="mt-3"><div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Sources — open the note at the cited block</div><ul className="flex flex-wrap gap-1.5">{m.sources!.map((s) => <li key={s.chunkId} className="max-w-full"><button type="button" onClick={() => onCite(s)} aria-label={`Source ${s.n}: ${s.title}${s.heading ? `, ${s.heading}` : ""}`} title={(s as SourceRef & { quote?: string }).quote || s.excerpt} data-testid="cite-chip" data-block={s.blockId ?? ""} data-page={s.pageId ?? ""} className="cite-chip min-h-11 md:min-h-0"><b>{s.n}</b><span className="min-w-0 truncate">{s.icon ? `${s.icon} ` : ""}{s.title}{s.heading ? ` › ${s.heading}` : ""}</span></button></li>)}</ul></div>}
      {!m.streaming && noEvidence && (
        <div className="mt-2 text-[12.5px] leading-5">
          {Boolean(m.weak?.length) && <><div className="mb-1 text-fg-muted">Closest passages (below the relevance threshold, not used):</div><ul className="mb-2 flex flex-wrap gap-1.5">{m.weak!.map((s) => <li key={s.chunkId} className="max-w-full"><button type="button" onClick={() => onCite(s)} className="cite-chip min-h-11 md:min-h-0"><b>~</b><span className="min-w-0 truncate">{s.title}{s.heading ? ` › ${s.heading}` : ""}</span></button></li>)}</ul></>}
          {m.mode === "notes" && <Button variant="outline" className="h-11 md:h-9" disabled={busy} onClick={onGeneral}><MessageCircle />Ask without my notes</Button>}
        </div>
      )}
      {tasks.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{m.tasksCreated ? <span role="status" className="flex h-11 items-center gap-1.5 rounded-lg bg-success/10 px-3 text-[13px] font-medium text-success-text md:h-9"><ListTodo className="size-4" />{m.tasksCreated} task{m.tasksCreated === 1 ? "" : "s"} created</span> : <Button className="h-11 md:h-9" onClick={() => onTasks(m)}><ListTodo />Create {tasks.length} task{tasks.length === 1 ? "" : "s"}</Button>}{onInsert && pageOpen && <Button variant="outline" className="h-11 md:h-9" onClick={() => onInsert(tasks.map((t) => `- [ ] ${t}`).join("\n"))}><ArrowDownToLine />Insert as checklist</Button>}</div>}
      {complete && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-fg-faint">
          <span className="min-w-0 [overflow-wrap:anywhere]">{m.scope && m.scope !== "all" ? `scope: ${SCOPES.find((x) => x.id === m.scope)?.label.toLowerCase()}${m.scopePages != null ? ` (${m.scopePages} page${m.scopePages === 1 ? "" : "s"})` : ""} · ` : ""}{who || "no provider called"}{m.latencyMs ? ` · ${(m.latencyMs / 1000).toFixed(1)} s` : ""}{usd(m.costUsd) ? ` · ${usd(m.costUsd)}` : who ? " · cost unknown" : ""}{sent && who ? ` · sent: ${sent}` : ""}</span>
          <span className="ml-auto flex shrink-0"><button type="button" className={iconBtn} aria-label="Copy answer" onClick={() => onCopy(text)}><Copy className="size-4" /></button>{onInsert && pageOpen && <button type="button" className={iconBtn} aria-label="Insert into the page" onClick={() => onInsert(text)}><ArrowDownToLine className="size-4" /></button>}<button type="button" className={iconBtn} aria-label="Save as a new note" onClick={() => onSave(m)}><FilePlus2 className="size-4" /></button></span>
        </div>
      )}
    </div>
  );
}
