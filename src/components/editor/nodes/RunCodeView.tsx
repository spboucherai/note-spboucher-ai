"use client";
/**
 * file: src/components/editor/nodes/RunCodeView.tsx
 * description: node view of the `runCode` block (SPEC §2) — a code cell whose JavaScript runs ONLY on an explicit action (the Run
 *   button or ⌘/Ctrl+Enter in the code field), never on load and never on edit, inside the throw-away sandbox of
 *   src/lib/client/sandbox.ts (opaque-origin iframe, no network, killed on timeout or Stop). The last result is stored in
 *   `output = {text, error, ms, at}` so every client can show it. Other languages are kept and displayed but cannot run here.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { Eraser, Play, ShieldCheck, Square, SquareTerminal } from "lucide-react";
import type { RunCodeAttrs, RunOutput } from "@/lib/editor/next-nodes";
import { runSandboxed, SANDBOX_DEFAULT_TIMEOUT_MS } from "@/lib/client/sandbox";
import { NodeButton, NodeFrame, useDebounced, type LeafViewProps } from "./frame";

const LANGUAGES: { value: string; label: string }[] = [
  { value: "javascript", label: "JavaScript" }, { value: "typescript", label: "TypeScript" }, { value: "python", label: "Python" }, { value: "sql", label: "SQL" }, { value: "shell", label: "Shell" },
];
const isRunnable = (language: string) => language === "javascript" || language === "js";
const validOutput = (o: unknown): o is RunOutput => !!o && typeof o === "object" && typeof (o as RunOutput).text === "string";
function outputMeta(o: RunOutput): string {
  const parts: string[] = [];
  if (Number.isFinite(o.ms)) parts.push(o.ms >= 1000 ? `${(o.ms / 1000).toFixed(2)} s` : `${Math.round(o.ms)} ms`);
  const at = typeof o.at === "string" ? new Date(o.at) : null;
  if (at && !Number.isNaN(at.getTime())) parts.push(at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  return parts.join(" · ");
}

export function RunCodeView({ attrs, update, editable, selected }: LeafViewProps<RunCodeAttrs>) {
  const language = typeof attrs.language === "string" && attrs.language ? attrs.language : "javascript";
  const stored = typeof attrs.code === "string" ? attrs.code : "";
  const output = validOutput(attrs.output) ? attrs.output : null;
  const runnable = isRunnable(language);

  // The textarea owns a draft; the attr is written a moment after typing stops. An external change (sync, undo) replaces the draft.
  const [draft, setDraft] = React.useState(stored);
  const written = React.useRef(stored);
  React.useEffect(() => { if (stored !== written.current) { written.current = stored; setDraft(stored); } }, [stored]);
  const save = useDebounced((code: string) => { if (code !== written.current) { written.current = code; update({ code }); } }, 400);

  const [running, setRunning] = React.useState(false);
  const abort = React.useRef<AbortController | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); }; }, []);
  const hintId = React.useId();

  /** Explicit user action only. */
  const run = React.useCallback(async () => {
    if (!editable || !runnable || abort.current) return;
    save.flush();
    const controller = new AbortController(); abort.current = controller; setRunning(true);
    try {
      const r = await runSandboxed(draft, { timeoutMs: SANDBOX_DEFAULT_TIMEOUT_MS, signal: controller.signal });
      if (alive.current) update({ output: { text: r.text, error: r.error, ms: r.ms, at: new Date().toISOString() } });
    } finally {
      if (abort.current === controller) abort.current = null;
      if (alive.current) setRunning(false);
    }
  }, [draft, editable, runnable, save, update]);
  const stop = () => abort.current?.abort();

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(); return; }
    if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const el = e.currentTarget; const start = el.selectionStart, end = el.selectionEnd;
      const next = `${draft.slice(0, start)}  ${draft.slice(end)}`;
      setDraft(next); save(next);
      requestAnimationFrame(() => { if (document.activeElement === el) el.setSelectionRange(start + 2, start + 2); });
    } else if (e.key === "Escape") e.currentTarget.blur(); // way out for keyboard users, since Tab indents
  };
  const known = LANGUAGES.some((l) => l.value === language);
  const rows = Math.min(24, Math.max(4, draft.split("\n").length + 1));

  return (
    <NodeFrame kind="runCode" label="Runnable code" icon={<SquareTerminal />} selected={selected}
      title={<span className="rc-hint" id={hintId}><ShieldCheck aria-hidden />Runs in an isolated sandbox without network access</span>}
      actions={editable ? (running
        ? <NodeButton label="Stop" tone="danger" text onClick={stop}><Square /></NodeButton>
        : <NodeButton label="Run code" tone="accent" text disabled={!runnable} onClick={() => void run()}><Play /></NodeButton>) : undefined}>
      <div className="rc" data-running={running ? "true" : undefined}>
        {editable ? (
          <>
            <div className="nb-toolbar">
              <label className="rc-lang"><span className="nb-meta">Language</span>
                <select className="nb-field" aria-label="Language" value={language} onChange={(e) => update({ language: e.target.value })}>
                  {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  {!known && <option value={language}>{language}</option>}
                </select>
              </label>
              <span className="nb-meta rc-note" role="note">{runnable ? "Runs only when you press Run (⌘/Ctrl + Enter)" : "Only JavaScript runs in the browser"}</span>
            </div>
            <textarea className="nb-code rc-code" aria-label="Code" aria-describedby={hintId} value={draft} rows={rows} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" data-gramm="false"
              placeholder={runnable ? "console.log(\"Hello\")" : ""} onChange={(e) => { setDraft(e.target.value); save(e.target.value); }} onBlur={() => save.flush()} onKeyDown={onKeyDown} />
          </>
        ) : (
          <>
            <div className="nb-toolbar"><span className="nb-meta">{LANGUAGES.find((l) => l.value === language)?.label ?? language}</span></div>
            <pre className="nb-code rc-code rc-code-ro" tabIndex={0} aria-label="Code">{stored}</pre>
          </>
        )}
        {running && <div className="rc-status nb-meta" role="status">Running… (stops by itself after {SANDBOX_DEFAULT_TIMEOUT_MS / 1000} s)</div>}
        {output && (
          <div className="rc-out" data-error={output.error ? "true" : undefined}>
            <div className="rc-out-head">
              <span className="rc-out-label">{output.error ? "Error" : "Output"}</span>
              <span className="nb-meta">{outputMeta(output)}</span>
              {editable && !running && <NodeButton label="Clear output" text className="rc-clear" onClick={() => update({ output: null })}><Eraser /></NodeButton>}
            </div>
            <pre className="rc-out-text" data-testid="run-output" tabIndex={0} aria-label={output.error ? "Error output" : "Output"}>{output.text === "" ? "(no output)" : output.text}</pre>
          </div>
        )}
      </div>
    </NodeFrame>
  );
}
