"use client";
/**
 * file: src/components/editor/ContextBar.tsx
 * description: Morphing Editor (signature motion 2) — a small glass bar pinned at the top of the editor whose content follows the
 *   block under the cursor: table tools, code language, callout kind, image size, task due date / priority. Hidden for plain text
 *   (the selection bubble covers formatting). It takes no space in the page flow (zero-height sticky anchor), re-renders only when
 *   the block context changes (`useEditorState` selector), and reads layout once per context change for the width morph.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { useEditorState, type Editor as TEditor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { BetweenHorizontalStart, BetweenHorizontalEnd, BetweenVerticalStart, BetweenVerticalEnd, Trash2, Rows3, Columns3, PanelTop, TableCellsMerge, TableCellsSplit, Copy, CalendarDays, Flag, X, Table as TableIcon, Code2, Lightbulb, Image as ImageIcon, ListChecks } from "lucide-react";
import { CALLOUT_KINDS, TASK_PRIORITIES } from "@/lib/editor/next-node-defs";
import { morphWidth } from "@/lib/client/motion";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { taskAt } from "./extensions/tasks";

export type BlockContext = "text" | "table" | "code" | "callout" | "image" | "task";
/** The block type that decides which tools are offered. Innermost special context wins (a task inside a callout is a task). */
export function blockContext(editor: TEditor): BlockContext {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection) return selection.node.type.name === "image" ? "image" : "text";
  const { $from } = selection;
  for (let d = $from.depth; d > 0; d--) { const n = $from.node(d).type.name; if (n === "codeBlock") return "code"; if (n === "taskItem") return "task"; if (n === "table") return "table"; if (n === "callout") return "callout"; }
  return "text";
}
const LABEL: Record<BlockContext, string> = { text: "Text", table: "Table", code: "Code", callout: "Callout", image: "Image", task: "Task" };
const ICON: Record<BlockContext, React.ReactNode> = { text: null, table: <TableIcon />, code: <Code2 />, callout: <Lightbulb />, image: <ImageIcon />, task: <ListChecks /> };

function B({ label, onClick, children, active, danger, text }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; danger?: boolean; text?: boolean }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn("cb-btn", text && "cb-btn-text", active && "is-active", danger && "is-danger")}>{children}</button>;
}
const Sep = () => <span aria-hidden className="cb-sep" />;

export function ContextBar({ editor, languages }: { editor: TEditor; languages: string[] }) {
  const state = useEditorState({ editor, selector: ({ editor: e }) => {
    const ctx = blockContext(e);
    // only the values the bar displays: a change of any of them re-renders the bar, nothing else does
    return { ctx, language: ctx === "code" ? (e.getAttributes("codeBlock").language as string | null) ?? "plaintext" : "", kind: ctx === "callout" ? (e.getAttributes("callout").kind as string) : "", width: ctx === "image" ? Number(e.getAttributes("image").width) || 0 : 0, task: ctx === "task" ? (() => { const t = taskAt(e.state); return t ? `${t.node.attrs.due ?? ""}|${t.node.attrs.priority ?? ""}` : "|"; })() : "" };
  } });
  // nothing shows before the user has put the cursor in the page once (a page that starts with a table must not open with a toolbar)
  const [armed, setArmed] = React.useState(editor.isFocused);
  React.useEffect(() => { if (armed) return; const on = () => setArmed(true); editor.on("focus", on); return () => { editor.off("focus", on); }; }, [editor, armed]);
  const ctx = armed ? state?.ctx ?? "text" : "text"; const bar = React.useRef<HTMLDivElement>(null); const prevWidth = React.useRef<number | null>(null); const prevCtx = React.useRef<BlockContext>("text");
  // Morph: width tween from the previous content to the new one (one layout read, only when the context changes)
  React.useLayoutEffect(() => { if (prevCtx.current !== ctx) { if (prevCtx.current !== "text" && ctx !== "text") morphWidth(bar.current, prevWidth.current); prevCtx.current = ctx; } prevWidth.current = bar.current?.offsetWidth ?? null; }, [ctx]);
  if (ctx === "text") return <div className="context-anchor" aria-hidden />;
  const c = () => editor.chain().focus();
  const setTask = (patch: Record<string, unknown>) => { const t = taskAt(editor.state); if (!t) return; editor.chain().command(({ tr }) => { tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, ...patch }); return true; }).run(); };
  const [due, priority] = (state?.task ?? "|").split("|");
  return (
    <div className="context-anchor">
      <div ref={bar} role="toolbar" aria-label={`${LABEL[ctx]} tools`} data-context={ctx} className="context-bar glass" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("select,input")) e.preventDefault(); }}>
        <span className="cb-label">{ICON[ctx]}{LABEL[ctx]}</span><Sep />
        <div key={ctx} className="morph-in flex items-center gap-0.5">
          {ctx === "table" && <>
            <B label="Insert row above" onClick={() => c().addRowBefore().run()}><BetweenHorizontalEnd /></B><B label="Insert row below" onClick={() => c().addRowAfter().run()}><BetweenHorizontalStart /></B>
            <B label="Insert column left" onClick={() => c().addColumnBefore().run()}><BetweenVerticalEnd /></B><B label="Insert column right" onClick={() => c().addColumnAfter().run()}><BetweenVerticalStart /></B><Sep />
            <B label="Toggle header row" onClick={() => c().toggleHeaderRow().run()}><PanelTop /></B><B label="Merge cells" onClick={() => c().mergeCells().run()}><TableCellsMerge /></B><B label="Split cell" onClick={() => c().splitCell().run()}><TableCellsSplit /></B><Sep />
            <B label="Delete row" danger onClick={() => c().deleteRow().run()}><Rows3 /></B><B label="Delete column" danger onClick={() => c().deleteColumn().run()}><Columns3 /></B><B label="Delete table" danger onClick={() => c().deleteTable().run()}><Trash2 /></B>
          </>}
          {ctx === "code" && <>
            <select aria-label="Code language" className="cb-select" value={state?.language || "plaintext"} onChange={(e) => editor.chain().focus().updateAttributes("codeBlock", { language: e.target.value }).run()}>{[...new Set(["plaintext", ...languages, state?.language || "plaintext"])].map((l) => <option key={l} value={l}>{l}</option>)}</select>
            <B label="Copy code" onClick={async () => { try { await navigator.clipboard.writeText(editor.state.selection.$from.parent.textContent); toast("Code copied"); } catch { toast("Copy is not allowed here", { tone: "danger" }); } }}><Copy /></B>
          </>}
          {ctx === "callout" && CALLOUT_KINDS.map((k) => <B key={k.kind} label={k.label} text active={state?.kind === k.kind} onClick={() => { const cur = editor.getAttributes("callout"); const wasDefault = CALLOUT_KINDS.some((x) => x.icon === cur.icon); editor.chain().focus().updateAttributes("callout", { kind: k.kind, ...(wasDefault ? { icon: k.icon } : {}) }).run(); }}><span aria-hidden>{k.icon}</span>{k.label}</B>)}
          {ctx === "image" && <>
            {([["Small", 0.33], ["Medium", 0.6], ["Large", 0.85]] as const).map(([name, f]) => <B key={name} label={`${name} image`} text onClick={() => { const w = Math.round((editor.view.dom as HTMLElement).clientWidth * f); editor.chain().focus().updateAttributes("image", { width: w, height: null }).run(); }}>{name}</B>)}
            <B label="Original size" text active={!state?.width} onClick={() => editor.chain().focus().updateAttributes("image", { width: null, height: null }).run()}>Full</B><Sep />
            <B label="Edit the description (alt text)" text onClick={() => { const cur = (editor.getAttributes("image").alt as string | null) ?? ""; const alt = window.prompt("Describe this image for screen readers", cur); if (alt != null) editor.chain().focus().updateAttributes("image", { alt }).run(); }}>Alt</B>
            <B label="Delete image" danger onClick={() => c().deleteSelection().run()}><Trash2 /></B>
          </>}
          {ctx === "task" && <>
            <label className="cb-field"><CalendarDays aria-hidden /><span className="sr-only">Due date</span><input type="date" aria-label="Due date" value={due || ""} onChange={(e) => setTask({ due: e.target.value || null })} /></label>
            <span className="cb-field"><Flag aria-hidden />{TASK_PRIORITIES.map((p) => <B key={p} label={`Priority ${p}`} text active={priority === p} onClick={() => setTask({ priority: priority === p ? null : p })}>{p[0].toUpperCase() + p.slice(1)}</B>)}</span>
            {(due || priority) && <B label="Clear due date and priority" onClick={() => setTask({ due: null, priority: null })}><X /></B>}
          </>}
        </div>
      </div>
    </div>
  );
}
