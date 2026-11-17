"use client";
/** AI features of the research workspace. Every result is labelled AI-generated and only enters the page/notes/tasks on explicit user action. */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, GitCompare, HelpCircle, Sigma, PenLine, ShieldCheck, ListChecks, Square, FilePlus2, Copy, StickyNote, Sparkles, X } from "lucide-react";
import { useOnline } from "@/lib/client/hooks";
import { useRouter } from "next/navigation";
import { api, sse } from "@/lib/client/api";
import { Markdown } from "@/components/markdown";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { AILabel, AREA, ErrorBox, FIELD, Select, TButton, insertMarkdown, saveAsNote, copy } from "./ui";
import { refsKey, attKey } from "./ReferencesTab";
import { taskKey } from "./TasksTab";
import { cn } from "@/lib/utils";

type Feature = "synthesis" | "compare" | "question" | "equation" | "draft" | "refcheck" | "plan";
const FEATURES: { id: Feature; label: string; hint: string; icon: React.ReactNode; task: string }[] = [
  { id: "synthesis", label: "Literature synthesis", hint: "Across the page's references, abstracts and attached PDFs", icon: <BookOpen />, task: "deep" },
  { id: "compare", label: "Compare methodologies", hint: "Side-by-side of two or more references / files", icon: <GitCompare />, task: "reason" },
  { id: "question", label: "Refine research question", hint: "Sharper formulations, hypotheses, identification", icon: <HelpCircle />, task: "reason" },
  { id: "equation", label: "Explain an equation", hint: "Symbols, intuition, derivation, estimation", icon: <Sigma />, task: "reason" },
  { id: "draft", label: "Edit a section", hint: "Journal-standard revision of a selected passage", icon: <PenLine />, task: "write" },
  { id: "refcheck", label: "Check references", hint: "Flags citations that match no stored reference", icon: <ShieldCheck />, task: "reason" },
  { id: "plan", label: "Plan experiments", hint: "Structured plan with tasks you can accept", icon: <ListChecks />, task: "deep" },
];
interface Result { feature: Feature; text: string; model?: string; reason?: string; context?: any; data?: any; costUsd?: number | null; latencyMs?: number; streaming: boolean; error?: string; errorCode?: string }

export function AITab({ pageId, pageTitle }: { pageId: string; pageTitle: string }) {
  const r = useRouter(); const qc = useQueryClient(); const online = useOnline();
  const { data: refs = [] } = useQuery<any[]>({ queryKey: refsKey(pageId), queryFn: () => api(`/api/research/references?pageId=${pageId}`) });
  const { data: files = [] } = useQuery<any[]>({ queryKey: attKey(pageId), queryFn: () => api(`/api/attachments?pageId=${pageId}`) });
  const [feature, setFeature] = useState<Feature>("synthesis"); const [lang, setLang] = useState<"" | "fr" | "en">("");
  const [sel, setSel] = useState<string[]>([]); const [selFiles, setSelFiles] = useState<string[]>([]); const [question, setQuestion] = useState(""); const [latex, setLatex] = useState(""); const [text, setText] = useState(""); const [instruction, setInstruction] = useState("");
  const [res, setRes] = useState<Result | null>(null); const [accepted, setAccepted] = useState<Record<number, boolean>>({}); const [acceptBusy, setAcceptBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const busy = res?.streaming ?? false;
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const grabSelection = () => { const s = window.getSelection()?.toString().trim(); if (s) { setText(s); toast("Selection captured"); } else toast("Select text in the page first"); };
  const canRun = feature === "compare" ? sel.length + selFiles.length >= 2 : feature === "equation" ? latex.trim().length > 0 : feature === "draft" ? text.trim().length > 0 : true;
  async function run() {
    if (busy || !canRun || !online) return;
    const body: any = { feature, pageId, language: lang || null };
    if (feature === "compare") { body.referenceIds = sel; body.attachmentIds = selFiles; body.instruction = instruction || undefined; }
    if (feature === "synthesis") { body.referenceIds = sel.length ? sel : undefined; body.attachmentIds = selFiles.length ? selFiles : undefined; body.question = question || undefined; }
    if (feature === "question") body.question = question || undefined;
    if (feature === "equation") { body.latex = latex; body.instruction = instruction || undefined; }
    if (feature === "draft") { body.text = text; body.instruction = instruction || undefined; }
    if (feature === "plan") body.instruction = instruction || undefined;
    setRes({ feature, text: "", streaming: true }); setAccepted({});
    const ac = new AbortController(); abort.current = ac;
    await sse("/api/research/ai", body, (ev) => {
      if (ev.type === "meta") setRes((s) => s && { ...s, model: ev.model, reason: ev.reason, context: ev.context });
      else if (ev.type === "text") setRes((s) => s && { ...s, text: s.text + ev.delta });
      else if (ev.type === "result") setRes((s) => s && { ...s, data: ev.data });
      else if (ev.type === "done") setRes((s) => s && { ...s, streaming: false, costUsd: ev.costUsd, latencyMs: ev.latencyMs });
      else if (ev.type === "error") { toast("AI error", { description: ev.message, tone: "danger" }); setRes((s) => s && { ...s, streaming: false, error: ev.message, errorCode: ev.code }); }
    }, ac.signal).catch(() => {});
    setRes((s) => s && { ...s, streaming: false });
  }
  async function acceptTasks() {
    const items = (res?.data?.tasks ?? []).filter((_: any, i: number) => accepted[i] !== false);
    if (!items.length) return; setAcceptBusy(true);
    try { await api("/api/research/tasks", { method: "POST", json: { pageId, items: items.map((t: any) => ({ title: t.title, priority: t.priority, dueAt: t.dueInDays != null ? new Date(Date.now() + t.dueInDays * 864e5).toISOString() : null })) } }); toast(`${items.length} task${items.length > 1 ? "s" : ""} added`, { tone: "success" }); qc.invalidateQueries({ queryKey: taskKey(pageId) }); qc.invalidateQueries({ queryKey: ["research-overview"] }); }
    catch (e: any) { toast("Could not add tasks", { description: e.message, tone: "danger" }); } finally { setAcceptBusy(false); }
  }
  const f = FEATURES.find((x) => x.id === feature)!;
  const RefPicker = ({ required }: { required?: boolean }) => (
    <div className="rounded-md border border-line bg-bg p-2">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">{required ? "Select at least two" : "Restrict to (optional)"} — {sel.length + selFiles.length} selected</div>
      {!refs.length && !files.length && <div className="text-[12px] text-fg-muted">No references or files on this page yet.</div>}
      <div className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain">
        {refs.map((x) => <label key={x.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded px-1 text-[13px] hover:bg-bg-sunk md:min-h-8 md:text-[12px]"><input type="checkbox" checked={sel.includes(x.id)} onChange={() => toggle(sel, setSel, x.id)} className="size-5 shrink-0 accent-[var(--accent)] md:size-4" /><span className="max-w-[40%] shrink-0 truncate font-mono text-accent">{x.citeKey}</span><span className="min-w-0 truncate text-fg-muted">{x.title}</span>{x.attachmentId && <Badge tone="neutral">PDF</Badge>}</label>)}
        {files.filter((x) => x.hasText && !refs.some((rr) => rr.attachmentId === x.id)).map((x) => <label key={x.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded px-1 text-[13px] hover:bg-bg-sunk md:min-h-8 md:text-[12px]"><input type="checkbox" checked={selFiles.includes(x.id)} onChange={() => toggle(selFiles, setSelFiles, x.id)} className="size-5 shrink-0 accent-[var(--accent)] md:size-4" /><span className="truncate">📎 {x.filename}</span></label>)}
      </div>
    </div>
  );
  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[17rem_1fr]">
      <div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1">{FEATURES.map((x) => <button key={x.id} type="button" aria-pressed={feature === x.id} onClick={() => { setFeature(x.id); }} className={cn("flex min-h-12 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px] leading-tight md:min-h-10 md:text-[12px] [&_svg]:size-4 [&_svg]:shrink-0", feature === x.id ? "border-ai/40 bg-ai-soft text-fg" : "border-line bg-bg-elev text-fg-muted hover:bg-bg-sunk")}>{x.icon}<span className="min-w-0"><span className="block font-medium">{x.label}</span><span className="hidden truncate text-[11px] text-fg-faint lg:block">{x.hint}</span></span></button>)}</div>
        <div className="mt-2 flex items-center gap-2 text-[12px] text-fg-faint"><label htmlFor="research-ai-lang">Language</label><Select id="research-ai-lang" value={lang} onChange={(e) => setLang(e.target.value as any)}><option value="">auto</option><option value="fr">français</option><option value="en">English</option></Select><span className="ml-auto hidden md:inline">route: {f.task}</span></div>
      </div>
      <div className="min-w-0">
        <div className="rounded-lg border border-line bg-bg-elev p-3">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium [&_svg]:size-4 [&_svg]:text-ai">{f.icon}{f.label}<span className="hidden text-[12px] font-normal text-fg-faint sm:inline">— {f.hint}</span></div>
          <div className="space-y-2">
            {feature === "synthesis" && <><RefPicker /><Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Optional focus (e.g. identification of bailout effects on bank size)" className={FIELD} /></>}
            {feature === "compare" && <><RefPicker required /><Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Optional focus (e.g. identification strategy only)" className={FIELD} /></>}
            {feature === "question" && <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Your current research question (leave empty to derive it from the page)" className={cn(AREA, "min-h-[80px]")} />}
            {feature === "equation" && <><Textarea value={latex} onChange={(e) => setLatex(e.target.value)} placeholder={"LaTeX, e.g. y_{it} = \\alpha_i + \\beta' x_{it} + \\varepsilon_{it}"} className={cn(AREA, "min-h-[80px] font-mono")} /><div className="flex gap-1"><TButton variant="outline" onClick={() => { const s = window.getSelection()?.toString().trim(); if (s) setLatex(s); else toast("Select an equation in the page first"); }}>Use selection</TButton></div><Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Optional focus" className={FIELD} /></>}
            {feature === "draft" && <><Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the section to edit, or select it in the page and click “Use selection”" className={cn(AREA, "min-h-[120px]")} /><div className="flex gap-1"><TButton variant="outline" onClick={grabSelection}>Use selection</TButton>{text && <TButton variant="ghost" onClick={() => setText("")}><X /> Clear</TButton>}</div><Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Instruction (default: tighten and polish to journal standard)" className={FIELD} /></>}
            {feature === "refcheck" && <div className="text-[12px] text-fg-muted">Scans the page for <code className="font-mono">\cite{"{key}"}</code> and <i>Author (Year)</i> patterns and asks the model whether each one corresponds to a stored reference ({refs.length} on this page). Anything not matched is reported as <b>unverified</b>; no citation is ever invented.</div>}
            {feature === "plan" && <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Optional constraints (data available, deadline, compute, what is already done)" className={cn(AREA, "min-h-[72px]")} />}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">{busy ? <TButton variant="secondary" onClick={() => abort.current?.abort()}><Square /> Stop</TButton> : <TButton variant="ai" onClick={run} disabled={!canRun || !online}><Sparkles /> Run</TButton>}<span className="min-w-0 flex-1 text-[12px] text-fg-faint">{!online ? "You are offline — your inputs stay here; run when the connection is back." : !canRun ? (feature === "compare" ? "Select at least two references or files." : feature === "equation" ? "Enter the LaTeX of the equation first." : "Paste or select the passage first.") : "Output is a suggestion; nothing is written to the page until you insert it."}</span></div>
        </div>
        {res && (
          <div className="mt-3 rounded-lg border border-ai/30 bg-bg-elev">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 text-[11px] text-fg-faint"><AILabel model={res.model} />{res.context && <span>{res.context.references} refs · {res.context.attachments} files · {res.context.sources} passages</span>}{res.reason && <span className="hidden sm:inline">· {res.reason}</span>}{res.latencyMs != null && !res.streaming && <span>· {(res.latencyMs / 1000).toFixed(1)} s</span>}{res.costUsd != null && <span>· ${res.costUsd.toFixed(4)}</span>}{res.streaming && <Spinner className="ml-1 size-3" />}
              {!res.streaming && res.text && <span className="flex w-full flex-wrap gap-1 pt-1 md:ml-auto md:w-auto md:pt-0"><TButton variant="outline" onClick={() => { insertMarkdown(res.text); }}><FilePlus2 /> Insert into page</TButton><TButton variant="outline" onClick={async () => { try { const p = await saveAsNote(res.text, `${f.label} — ${pageTitle}`, res.model); qc.invalidateQueries({ queryKey: ["tree"] }); r.push(`/p/${p.id}`); } catch (e: any) { toast("Could not save the note", { description: e?.message, tone: "danger" }); } }}><StickyNote /> Save as note</TButton><TButton variant="outline" onClick={() => copy(res.text)}><Copy /> Copy</TButton></span>}
            </div>
            <div className="max-h-[60dvh] min-w-0 overflow-y-auto overscroll-contain px-3 py-2 [overflow-wrap:anywhere]">{res.text || res.streaming ? <Markdown text={res.text || "…"} /> : !res.error ? <p className="text-[13px] text-fg-muted">The model returned nothing. Run it again, or give it a more specific focus.</p> : null}{res.streaming && res.text && <span className="pulse-soft text-fg-faint">▍</span>}{res.error && !res.streaming && <ErrorBox className={res.text ? "" : "mt-0"} title={res.text ? "The answer stopped before the end" : "The AI request failed"} message={`${res.error}${res.text ? " The partial answer above is kept." : ""} Your inputs are unchanged.`} onRetry={run} />}</div>
            {res.feature === "plan" && res.data?.tasks?.length > 0 && !res.streaming && (
              <div className="border-t border-line px-3 py-2">
                <div className="mb-1 text-[12px] font-medium">Accept proposed tasks into the Tasks tab</div>
                <div className="space-y-0.5">{res.data.tasks.map((t: any, i: number) => <label key={i} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[13px] md:min-h-8 md:text-[12px]"><input type="checkbox" checked={accepted[i] !== false} onChange={(e) => setAccepted((a) => ({ ...a, [i]: e.target.checked }))} className="size-5 shrink-0 accent-[var(--accent)] md:size-4" /><span className="min-w-0 flex-1 break-words">{t.title}</span><Badge tone={t.priority === "high" ? "warning" : "neutral"}>{t.priority}</Badge>{t.dueInDays != null && <span className="text-fg-faint">~{t.dueInDays} d</span>}</label>)}</div>
                <TButton className="mt-2" onClick={acceptTasks} disabled={acceptBusy}>{acceptBusy ? <Spinner className="size-3.5" /> : <ListChecks />} Add {res.data.tasks.filter((_: any, i: number) => accepted[i] !== false).length} tasks</TButton>
              </div>
            )}
            {res.feature === "refcheck" && res.data && !res.streaming && <div className="border-t border-line px-3 py-2 text-[11px] text-fg-faint">{res.data.found} citations found · {res.data.matched} matched · <span className={res.data.unverified ? "text-warning" : ""}>{res.data.unverified} unverified</span>. Add missing references by DOI or BibTeX in the References tab.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
