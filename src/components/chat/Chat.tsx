"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Square, Sparkles, Plus, History, Copy, FilePlus2, BookOpen, ChevronDown, Paperclip, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, sse } from "@/lib/client/api";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, Badge, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface Msg { id?: string; role: "user" | "assistant"; content: string; model?: string | null; sources?: any[]; costUsd?: number | null; latencyMs?: number | null; streaming?: boolean; reason?: string }
const TASKS = [["auto", "Auto"], ["chat", "Chat"], ["write", "Write"], ["reason", "Reason"], ["deep", "Deep"], ["code", "Code"]] as const;

export function Chat({ pageId, conversationId: initialConv, prefill, compact, onInsert }: { pageId?: string | null; conversationId?: string | null; prefill?: string | null; compact?: boolean; onInsert?: (md: string) => void }) {
  const r = useRouter(); const qc = useQueryClient();
  const [conv, setConv] = useState<string | null>(initialConv ?? null); const [msgs, setMsgs] = useState<Msg[]>([]); const [input, setInput] = useState(prefill ?? ""); const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<string | null>(null); const [task, setTask] = useState<string>("auto"); const [useWs, setUseWs] = useState(true); const [images, setImages] = useState<{ mime: string; dataBase64: string; name: string }[]>([]);
  const abort = useRef<AbortController | null>(null); const bottom = useRef<HTMLDivElement>(null); const ta = useRef<HTMLTextAreaElement>(null);
  const { data: models } = useQuery({ queryKey: ["ai-models"], queryFn: () => api("/api/ai/models"), staleTime: 60_000 });
  const { data: convs = [] } = useQuery({ queryKey: ["convs", pageId ?? "all"], queryFn: () => api(`/api/ai/conversations${pageId ? `?pageId=${pageId}` : ""}`), staleTime: 10_000 });
  useEffect(() => { if (prefill) { setInput(prefill); ta.current?.focus(); } }, [prefill]);
  useEffect(() => { if (!conv) { setMsgs([]); return; } api(`/api/ai/conversations?id=${conv}`).then((c) => { setMsgs(c.messages.map((m: any) => ({ id: m.id, role: m.role, content: m.content, model: m.model, sources: m.sources, costUsd: m.costUsd, latencyMs: m.latencyMs }))); if (c.model) setModel(c.model); }).catch(() => {}); }, [conv]);
  useEffect(() => { const el = bottom.current?.parentElement; if (el && msgs.length) el.scrollTop = el.scrollHeight; }, [msgs]); // scroll the message list only, never the page

  async function send() {
    const text = input.trim(); if (!text || busy) return;
    setInput(""); setBusy(true); const imgs = images; setImages([]);
    setMsgs((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "", streaming: true }]);
    const ac = new AbortController(); abort.current = ac;
    let sources: any[] = [];
    await sse("/api/ai/chat", { conversationId: conv, message: text, pageId: pageId ?? null, model, task: task === "auto" ? null : task, useWorkspace: useWs, images: imgs.map(({ mime, dataBase64 }) => ({ mime, dataBase64 })) }, (ev) => {
      if (ev.type === "meta") { if (!conv) setConv(ev.conversationId); sources = ev.sources; setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], model: ev.model, reason: ev.reason, sources: ev.sources, content: ev.reason.startsWith("retry") ? "" : c[c.length - 1].content }; return c; }); }
      else if (ev.type === "text") setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + ev.delta }; return c; });
      else if (ev.type === "done") setMsgs((m) => { const c = [...m]; const last = c[c.length - 1]; const cited = new Set([...last.content.matchAll(/\[(\d{1,2})\]/g)].map((x) => Number(x[1]))); c[c.length - 1] = { ...last, id: ev.messageId, streaming: false, costUsd: ev.costUsd, latencyMs: ev.latencyMs, sources: (last.sources ?? []).filter((s: any) => cited.has(s.n)) }; return c; });
      else if (ev.type === "error") { toast("AI error", { description: ev.message, tone: "danger" }); setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], streaming: false, content: c[c.length - 1].content || `⚠️ ${ev.message}` }; return c; }); }
    }, ac.signal).catch(() => {});
    setBusy(false); qc.invalidateQueries({ queryKey: ["convs"] });
  }
  async function saveToNote(m: Msg) { const p = await api("/api/pages", { method: "POST", json: { title: m.content.split("\n")[0].replace(/^#+\s*/, "").slice(0, 80) || "AI answer", content: { type: "doc", content: (await import("@/lib/editor/markdown-client")).markdownToDoc(m.content) } } }); qc.invalidateQueries({ queryKey: ["tree"] }); toast("Saved as a note", { tone: "success" }); r.push(`/p/${p.id}`); }
  const addImage = (f: File) => { const rd = new FileReader(); rd.onload = () => setImages((s) => [...s, { mime: f.type, dataBase64: String(rd.result).split(",")[1], name: f.name }]); rd.readAsDataURL(f); };
  const modelLabel = model ?? "Auto";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <Menu><MenuTrigger asChild><button className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium hover:bg-bg-sunk"><Sparkles className="size-3.5 text-ai" />{modelLabel}<ChevronDown className="size-3 text-fg-faint" /></button></MenuTrigger>
          <MenuContent align="start" className="max-h-80 w-64 overflow-y-auto"><MenuItem onSelect={() => setModel(null)}>Auto (measured routing) {model === null && "✓"}</MenuItem><MenuSeparator />{(models?.models ?? []).map((m: any) => <MenuItem key={m.id} onSelect={() => setModel(m.id)}><span className={cn("size-1.5 rounded-full", m.provider === "openai" ? "bg-success" : "bg-ai")} /><span className="flex-1 truncate">{m.id}</span>{m.benchmark?.pass_rate != null && <span className="text-[10px] text-fg-faint">{Math.round(m.benchmark.pass_rate * 100)}%</span>}{model === m.id && "✓"}</MenuItem>)}</MenuContent></Menu>
        <div className="flex items-center rounded-md bg-bg-sunk p-0.5">{TASKS.map(([id, l]) => <button key={id} onClick={() => setTask(id)} className={cn("rounded px-1.5 py-0.5 text-[11px]", task === id ? "bg-bg-elev shadow-card font-medium" : "text-fg-muted")}>{l}</button>)}</div>
        <div className="ml-auto flex items-center gap-0.5">
          <button title={useWs ? "Using workspace sources" : "Workspace sources off"} onClick={() => setUseWs(!useWs)} className={cn("grid size-7 place-items-center rounded-md", useWs ? "text-accent" : "text-fg-faint")}><BookOpen className="size-4" /></button>
          <Menu><MenuTrigger asChild><button className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk" title="History"><History className="size-4" /></button></MenuTrigger><MenuContent className="max-h-80 w-72 overflow-y-auto">{(convs as any[]).length ? (convs as any[]).map((c: any) => <MenuItem key={c.id} onSelect={() => setConv(c.id)}><span className="flex-1 truncate">{c.title}</span>{c.id === conv && "✓"}</MenuItem>) : <div className="px-2 py-2 text-xs text-fg-muted">No conversations yet</div>}</MenuContent></Menu>
          <button onClick={() => { setConv(null); setMsgs([]); }} className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk" title="New conversation"><Plus className="size-4" /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4" aria-live="polite">
        {!msgs.length && <div className="px-2 pt-10 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-ai-soft text-ai shadow-card"><Sparkles className="size-5" /></div><p className="mt-3 text-[15px] font-semibold tracking-[-0.01em]">Ask your workspace</p><p className="mx-auto mt-1 max-w-xs text-[12.5px] leading-5 text-fg-muted">Answers cite your notes and documents. {pageId ? "This page is in context." : ""}</p><div className="mt-4 flex flex-wrap justify-center gap-1.5">{["Summarize this page", "What are my open research questions?", "Find contradictions in my notes", "Suggest next steps"].map((s) => <button key={s} onClick={() => setInput(s)} className="rounded-full border border-line bg-bg-elev px-3 py-1.5 text-[12px] text-fg-muted shadow-card transition-colors hover:border-ai/40 hover:text-fg">{s}</button>)}</div></div>}
        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} className="ml-auto w-fit max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[14px] leading-6 text-accent-fg shadow-card">{m.content}</div>
        ) : (
          <div key={i} className="group">
            <Markdown text={m.content || (m.streaming ? "…" : "")} onCite={(n) => { const s = m.sources?.find((x: any) => x.n === n); if (s?.pageId) r.push(`/p/${s.pageId}${s.blockId ? `#block-${s.blockId}` : ""}`); }} />
            {m.streaming && <span className="pulse-soft text-fg-faint">▍</span>}
            {!!m.sources?.length && <div className="mt-3"><div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Sources</div><div className="flex flex-wrap gap-1.5">{m.sources.map((s: any) => <button key={s.chunkId} title={`${s.title}${s.heading ? ` › ${s.heading}` : ""}`} onClick={() => s.pageId && r.push(`/p/${s.pageId}${s.blockId ? `#block-${s.blockId}` : ""}`)} className="cite-chip"><b>{s.n}</b><span className="max-w-[13rem] truncate">{s.icon ? `${s.icon} ` : ""}{s.title}{s.heading ? ` › ${s.heading}` : ""}</span></button>)}</div></div>}
            {!m.streaming && m.content && <div className="mt-1.5 flex items-center gap-1 text-[11px] text-fg-faint"><span>{m.model}</span>{m.latencyMs != null && <span>· {(m.latencyMs / 1000).toFixed(1)} s</span>}{m.costUsd != null && <span>· ${m.costUsd.toFixed(4)}</span>}{m.reason && <span className="hidden sm:inline">· {m.reason}</span>}<span className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100"><button className="rounded p-1 hover:bg-bg-sunk" title="Copy" onClick={() => { navigator.clipboard.writeText(m.content); toast("Copied"); }}><Copy className="size-3.5" /></button>{onInsert && <button className="rounded p-1 hover:bg-bg-sunk" title="Insert into page" onClick={() => onInsert(m.content)}><FilePlus2 className="size-3.5" /></button>}<button className="rounded p-1 hover:bg-bg-sunk" title="Save as note" onClick={() => saveToNote(m)}><FilePlus2 className="size-3.5" /></button></span></div>}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div className="border-t border-line p-2 safe-bottom">
        {images.length > 0 && <div className="mb-1 flex gap-1">{images.map((im, i) => <span key={i} className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px]">{im.name}<button onClick={() => setImages((s) => s.filter((_, j) => j !== i))}><X className="size-3" /></button></span>)}</div>}
        <div className="flex items-end gap-1 rounded-2xl border border-line bg-bg-elev p-1.5 shadow-card transition-colors focus-within:border-ai/50 focus-within:ring-4 focus-within:ring-ai/10">
          <label className="grid size-8 cursor-pointer place-items-center rounded-md text-fg-faint hover:bg-bg-sunk"><Paperclip className="size-4" /><input type="file" accept="image/*" className="hidden" onChange={(e) => { Array.from(e.target.files ?? []).forEach(addImage); e.target.value = ""; }} /></label>
          <textarea ref={ta} value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder="Ask, draft, analyse… (⏎ to send, ⇧⏎ newline)" aria-label="Message" style={{ outline: "none" }} className="max-h-40 min-h-[32px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] outline-none placeholder:text-fg-faint" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(160, el.scrollHeight) + "px"; }} />
          {busy ? <Button size="iconSm" variant="secondary" onClick={() => abort.current?.abort()}><Square /></Button> : <Button size="iconSm" variant="ai" onClick={send} disabled={!input.trim()}><Send /></Button>}
        </div>
      </div>
    </div>
  );
}
