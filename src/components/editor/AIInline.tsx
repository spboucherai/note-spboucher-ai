"use client";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Sparkles, Replace, ArrowDownToLine, X, RefreshCw, Copy } from "lucide-react";
import { sse } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { markdownToDoc } from "@/lib/editor/markdown-client";
import { toast } from "@/components/ui/toast";
export interface AIInlineState { mode: string; selection: string; replaceRange: { from: number; to: number } | null; insertAt: number; pageId?: string | null }
const PRESETS: { id: string; label: string }[] = [
  { id: "rewrite", label: "Improve" }, { id: "shorten", label: "Shorten" }, { id: "expand", label: "Expand" }, { id: "fix", label: "Fix grammar" }, { id: "formal", label: "Formal" }, { id: "simplify", label: "Simplify" },
  { id: "summarize", label: "Summarize" }, { id: "translate_fr", label: "→ Français" }, { id: "translate_en", label: "→ English" }, { id: "explain_math", label: "Explain math" }, { id: "table", label: "To table" }, { id: "action_items", label: "Action items" }, { id: "continue", label: "Continue" },
];
export function AIInline({ state, editor, onClose }: { state: AIInlineState; editor: Editor; onClose: () => void }) {
  const [instruction, setInstruction] = useState(""); const [action, setAction] = useState(state.mode === "custom" || state.mode === "write" ? "" : state.mode);
  const [out, setOut] = useState(""); const [busy, setBusy] = useState(false); const [meta, setMeta] = useState<{ model?: string; costUsd?: number | null; latencyMs?: number } | null>(null);
  const abort = useRef<AbortController | null>(null); const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (action && action !== "write") run(action); else inputRef.current?.focus(); /* eslint-disable-next-line */ }, []);
  async function run(act: string, instr?: string) {
    abort.current?.abort(); const ac = new AbortController(); abort.current = ac; setBusy(true); setOut(""); setMeta(null); setAction(act);
    const text = act === "write" || (act === "custom" && !state.selection) ? "" : state.selection;
    await sse("/api/ai/action", { action: act === "write" ? "custom" : act, text: text || "(empty — generate new content from the instruction)", instruction: instr ?? instruction }, (ev) => { if (ev.type === "text") setOut((s) => s + ev.delta); else if (ev.type === "meta") setMeta({ model: ev.model }); else if (ev.type === "done") setMeta((m) => ({ ...m, costUsd: ev.costUsd, latencyMs: ev.latencyMs })); else if (ev.type === "error") toast("AI error", { description: ev.message, tone: "danger" }); }, ac.signal);
    setBusy(false);
  }
  function apply(mode: "replace" | "insert") {
    const nodes = markdownToDoc(out);
    const wrapped = [{ type: "aiBlock", attrs: { model: meta?.model ?? null, prompt: (action || "custom") + (instruction ? `: ${instruction}` : ""), at: new Date().toISOString() }, content: nodes }];
    const isInlineOnly = nodes.length === 1 && nodes[0].type === "paragraph";
    if (mode === "replace" && state.replaceRange) editor.chain().focus().insertContentAt(state.replaceRange, isInlineOnly ? nodes : wrapped).run();
    else editor.chain().focus().insertContentAt(state.insertAt, wrapped).run();
    onClose();
  }
  return (
    <div className="fixed inset-x-2 bottom-2 z-40 mx-auto max-w-2xl rounded-xl border border-ai/30 bg-bg-elev shadow-pop fade-up md:absolute md:inset-x-auto md:bottom-auto md:left-0 md:right-0 md:top-0 md:mx-auto safe-bottom" onKeyDown={(e) => { if (e.key === "Escape") { abort.current?.abort(); onClose(); } }}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Sparkles className="size-4 text-ai" />
        <input ref={inputRef} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={state.selection ? "Tell AI what to do with the selection…" : "What should AI write here?"} className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-faint" onKeyDown={(e) => { if (e.key === "Enter" && instruction.trim()) run(state.selection ? "custom" : "write", instruction); }} />
        {busy ? <Button size="xs" variant="ghost" onClick={() => abort.current?.abort()}>Stop</Button> : <Button size="xs" variant="ai" onClick={() => run(state.selection ? "custom" : "write", instruction)} disabled={!instruction.trim()}>Run</Button>}
        <button className="rounded p-1 text-fg-faint hover:bg-bg-sunk" onClick={() => { abort.current?.abort(); onClose(); }}><X className="size-4" /></button>
      </div>
      {state.selection && !out && !busy && (
        <div className="flex flex-wrap gap-1 px-3 py-2">{PRESETS.map((p) => <button key={p.id} onClick={() => run(p.id)} className="rounded-md border border-line bg-bg px-2 py-1 text-[12px] hover:bg-bg-sunk">{p.label}</button>)}</div>
      )}
      {(out || busy) && (
        <div className="max-h-[45vh] overflow-y-auto px-4 py-3"><Markdown text={out || "…"} className="prose-md" />{busy && <span className="pulse-soft text-fg-faint">▍</span>}</div>
      )}
      {out && !busy && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          {state.replaceRange && <Button size="sm" onClick={() => apply("replace")}><Replace /> Replace</Button>}
          <Button size="sm" variant={state.replaceRange ? "secondary" : "default"} onClick={() => apply("insert")}><ArrowDownToLine /> Insert below</Button>
          <Button size="sm" variant="ghost" onClick={() => run(action || "custom")}><RefreshCw /> Retry</Button>
          <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(out); toast("Copied"); }}><Copy /> Copy</Button>
          <span className="ml-auto text-[11px] text-fg-faint">{meta?.model}{meta?.latencyMs ? ` · ${(meta.latencyMs / 1000).toFixed(1)} s` : ""}{meta?.costUsd != null ? ` · $${meta.costUsd.toFixed(4)}` : ""}</span>
        </div>
      )}
    </div>
  );
}
