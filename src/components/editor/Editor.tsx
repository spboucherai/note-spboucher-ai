"use client";
import { useEditor, EditorContent, type Editor as TEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import Youtube from "@tiptap/extension-youtube";
import { Details, DetailsSummary, DetailsContent } from "@tiptap/extension-details";
import { Placeholder, CharacterCount, Dropcursor, Gapcursor, TrailingNode } from "@tiptap/extensions";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Mathematics } from "@tiptap/extension-mathematics";
import FileHandler from "@tiptap/extension-file-handler";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { createLowlight, common } from "lowlight";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, Highlighter, Link2, Sparkles, Heading2, List, Quote, GripVertical, Subscript as SubIcon, Superscript as SupIcon, Heading1, ListChecks, ListOrdered, Undo2, Redo2, Image as ImageIcon, Table as TableIcon, IndentDecrease, IndentIncrease, Keyboard } from "lucide-react";
import { Callout, AIBlock, FileBlock, FootnoteRef, Footnote, BlockId } from "./extensions/nodes";
import { SlashCommand } from "./extensions/slash";
import { PageMention } from "./extensions/mention";
import { AIInline, type AIInlineState } from "./AIInline";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import type { PMNode } from "@/lib/editor/text";

const lowlight = createLowlight(common);
export type EditorHandle = TEditor;

export function uploadFile(file: File, pageId?: string | null): Promise<{ id: string; url: string; name: string; size: number; mime: string }> {
  const fd = new FormData(); fd.append("file", file); if (pageId) fd.append("pageId", pageId);
  return fetch("/api/attachments", { method: "POST", body: fd }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Upload failed"); return j; });
}

export function Editor({ content, onChange, onReady, pageId, editable = true, placeholder = "Write, or press “/” for blocks and “@” to link pages…", className, autofocus }: { content: PMNode; onChange?: (doc: PMNode, editor: TEditor) => void; onReady?: (e: TEditor) => void; pageId?: string | null; editable?: boolean; placeholder?: string; className?: string; autofocus?: boolean }) {
  const [ai, setAi] = useState<AIInlineState | null>(null); const [focused, setFocused] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null); const pendingRange = useRef<{ from: number; to: number } | null>(null);
  const insertUploaded = useCallback(async (editor: TEditor, files: File[], pos?: number) => {
    for (const f of files) {
      try {
        const up = await uploadFile(f, pageId);
        const node = f.type.startsWith("image/") ? { type: "image", attrs: { src: up.url, alt: up.name, title: up.name } } : { type: "fileBlock", attrs: { src: up.url, name: up.name, size: up.size, mime: up.mime, attachmentId: up.id } };
        if (pos != null) editor.chain().focus().insertContentAt(pos, node).run(); else editor.chain().focus().insertContent(node).run();
      } catch (e: any) { toast("Upload failed", { description: e.message, tone: "danger" }); }
    }
  }, [pageId]);

  const extensions = useMemo(() => [
    StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer" } }, heading: { levels: [1, 2, 3] } }),
    TaskList, TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true, lastColumnResizable: false }), TableRow, TableHeader, TableCell,
    Image.configure({ inline: false, allowBase64: false }), Highlight.configure({ multicolor: false }), Subscript, Superscript, TextAlign.configure({ types: ["heading", "paragraph"] }),
    Youtube.configure({ nocookie: true, width: 640, height: 360 }),
    Details.configure({ persist: true, HTMLAttributes: { class: "details" } }), DetailsSummary, DetailsContent,
    Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : node.type.name === "detailsSummary" ? "Toggle title" : placeholder), includeChildren: false }),
    CharacterCount, Dropcursor.configure({ color: "var(--accent)", width: 2 }), Gapcursor, TrailingNode,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" }),
    Mathematics.configure({ katexOptions: { throwOnError: false }, inlineOptions: { onClick: (node, pos) => { const latex = window.prompt("Inline LaTeX", node.attrs.latex); if (latex != null) editorRef.current?.chain().setNodeSelection(pos).updateInlineMath({ latex }).focus().run(); } }, blockOptions: { onClick: (node, pos) => { const latex = window.prompt("Block LaTeX", node.attrs.latex); if (latex != null) editorRef.current?.chain().setNodeSelection(pos).updateBlockMath({ latex }).focus().run(); } } }),
    FileHandler.configure({ allowedMimeTypes: undefined, onDrop: (editor, files, pos) => { insertUploaded(editor, files, pos); }, onPaste: (editor, files) => { insertUploaded(editor, files); } }),
    Callout, AIBlock, FileBlock, FootnoteRef, Footnote, BlockId, PageMention,
    SlashCommand.configure({ ctx: {
      onAI: (editor, range, mode) => { editor.chain().focus().deleteRange(range).run(); setAi({ mode, selection: mode === "write" ? "" : editor.getText(), replaceRange: null, insertAt: editor.state.selection.from, pageId }); },
      onUpload: (editor, range, accept) => { editor.chain().focus().deleteRange(range).run(); pendingRange.current = null; if (fileInput.current) { fileInput.current.accept = accept; fileInput.current.click(); } },
      onNewPage: async (editor, range, type) => { editor.chain().focus().deleteRange(range).run(); const p = await fetch("/api/pages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: type === "database" ? "New database" : "New page", parentId: pageId ?? null, type: type === "database" ? "database" : "page", section: type === "database" ? "databases" : undefined }) }).then((r) => r.json()); editor.chain().focus().insertContent([{ type: "mention", attrs: { id: p.id, label: p.title } }, { type: "text", text: " " }]).run(); },
    } }),
  ], [pageId, placeholder, insertUploaded]);

  const editorRef = useRef<TEditor | null>(null);
  const editor = useEditor({ extensions, content: content as any, editable, immediatelyRender: false, autofocus: autofocus ? "end" : false, editorProps: { attributes: { class: "ProseMirror", spellcheck: "true" }, handleKeyDown: (_v, e) => { if ((e.metaKey || e.ctrlKey) && e.key === "j") { e.preventDefault(); openAIForSelection(); return true; } return false; } }, onUpdate: ({ editor }) => onChange?.(editor.getJSON() as PMNode, editor), onCreate: ({ editor }) => { editorRef.current = editor; onReady?.(editor); }, onFocus: () => setFocused(true), onBlur: () => setTimeout(() => setFocused(false), 150) });
  useEffect(() => { editorRef.current = editor; }, [editor]);
  useEffect(() => { if (editor && editor.isEditable !== editable) editor.setEditable(editable); }, [editor, editable]);

  const openAIForSelection = useCallback((mode = "custom") => {
    const e = editorRef.current; if (!e) return;
    const { from, to } = e.state.selection; const sel = e.state.doc.textBetween(from, to, "\n");
    setAi({ mode, selection: sel || e.getText(), replaceRange: sel ? { from, to } : null, insertAt: to, pageId });
  }, [pageId]);

  const setLink = useCallback(() => {
    const e = editorRef.current; if (!e) return; const prev = e.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://"); if (url === null) return;
    if (!url) { e.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
    e.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, []);

  if (!editor) return <div className={cn("note-editor min-h-[40vh] pulse-soft", className)} />;
  const B = ({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) => <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn("grid size-7 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk hover:text-fg [&_svg]:size-4", active && "bg-accent-soft text-accent")}>{children}</button>;
  return (
    <div className={cn("note-editor relative", className)}>
      <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length && editorRef.current) insertUploaded(editorRef.current, files); e.target.value = ""; }} />
      {editable && (
        <DragHandle editor={editor} className="drag-handle" computePositionConfig={{ placement: "left-start" }}><GripVertical className="size-4" /></DragHandle>
      )}
      {editable && (
        <BubbleMenu editor={editor} shouldShow={({ editor, state }) => !state.selection.empty && !editor.isActive("codeBlock") && !editor.isActive("image")} options={{ placement: "top", offset: 8 }}>
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-bg-elev p-1 shadow-pop fade-up">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => openAIForSelection("custom")} className="mr-1 flex h-7 items-center gap-1 rounded-md bg-ai-soft px-2 text-[12px] font-medium text-ai hover:bg-ai/20"><Sparkles className="size-3.5" /> AI</button>
            <B title="Bold ⌘B" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></B>
            <B title="Italic ⌘I" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></B>
            <B title="Underline ⌘U" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon /></B>
            <B title="Strike" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></B>
            <B title="Highlight" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter /></B>
            <B title="Code ⌘E" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}><Code /></B>
            <B title="Subscript" active={editor.isActive("subscript")} onClick={() => editor.chain().focus().toggleSubscript().run()}><SubIcon /></B>
            <B title="Superscript" active={editor.isActive("superscript")} onClick={() => editor.chain().focus().toggleSuperscript().run()}><SupIcon /></B>
            <span className="mx-0.5 h-5 w-px bg-line" />
            <B title="Link ⌘K" active={editor.isActive("link")} onClick={setLink}><Link2 /></B>
            <B title="Heading" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></B>
            <B title="List" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></B>
            <B title="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></B>
          </div>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
      {editable && focused && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-0.5 overflow-x-auto border-t border-line bg-bg-elev/95 px-1 py-1 backdrop-blur md:hidden safe-bottom" onMouseDown={(e) => e.preventDefault()} onTouchStart={(e) => { /* keep focus */ }}>
          <button className="flex h-9 shrink-0 items-center gap-1 rounded-md bg-ai-soft px-2 text-[12px] font-medium text-ai" onClick={() => openAIForSelection("custom")}><Sparkles className="size-4" /> AI</button>
          {([
            ["Undo", <Undo2 key="u" />, () => editor.chain().focus().undo().run(), false], ["Redo", <Redo2 key="r" />, () => editor.chain().focus().redo().run(), false],
            ["Bold", <Bold key="b" />, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold")], ["Italic", <Italic key="i" />, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic")],
            ["H1", <Heading1 key="h1" />, () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 })], ["H2", <Heading2 key="h2" />, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 })],
            ["List", <List key="l" />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList")], ["Numbered", <ListOrdered key="o" />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList")], ["Checklist", <ListChecks key="c" />, () => editor.chain().focus().toggleTaskList().run(), editor.isActive("taskList")],
            ["Outdent", <IndentDecrease key="od" />, () => editor.chain().focus().liftListItem("listItem").run() || editor.chain().focus().liftListItem("taskItem").run(), false], ["Indent", <IndentIncrease key="id" />, () => editor.chain().focus().sinkListItem("listItem").run() || editor.chain().focus().sinkListItem("taskItem").run(), false],
            ["Quote", <Quote key="q" />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote")], ["Code", <Code key="cd" />, () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock")],
            ["Table", <TableIcon key="t" />, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), false], ["Image", <ImageIcon key="im" />, () => { if (fileInput.current) { fileInput.current.accept = "image/*"; fileInput.current.click(); } }, false], ["Link", <Link2 key="lk" />, setLink, editor.isActive("link")],
          ] as [string, React.ReactNode, () => void, boolean][]).map(([title, icon, fn, active]) => <button key={title} title={title} className={cn("grid size-9 shrink-0 place-items-center rounded-md text-fg-muted [&_svg]:size-[18px]", active && "bg-accent-soft text-accent")} onClick={fn}>{icon}</button>)}
        </div>
      )}
      {ai && <AIInline state={ai} editor={editor} onClose={() => setAi(null)} />}
    </div>
  );
}
