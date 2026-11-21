/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/editor/MobileToolbar.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
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
import { useEffect, useReducer, useState } from "react";
import type { Editor as TEditor } from "@tiptap/react";
import { Bold, Italic, Underline, Strikethrough, Code, Highlighter, Link2, Sparkles, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, Quote, Undo2, Redo2, Image as ImageIcon, Table as TableIcon, IndentDecrease, IndentIncrease, Camera, Paperclip, Plus, KeyboardOff, SquareCode, Minus, Lightbulb, AtSign, Sigma, ChevronDown, Trash2, Copy, Maximize2, Pilcrow, Columns3, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

/**
 * Editing bar for phones. It sits directly above the on-screen keyboard (lifted by the keyboard inset — iOS does not resize the layout
 * viewport), never over the line being typed (the scroll container gets a matching scroll padding), and never steals focus:
 * every control cancels pointerdown, so the selection and the system handles stay exactly where they were.
 * One scrollable row of the most used actions + a panel with everything else; the row turns contextual inside a table, a code block or on an image.
 */
export function MobileToolbar({ editor, inset, onLink, onPick, onAI, onViewImage }: { editor: TEditor; inset: number; onLink: () => void; onPick: (accept: string, capture?: boolean) => void; onAI: () => void; onViewImage: (src: string) => void }) {
  const [, tick] = useReducer((n: number) => n + 1, 0); const [panel, setPanel] = useState(false);
  useEffect(() => { editor.on("transaction", tick); return () => { editor.off("transaction", tick); }; }, [editor]);
  useEffect(() => { document.documentElement.dataset.editing = "1"; return () => { delete document.documentElement.dataset.editing; }; }, []);
  const c = () => editor.chain().focus(); const hasSel = !editor.state.selection.empty;
  const inTable = editor.isActive("table"); const inCode = editor.isActive("codeBlock"); const img = editor.isActive("image") ? (editor.getAttributes("image").src as string) : null;
  const T = ({ label, active, onTap, children, wide, disabled }: { label: string; active?: boolean; onTap: () => void; children: React.ReactNode; wide?: boolean; disabled?: boolean }) => (
    <button type="button" aria-label={label} aria-pressed={active} disabled={disabled} onPointerDown={(e) => e.preventDefault()} onClick={onTap} className={cn("grid h-11 shrink-0 place-items-center rounded-lg text-fg-muted active:bg-bg-sunk disabled:opacity-35 [&_svg]:size-5", wide ? "flex gap-1.5 px-3 text-[13px] font-medium" : "w-11", active && "bg-accent-soft text-accent")}>{children}</button>);
  const Sep = () => <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-line" />;
  const P = ({ label, icon, onTap, active }: { label: string; icon: React.ReactNode; onTap: () => void; active?: boolean }) => (
    <button type="button" aria-pressed={active} onPointerDown={(e) => e.preventDefault()} onClick={() => { onTap(); setPanel(false); }} className={cn("flex h-[4.25rem] flex-col items-center justify-center gap-1 rounded-xl border border-line bg-bg text-[11.5px] text-fg-muted active:bg-bg-sunk [&_svg]:size-5", active && "border-accent/40 bg-accent-soft text-accent")}>{icon}<span className="max-w-full truncate px-1">{label}</span></button>);
  const lift = () => editor.chain().focus().liftListItem("listItem").run() || editor.chain().focus().liftListItem("taskItem").run();
  const sink = () => editor.chain().focus().sinkListItem("listItem").run() || editor.chain().focus().sinkListItem("taskItem").run();
  const copyCode = async () => { const { $from } = editor.state.selection; const text = $from.parent.textContent; try { await navigator.clipboard.writeText(text); toast("Code copied"); } catch { toast("Copy is not allowed here", { tone: "danger" }); } };
  return (
    <div className="mobile-toolbar fixed inset-x-0 z-40 border-t border-line bg-bg-elev/97 backdrop-blur" style={{ bottom: inset }} role="toolbar" aria-label="Formatting" onPointerDown={(e) => { if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); }}>
      {panel && (
        <div className="max-h-[42dvh] overflow-y-auto overscroll-contain border-b border-line px-3 pb-3 pt-2">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Text</div>
          <div className="grid grid-cols-4 gap-2">
            <P label="Text" icon={<Pilcrow />} onTap={() => c().setParagraph().run()} active={editor.isActive("paragraph")} /><P label="Heading 1" icon={<Heading1 />} onTap={() => c().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} /><P label="Heading 2" icon={<Heading2 />} onTap={() => c().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} /><P label="Heading 3" icon={<Heading3 />} onTap={() => c().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} />
            <P label="Underline" icon={<Underline />} onTap={() => c().toggleUnderline().run()} active={editor.isActive("underline")} /><P label="Strike" icon={<Strikethrough />} onTap={() => c().toggleStrike().run()} active={editor.isActive("strike")} /><P label="Highlight" icon={<Highlighter />} onTap={() => c().toggleHighlight().run()} active={editor.isActive("highlight")} /><P label="Inline code" icon={<Code />} onTap={() => c().toggleCode().run()} active={editor.isActive("code")} />
          </div>
          <div className="mb-1.5 mt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-faint">Insert</div>
          <div className="grid grid-cols-4 gap-2">
            <P label="Numbered" icon={<ListOrdered />} onTap={() => c().toggleOrderedList().run()} active={editor.isActive("orderedList")} /><P label="Quote" icon={<Quote />} onTap={() => c().toggleBlockquote().run()} active={editor.isActive("blockquote")} /><P label="Code block" icon={<SquareCode />} onTap={() => c().toggleCodeBlock().run()} active={inCode} /><P label="Table" icon={<TableIcon />} onTap={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
            <P label="Callout" icon={<Lightbulb />} onTap={() => (c() as any).toggleCallout({ kind: "info", icon: "💡" }).run()} active={editor.isActive("callout")} /><P label="Toggle" icon={<ChevronDown />} onTap={() => c().setDetails().run()} /><P label="Divider" icon={<Minus />} onTap={() => c().setHorizontalRule().run()} /><P label="Math" icon={<Sigma />} onTap={() => { const latex = window.prompt("LaTeX", "E = mc^2"); if (latex) (c() as any).insertBlockMath({ latex }).run(); }} />
            <P label="Photo" icon={<Camera />} onTap={() => onPick("image/*", true)} /><P label="Image" icon={<ImageIcon />} onTap={() => onPick("image/*")} /><P label="File / PDF" icon={<Paperclip />} onTap={() => onPick("")} /><P label="Link page" icon={<AtSign />} onTap={() => c().insertContent("@").run()} />
          </div>
          <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => { c().insertContent("/").run(); setPanel(false); }} className="mt-2 h-11 w-full rounded-xl border border-dashed border-line-strong text-[13px] text-fg-muted">All blocks ( / )</button>
        </div>
      )}
      <div className="flex items-center gap-0.5 overflow-x-auto overscroll-x-contain px-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <T label={panel ? "Close block panel" : "More styles and blocks"} active={panel} onTap={() => setPanel((p) => !p)}><Plus className={cn("transition-transform", panel && "rotate-45")} /></T>
        {hasSel && !inCode && <T label="AI on selection" onTap={onAI} wide><Sparkles className="text-ai" /><span className="text-ai">AI</span></T>}
        <Sep />
        {img ? <>
          <T label="View full size" onTap={() => onViewImage(img)} wide><Maximize2 />View</T><T label="Delete image" onTap={() => c().deleteSelection().run()} wide><Trash2 />Delete</T>
        </> : inTable ? <>
          <T label="Add row below" onTap={() => c().addRowAfter().run()} wide><Rows3 />+ Row</T><T label="Add column right" onTap={() => c().addColumnAfter().run()} wide><Columns3 />+ Col</T>
          <T label="Delete row" onTap={() => c().deleteRow().run()} wide>− Row</T><T label="Delete column" onTap={() => c().deleteColumn().run()} wide>− Col</T>
          <T label="Next cell" onTap={() => c().goToNextCell().run()} wide>Next ›</T><T label="Previous cell" onTap={() => c().goToPreviousCell().run()} wide>‹ Prev</T>
          <T label="Toggle header row" onTap={() => c().toggleHeaderRow().run()} wide>Header</T><T label="Delete table" onTap={() => c().deleteTable().run()} wide><Trash2 />Table</T><Sep />
          <T label="Bold" active={editor.isActive("bold")} onTap={() => c().toggleBold().run()}><Bold /></T>
        </> : inCode ? <>
          <T label="Copy code" onTap={copyCode} wide><Copy />Copy</T><T label="Leave code block" onTap={() => c().exitCode().run()} wide>Exit block</T><T label="Turn into text" onTap={() => c().toggleCodeBlock().run()} wide><Pilcrow />Text</T>
        </> : <>
          <T label="Bold" active={editor.isActive("bold")} onTap={() => c().toggleBold().run()}><Bold /></T>
          <T label="Italic" active={editor.isActive("italic")} onTap={() => c().toggleItalic().run()}><Italic /></T>
          <T label="Heading" active={editor.isActive("heading", { level: 2 })} onTap={() => c().toggleHeading({ level: 2 }).run()}><Heading2 /></T>
          <T label="Bulleted list" active={editor.isActive("bulletList")} onTap={() => c().toggleBulletList().run()}><List /></T>
          <T label="Checklist" active={editor.isActive("taskList")} onTap={() => c().toggleTaskList().run()}><ListChecks /></T>
          {(editor.isActive("listItem") || editor.isActive("taskItem")) && <><T label="Outdent" onTap={lift}><IndentDecrease /></T><T label="Indent" onTap={sink}><IndentIncrease /></T></>}
          <T label="Link" active={editor.isActive("link")} onTap={onLink}><Link2 /></T>
          <T label="Quote" active={editor.isActive("blockquote")} onTap={() => c().toggleBlockquote().run()}><Quote /></T>
          <T label="Attach photo or file" onTap={() => onPick("")}><Paperclip /></T>
        </>}
        <Sep />
        <T label="Undo" disabled={!editor.can().undo()} onTap={() => c().undo().run()}><Undo2 /></T>
        <T label="Redo" disabled={!editor.can().redo()} onTap={() => c().redo().run()}><Redo2 /></T>
        <T label="Hide keyboard" onTap={() => { setPanel(false); editor.commands.blur(); (document.activeElement as HTMLElement | null)?.blur?.(); }}><KeyboardOff /></T>
      </div>
    </div>
  );
}
