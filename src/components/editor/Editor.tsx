"use client";
/**
 * file: src/components/editor/Editor.tsx
 * description: the editor component (Tiptap 3). 3.0 adds, in this order of importance:
 *   1. Safety — `enableContentCheck`: a document that fails the schema check opens READ-ONLY ("newer content") and is never autosaved;
 *      unknown node types / marks / attrs are boxed and round-trip verbatim (src/lib/editor/unknown.ts).
 *   2. The Next Generation blocks (extensions/next-nodes.tsx), rich tasks, callout kinds, AI sources.
 *   3. Chrome — morphing context bar, selection bubble, block menu on the drag handle, Markdown paste, semantic zoom (outline),
 *      Living Pages reveal, commands registered into the Universal Command Center.
 *   Everything the editor emits (`onChange`, `getEditorDoc`) is the stored format: boxes are removed, nothing internal leaks.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useEditor, EditorContent, type Editor as TEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-list";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import Youtube from "@tiptap/extension-youtube";
import { Details, DetailsSummary, DetailsContent } from "@tiptap/extension-details";
import { Placeholder, CharacterCount } from "@tiptap/extensions";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Mathematics } from "@tiptap/extension-mathematics";
import FileHandler from "@tiptap/extension-file-handler";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { createLowlight, common } from "lowlight";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, Highlighter, Link2, Sparkles, Heading2, List, Quote, GripVertical, Subscript as SubIcon, Superscript as SupIcon, X, RotateCcw, FileUp, Plus, Trash2, CopyPlus, ArrowUp, ArrowDown, Link as LinkIcon, ShieldAlert, ListTree, AlignLeft, AlignCenter, AlignRight, Pilcrow, Heading1, Heading3, ListOrdered, ListChecks, Lightbulb, SquareCode, Inbox } from "lucide-react";
import { Callout, AIBlock, FileBlock, FootnoteRef, Footnote, BlockId } from "./extensions/nodes";
import { SlashCommand, slashItems } from "./extensions/slash";
import { PageMention } from "./extensions/mention";
import { RichTaskItem, type TaskChipRequest } from "./extensions/tasks";
import { NextNodes, UnknownBlock, UnknownInline, UnknownMark, XAttrs, NoteContext, noteContext, schemaInfoOf } from "./extensions/next-nodes";
import { MarkdownPaste, SemanticZoom, AtomGuard, zoomKey } from "./extensions/behaviors";
import { ContextBar } from "./ContextBar";
import { AIInline, type AIInlineState } from "./AIInline";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { MobileToolbar } from "./MobileToolbar";
import { Dialog, SheetContent, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, Popover, PopoverAnchor, PopoverContent } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useIsTouch, useKeyboardInset } from "@/lib/client/hooks";
import { uploadFile, type Uploaded } from "@/lib/client/upload";
import { registerCommands, type Command } from "@/lib/client/commands";
import { openCapture } from "@/lib/client/capture";
import { revealBlocks, semanticZoom } from "@/lib/client/motion";
import { wrapUnknown, unwrapUnknown, type UnknownReport } from "@/lib/editor/unknown";
import { docToMarkdown } from "@/lib/editor/markdown-client";
import { TASK_PRIORITIES } from "@/lib/editor/next-node-defs";
import type { PMNode } from "@/lib/editor/text";

const lowlight = createLowlight(common);
const LANGUAGES = lowlight.listLanguages().sort();
export type EditorHandle = TEditor;
export { uploadFile, type Uploaded };

/** Why a page opened read-only. `complete: false` = the editor could not even build the document (what is shown is partial): never editable. */
export interface EditorLock { reason: string; complete: boolean }
/** The document in its stored form (unknown content unboxed, nothing internal). Use this instead of `editor.getJSON()`. */
export const getEditorDoc = (editor: TEditor): PMNode => unwrapUnknown(editor.getJSON() as PMNode);
/**
 * Replace the document (remote copy, recovered draft) without emitting an edit. Unknown content is boxed first; a document that fails
 * the schema check is shown as far as possible and the editor is locked (see `EditorLock`) instead of being saved.
 */
export function setEditorDoc(editor: TEditor, content: PMNode): UnknownReport {
  const { doc, report } = wrapUnknown(content, schemaInfoOf(editor.schema)); const ctx = noteContext(editor);
  try { editor.commands.setContent(doc as never, { emitUpdate: false }); ctx.onInvalid?.(null); }
  catch (e) { ctx.onInvalid?.(invalidReason(e)); try { editor.commands.setContent(doc as never, { emitUpdate: false, errorOnInvalidContent: false }); } catch { /* keep what is on screen */ } }
  return report;
}
const invalidReason = (e: unknown) => { const c = (e as { cause?: unknown })?.cause; return (c instanceof Error ? c.message : e instanceof Error ? e.message : "invalid document").slice(0, 300); };

interface UploadJob { id: string; file: File; pos?: number; progress: number; state: "uploading" | "failed"; error?: string; abort: AbortController }

export function Editor({ content, onChange, onReady, onLock, pageId, editable = true, embedded = false, placeholder = "Write, or press “/” for blocks and “@” to link pages…", className, autofocus }: {
  content: PMNode; onChange?: (doc: PMNode, editor: TEditor) => void; onReady?: (e: TEditor) => void; /** the page opened (or became) read-only because its content cannot be edited safely by this version */ onLock?: (lock: EditorLock | null) => void;
  pageId?: string | null; editable?: boolean; /** rendered inside another block (transclusion, preview): no chrome, no commands, no reveal */ embedded?: boolean; placeholder?: string; className?: string; autofocus?: boolean;
}) {
  const [ai, setAi] = useState<AIInlineState | null>(null); const [focused, setFocused] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null); const pendingRange = useRef<{ from: number; to: number } | null>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]); const [linkOpen, setLinkOpen] = useState(false); const [linkUrl, setLinkUrl] = useState(""); const linkRange = useRef<{ from: number; to: number } | null>(null); const [zoom, setZoom] = useState<string | null>(null);
  const [lock, setLockState] = useState<EditorLock | null>(null); const lockRef = useRef<EditorLock | null>(null); const overridden = useRef(false);
  const [outline, setOutline] = useState(false); const [chip, setChip] = useState<TaskChipRequest | null>(null); const [handleMenu, setHandleMenu] = useState(false); const hovered = useRef<{ node: PMNodeT; pos: number } | null>(null);
  const isTouch = useIsTouch(); const kb = useKeyboardInset(); const onLockRef = useRef(onLock); onLockRef.current = onLock; const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const setLock = useCallback((l: EditorLock | null) => { if (l && overridden.current && l.complete) return; lockRef.current = l; setLockState(l); onLockRef.current?.(l); }, []);
  const runUpload = useCallback(async (editor: TEditor, job: UploadJob) => {
    try {
      const up = await uploadFile(job.file, pageId, { queueOffline: true, signal: job.abort.signal, onProgress: (f) => setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, progress: f } : j))) });
      const f = job.file; const node = f.type.startsWith("image/") ? { type: "image", attrs: { src: up.url, alt: up.name, title: up.name } } : { type: "fileBlock", attrs: { src: up.url, name: up.name, size: up.size, mime: up.mime, attachmentId: up.id } };
      // Insert AFTER the current selection: a freshly inserted image is a node selection, and inserting "at the selection" would replace it with the next file.
      if (job.pos != null && job.pos <= editor.state.doc.content.size) editor.chain().insertContentAt(job.pos, node).run(); else { const at = editor.state.selection.to; editor.chain().insertContentAt(at, node).setTextSelection(Math.min(at + 1, editor.state.doc.content.size + 1)).run(); }
      setJobs((js) => js.filter((j) => j.id !== job.id));
    } catch (e: any) {
      if (e?.name === "AbortError") setJobs((js) => js.filter((j) => j.id !== job.id));
      else setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, state: "failed", error: e.message } : j)));
    }
  }, [pageId]);
  const insertUploaded = useCallback((editor: TEditor, files: File[], pos?: number) => {
    for (const file of files) { const job: UploadJob = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, pos, progress: 0, state: "uploading", abort: new AbortController() }; setJobs((js) => [...js, job]); runUpload(editor, job); }
  }, [runUpload]);
  const retryJob = (j: UploadJob) => { const e = editorRef.current; if (!e) return; const fresh: UploadJob = { ...j, state: "uploading", progress: 0, error: undefined, abort: new AbortController() }; setJobs((js) => js.map((x) => (x.id === j.id ? fresh : x))); runUpload(e, fresh); };

  const slashCtx = useMemo(() => ({
    onAI: (editor: TEditor, range: { from: number; to: number }, mode: string) => { editor.chain().focus().deleteRange(range).run(); setAi({ mode, selection: mode === "write" ? "" : editor.getText(), replaceRange: null, insertAt: editor.state.selection.from, pageId }); },
    onUpload: (editor: TEditor, range: { from: number; to: number }, accept: string) => { editor.chain().focus().deleteRange(range).run(); pendingRange.current = null; if (fileInput.current) { fileInput.current.accept = accept; fileInput.current.click(); } },
    onNewPage: async (editor: TEditor, range: { from: number; to: number }, type: "page" | "database") => { editor.chain().focus().deleteRange(range).run(); const p = await fetch("/api/pages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: type === "database" ? "New database" : "New page", parentId: pageId ?? null, type: type === "database" ? "database" : "page", section: type === "database" ? "databases" : undefined }) }).then((r) => r.json()); editor.chain().focus().insertContent([{ type: "mention", attrs: { id: p.id, label: p.title } }, { type: "text", text: " " }]).run(); },
  }), [pageId]);
  const extensions = useMemo(() => {
    // read once, on the client, when the editor is built (the hook value is still the server snapshot during hydration)
    const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    return [
      // StarterKit already bundles dropcursor, gapcursor and trailingNode (they were registered twice before 3.0)
      StarterKit.configure({ codeBlock: false, dropcursor: { color: "var(--accent)", width: 2 }, link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer" } }, heading: { levels: [1, 2, 3] } }),
      TaskList, RichTaskItem.configure({ nested: true, onEditChips: (req) => setChip(req) }),
      Table.configure({ resizable: true, lastColumnResizable: false }), TableRow, TableHeader, TableCell,
      Image.configure({ inline: false, allowBase64: false, resize: coarse || !editable ? false : { enabled: true, directions: ["left", "right"], minWidth: 96, minHeight: 48, alwaysPreserveAspectRatio: true } }), Highlight.configure({ multicolor: false }), Subscript, Superscript, TextAlign.configure({ types: ["heading", "paragraph"] }),
      Youtube.configure({ nocookie: true, width: 640, height: 360 }),
      Details.configure({ persist: true, HTMLAttributes: { class: "details" } }), DetailsSummary, DetailsContent,
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : node.type.name === "detailsSummary" ? "Toggle title" : placeholder), includeChildren: false }),
      CharacterCount,
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" }),
      Mathematics.configure({ katexOptions: { throwOnError: false }, inlineOptions: { onClick: (node, pos) => { const latex = window.prompt("Inline LaTeX", node.attrs.latex); if (latex != null) editorRef.current?.chain().setNodeSelection(pos).updateInlineMath({ latex }).focus().run(); } }, blockOptions: { onClick: (node, pos) => { const latex = window.prompt("Block LaTeX", node.attrs.latex); if (latex != null) editorRef.current?.chain().setNodeSelection(pos).updateBlockMath({ latex }).focus().run(); } } }),
      FileHandler.configure({ allowedMimeTypes: undefined, onDrop: (editor, files, pos) => { insertUploaded(editor, files, pos); }, onPaste: (editor, files) => { insertUploaded(editor, files); } }),
      Callout, AIBlock, FileBlock, FootnoteRef, Footnote, PageMention,
      ...NextNodes, UnknownBlock, UnknownInline, UnknownMark, NoteContext.configure({ pageId: pageId ?? null }),
      BlockId, XAttrs, MarkdownPaste, SemanticZoom, AtomGuard,
      SlashCommand.configure({ ctx: slashCtx }),
    ];
  }, [pageId, placeholder, insertUploaded, slashCtx, editable]);

  // Unknown content is boxed before it reaches ProseMirror (which would drop it silently).
  const prepared = useMemo(() => { try { return wrapUnknown(content, schemaInfoOf(getSchema(extensions))); } catch { return { doc: content, report: { nodes: [], marks: [], attrs: [] } as UnknownReport }; } /* the initial content only: later copies go through setEditorDoc */ /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const created = useRef(false);
  const editorRef = useRef<TEditor | null>(null);
  const editor = useEditor({ extensions, content: prepared.doc as any, editable, immediatelyRender: false, autofocus: autofocus ? "end" : false,
    // A document that fails the schema check is NEVER replaced by an emptied one and saved: it opens read-only (lock) and nothing is emitted.
    enableContentCheck: true,
    onContentError: ({ editor: ed, error }) => {
      if (created.current) { toast("That content could not be inserted", { description: "It does not fit at this place in the page.", tone: "danger" }); return; } // an insert that failed, not the page itself
      let complete = false; try { ed.schema.nodeFromJSON(prepared.doc); complete = true; } catch { /* the document cannot even be built: what is shown is the empty fallback */ }
      setLock({ reason: invalidReason(error), complete });
    },
    editorProps: { attributes: { class: "ProseMirror", spellcheck: "true", "aria-label": "Page content", role: "textbox", "aria-multiline": "true" }, scrollThreshold: { top: 72, bottom: 132, left: 0, right: 0 }, scrollMargin: { top: 72, bottom: 132, left: 0, right: 0 }, handleClickOn: (_v, _pos, node, _np, ev) => { if (node.type.name === "image" && !editable) { setZoom(node.attrs.src); ev.preventDefault(); return true; } return false; }, handleKeyDown: (_v, e) => { if ((e.metaKey || e.ctrlKey) && e.key === "j") { e.preventDefault(); openAIForSelection(); return true; } return false; } },
    onUpdate: ({ editor }) => { if (lockRef.current) return; onChangeRef.current?.(getEditorDoc(editor), editor); },
    onCreate: ({ editor }) => { created.current = true; editorRef.current = editor; noteContext(editor).onInvalid = (reason) => setLock(reason ? { reason, complete: true } : null); onReady?.(editor); if (editable && !embedded) revealBlocks(editor.view.dom); },
    onFocus: () => setFocused(true), onBlur: () => setTimeout(() => setFocused(false), 150) });
  useEffect(() => { editorRef.current = editor; }, [editor]);
  const canEdit = editable && !lock && !outline;
  useEffect(() => { if (editor && editor.isEditable !== canEdit) editor.setEditable(canEdit); }, [editor, canEdit]);

  const openAIForSelection = useCallback((mode = "custom") => {
    const e = editorRef.current; if (!e || lockRef.current) return;
    const { from, to } = e.state.selection; const sel = e.state.doc.textBetween(from, to, "\n");
    setAi({ mode, selection: sel || e.getText(), replaceRange: sel ? { from, to } : null, insertAt: to, pageId });
  }, [pageId]);

  /** Capture the selected text to the inbox as a `selection` capture that remembers the page and block it comes from (SPEC §4.12). */
  const captureSelection = useCallback(() => {
    const e = editorRef.current; if (!e) return; const { from, to, $from } = e.state.selection; const sel = e.state.doc.textBetween(from, to, "\n").trim();
    if (!sel) { toast("Select some text first"); return; }
    const blockId = $from.depth > 0 ? ($from.node(1).attrs.id as string | null | undefined) : null;
    openCapture({ origin: "selection", text: sel.slice(0, 50_000), sourceUrl: pageId ? `/p/${pageId}${blockId ? `#block-${blockId}` : ""}` : undefined, sourceTitle: typeof document !== "undefined" ? document.querySelector<HTMLTextAreaElement>("[data-page-title]")?.value?.trim().slice(0, 80) || undefined : undefined });
  }, [pageId]);
  const setLink = useCallback(() => {
    const e = editorRef.current; if (!e) return; const { from, to } = e.state.selection; linkRange.current = { from, to };
    setLinkUrl((e.getAttributes("link").href as string | undefined) ?? ""); setLinkOpen(true);
  }, []);
  const applyLink = useCallback((raw: string | null) => {
    const e = editorRef.current; const r = linkRange.current; setLinkOpen(false); if (!e || !r) return;
    const ch = e.chain().focus().setTextSelection(r);
    if (raw === null || !raw.trim()) { ch.extendMarkRange("link").unsetLink().run(); return; }
    let href = raw.trim(); if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("/")) href = `https://${href}`;
    if (/^\s*(javascript|vbscript|data):/i.test(href)) { toast("That link type is not allowed", { tone: "danger" }); return; }
    if (r.from === r.to && !e.isActive("link")) ch.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run(); else ch.extendMarkRange("link").setLink({ href }).run();
  }, []);
  const pick = useCallback((accept: string, capture?: boolean) => { const el = fileInput.current; if (!el) return; el.accept = accept; if (capture) el.setAttribute("capture", "environment"); else el.removeAttribute("capture"); el.click(); }, []);

  // 7 — Semantic zoom between the full text (level 3) and the outline (level 2): cross-dissolve that keeps the reader's place.
  const setZoomLevel = useCallback((toOutline: boolean, jumpTo?: HTMLElement | null) => {
    const e = editorRef.current; if (!e) return; const scroller = document.getElementById("main-scroll");
    void semanticZoom(e.view.dom as HTMLElement, scroller, () => { e.view.dispatch(e.state.tr.setMeta(zoomKey, toOutline ? 2 : 3).setMeta("addToHistory", false)); setOutline(toOutline); })
      .then(() => { if (jumpTo?.isConnected) jumpTo.scrollIntoView({ block: "start", behavior: "auto" }); });
  }, []);

  const outlineRef = useRef(false); outlineRef.current = outline;
  // Universal Command Center: the main editor of a page offers its blocks and actions in ⌘K while it is mounted.
  useEffect(() => {
    if (!editor || embedded || !editable || !pageId) return;
    const here = () => { const { from, to } = editor.state.selection; return { from, to: from === to ? to : to }; };
    const live = () => editor.isEditable && !lockRef.current;
    const inserts: Command[] = slashItems(slashCtx)("").filter((i) => i.group !== "AI").map((i) => ({ id: `editor.insert.${i.id}`, group: "Insert", title: `Insert ${i.title.toLowerCase()}`, keywords: `${i.title} ${(i as { keywords?: string }).keywords ?? ""} ${i.group ?? ""} block`, hint: i.hint, icon: "plus", when: live, run: () => { editor.commands.focus(); (i.data as (e: TEditor, r: { from: number; to: number }) => void)(editor, { from: here().from, to: here().from }); } }));
    const cmds: Command[] = [...inserts,
      { id: "editor.undo", group: "Editor", title: "Undo", shortcut: "⌘Z", icon: "undo", when: () => live() && editor.can().undo(), run: () => { editor.chain().focus().undo().run(); } },
      { id: "editor.redo", group: "Editor", title: "Redo", shortcut: "⌘⇧Z", icon: "redo", when: () => live() && editor.can().redo(), run: () => { editor.chain().focus().redo().run(); } },
      { id: "editor.zoom.outline", group: "View", title: "Zoom out to the outline", keywords: "semantic zoom outline headings plan table of contents", icon: "list-tree", when: () => !outlineRef.current, run: () => setZoomLevel(true) },
      { id: "editor.zoom.full", group: "View", title: "Zoom in to the full text", keywords: "semantic zoom full text", icon: "list-tree", when: () => outlineRef.current, run: () => setZoomLevel(false) },
      { id: "editor.copy.markdown", group: "Page", title: "Copy the page as Markdown", keywords: "export markdown copy md", icon: "copy", run: async () => { try { await navigator.clipboard.writeText(docToMarkdown(getEditorDoc(editor))); toast("Markdown copied"); } catch { toast("Copy is not allowed here", { tone: "danger" }); } } },
      { id: "editor.ai.selection", group: "AI", title: "AI on the selection", shortcut: "⌘J", icon: "sparkles", when: live, run: () => openAIForSelection("custom") },
      { id: "editor.capture.selection", group: "Editor", title: "Capture the selection to the inbox", keywords: "capture selection quote extract inbox", icon: "inbox", priority: 2, when: () => !editor.state.selection.empty, run: () => captureSelection() },
    ];
    return registerCommands(cmds);
  }, [editor, embedded, editable, pageId, slashCtx, setZoomLevel, openAIForSelection, captureSelection]);
  // Block menu on the drag handle
  const blockAct = useCallback((act: "delete" | "duplicate" | "up" | "down" | "link" | "below" | { turn: string }) => {
    const e = editorRef.current; const h = hovered.current; if (!e || !h) return; const node = e.state.doc.nodeAt(h.pos); if (!node) return; const end = h.pos + node.nodeSize;
    if (act === "delete") e.chain().focus().deleteRange({ from: h.pos, to: end }).run();
    else if (act === "duplicate") { const json = node.toJSON(); if (json.attrs) json.attrs = { ...json.attrs, id: null }; e.chain().focus().insertContentAt(end, json).run(); }
    else if (act === "below") e.chain().focus().insertContentAt(end, { type: "paragraph" }).setTextSelection(end + 1).insertContent("/").run();
    else if (act === "link") { const id = node.attrs.id as string | undefined; if (!id) { toast("This block has no link yet", { description: "Type something in the page first." }); return; } navigator.clipboard.writeText(`${location.origin}/p/${pageId}#block-${id}`).then(() => toast("Link to this block copied"), () => toast("Copy is not allowed here", { tone: "danger" })); }
    else if (act === "up" || act === "down") {
      const $pos = e.state.doc.resolve(h.pos); const parent = $pos.parent; const index = $pos.index(); const target = act === "up" ? index - 1 : index + 1; if (target < 0 || target >= parent.childCount) return;
      const sib = parent.child(target); const tr = e.state.tr; const from = act === "up" ? h.pos - sib.nodeSize : h.pos; const a = act === "up" ? sib : node, b = act === "up" ? node : sib;
      tr.replaceWith(from, from + a.nodeSize + b.nodeSize, [b, a]); e.view.dispatch(tr.scrollIntoView()); e.commands.focus();
    } else {
      const ch = e.chain().focus().setTextSelection(h.pos + 1);
      switch (act.turn) { case "paragraph": ch.setParagraph().run(); break; case "h1": ch.setHeading({ level: 1 }).run(); break; case "h2": ch.setHeading({ level: 2 }).run(); break; case "h3": ch.setHeading({ level: 3 }).run(); break; case "bullet": ch.toggleBulletList().run(); break; case "ordered": ch.toggleOrderedList().run(); break; case "todo": ch.toggleTaskList().run(); break; case "quote": ch.toggleBlockquote().run(); break; case "code": ch.toggleCodeBlock().run(); break; case "callout": (ch as any).toggleCallout({ kind: "note", icon: "💡" }).run(); break; }
    }
  }, [pageId]);
  const setTaskAt = (patch: Record<string, unknown>) => { const e = editorRef.current; if (!e || !chip) return; const n = e.state.doc.nodeAt(chip.pos); if (!n || n.type.name !== "taskItem") return; e.view.dispatch(e.state.tr.setNodeMarkup(chip.pos, undefined, { ...n.attrs, ...patch })); };
  const chipNode = chip && editor ? editor.state.doc.nodeAt(chip.pos) : null;

  if (!editor) return <div className={cn("note-editor min-h-[40vh] pulse-soft", className)} />;
  const B = ({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) => <button type="button" title={title} aria-label={title} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn("grid size-7 place-items-center rounded-control text-fg-muted hover:bg-bg-sunk hover:text-fg [&_svg]:size-4", active && "bg-accent-soft text-accent")}>{children}</button>;
  const turnable = hovered.current ? ["paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock"].includes(hovered.current.node.type.name) : false;
  return (
    <div className={cn("note-editor relative", className)} data-locked={lock ? "true" : undefined} data-outline={outline ? "true" : undefined}>
      <input ref={fileInput} type="file" multiple className="hidden" aria-hidden tabIndex={-1} onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length && editorRef.current) insertUploaded(editorRef.current, files); e.target.value = ""; }} />
      {lock && (
        <div role="alert" data-testid="editor-lock" className="mb-3 flex items-start gap-2.5 rounded-pop border border-warning/40 bg-warning/10 p-3 text-ui leading-5">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1"><div className="font-semibold text-fg">Read-only — this page holds newer content</div>
            <div className="text-fg-muted">{lock.complete ? "Part of this page was written by a more recent version of SP Note and does not fit what this version can edit safely." : "This page was written by a more recent version of SP Note; this version cannot display all of it."} Nothing was changed and nothing will be saved from here. Reload to get the latest version of the app.</div>
            <div className="mt-2 flex flex-wrap gap-2"><Button size="xs" variant="outline" onClick={() => window.location.reload()}><RotateCcw /> Reload</Button>
              {lock.complete && editable && <Button size="xs" variant="ghost" onClick={() => { if (window.confirm("Edit this page with this version anyway?\n\nIts content is complete on screen, but it does not match what this version expects: saving may change how the unusual parts are stored. The current state stays in the version history.")) { overridden.current = true; setLock(null); } }}>Edit anyway…</Button>}</div>
          </div>
        </div>
      )}
      {outline && <div className="sz-pill glass" role="status"><ListTree className="size-4" aria-hidden /><span>Outline — click a heading to go there</span><button type="button" className="cb-btn cb-btn-text" onClick={() => setZoomLevel(false)}>Full text</button></div>}
      {canEdit && !isTouch && !embedded && <ContextBar editor={editor} languages={LANGUAGES} />}
      {canEdit && !isTouch && !embedded && (
        <DragHandle editor={editor} className="drag-handle-wrap" computePositionConfig={{ placement: "left-start" }} onNodeChange={({ node, pos }) => { if (node && !handleMenu) hovered.current = { node, pos }; }}>
          <button type="button" aria-label="Add a block below" title="Add a block below" className="drag-handle" onMouseDown={(e) => e.preventDefault()} onClick={() => blockAct("below")}><Plus className="size-4" /></button>
          <Menu open={handleMenu} onOpenChange={(o) => { setHandleMenu(o); const c = editor.commands as unknown as Record<string, (() => boolean) | undefined>; if (o) c.lockDragHandle?.(); else c.unlockDragHandle?.(); }}>
            <MenuTrigger asChild><button type="button" aria-label="Block menu — drag to move" title="Drag to move · click for the block menu" className="drag-handle cursor-grab"><GripVertical className="size-4" /></button></MenuTrigger>
            <MenuContent align="start" className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
              {turnable && <><div className="px-2 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-[0.08em] text-fg-faint">Turn into</div>
                <div className="grid grid-cols-5 gap-0.5 px-1 pb-1">{([["paragraph", "Text", <Pilcrow key="p" />], ["h1", "Heading 1", <Heading1 key="1" />], ["h2", "Heading 2", <Heading2 key="2" />], ["h3", "Heading 3", <Heading3 key="3" />], ["bullet", "Bulleted list", <List key="b" />], ["ordered", "Numbered list", <ListOrdered key="o" />], ["todo", "To-do list", <ListChecks key="t" />], ["quote", "Quote", <Quote key="q" />], ["callout", "Callout", <Lightbulb key="c" />], ["code", "Code block", <SquareCode key="k" />]] as const).map(([id, label, icon]) => <button key={id} type="button" title={label} aria-label={`Turn into ${label}`} className="icon-btn" onClick={() => { blockAct({ turn: id }); setHandleMenu(false); }}>{icon}</button>)}</div><MenuSeparator /></>}
              <MenuItem onSelect={() => blockAct("duplicate")}><CopyPlus /> Duplicate</MenuItem>
              <MenuItem onSelect={() => blockAct("link")}><LinkIcon /> Copy link to block</MenuItem>
              <MenuItem onSelect={() => blockAct("up")}><ArrowUp /> Move up</MenuItem>
              <MenuItem onSelect={() => blockAct("down")}><ArrowDown /> Move down</MenuItem>
              <MenuSeparator /><MenuItem danger onSelect={() => blockAct("delete")}><Trash2 /> Delete</MenuItem>
            </MenuContent>
          </Menu>
        </DragHandle>
      )}
      {canEdit && !isTouch && (
        <BubbleMenu editor={editor} shouldShow={({ editor, state }) => !state.selection.empty && !editor.isActive("codeBlock") && !editor.isActive("image") && !("node" in state.selection)} options={{ placement: "top", offset: 8 }}>
          <div className="flex items-center gap-0.5 rounded-pop border border-line bg-bg-elev p-1 shadow-pop fade-up" role="toolbar" aria-label="Formatting">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => openAIForSelection("custom")} className="mr-1 flex h-7 items-center gap-1 rounded-control bg-ai-soft px-2 text-[12px] font-medium text-ai hover:bg-ai/20"><Sparkles className="size-3.5" /> AI</button>
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
            <span className="mx-0.5 h-5 w-px bg-line" />
            {!embedded && <B title="Capture selection" onClick={captureSelection}><Inbox /></B>}
            <B title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft /></B>
            <B title="Align centre" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter /></B>
            <B title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight /></B>
          </div>
        </BubbleMenu>
      )}
      <div onClickCapture={outline ? (e) => { const h = (e.target as HTMLElement).closest?.("h1,h2,h3") as HTMLElement | null; if (h) { e.preventDefault(); e.stopPropagation(); setZoomLevel(false, h); } } : undefined}><EditorContent editor={editor} /></div>
      {jobs.length > 0 && <ul aria-label="Uploads" className="mt-3 space-y-1.5">{jobs.map((j) => <li key={j.id} className={cn("flex items-center gap-2 rounded-lg border bg-bg-elev px-3 py-2 text-[13px]", j.state === "failed" ? "border-danger/40" : "border-line")}>
        <FileUp className="size-4 shrink-0 text-fg-muted" /><div className="min-w-0 flex-1"><div className="truncate">{j.file.name}</div>{j.state === "uploading" ? <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-sunk" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.progress * 100)} aria-label={`Uploading ${j.file.name}`}><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(3, Math.round(j.progress * 100))}%` }} /></div> : <div className="text-[12px] text-danger-text">{j.error}</div>}</div>
        {j.state === "uploading" ? <><span className="tabular-nums text-[12px] text-fg-faint">{Math.round(j.progress * 100)}%</span><button type="button" aria-label={`Cancel upload of ${j.file.name}`} onClick={() => j.abort.abort()} className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk"><X className="size-4" /></button></> : <><button type="button" onClick={() => retryJob(j)} className="flex h-9 items-center gap-1 rounded-md px-2 font-medium text-accent"><RotateCcw className="size-4" />Retry</button><button type="button" aria-label="Dismiss" onClick={() => setJobs((js) => js.filter((x) => x.id !== j.id))} className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk"><X className="size-4" /></button></>}
      </li>)}</ul>}
      {canEdit && isTouch && (focused || linkOpen) && !ai && <MobileToolbar editor={editor} inset={kb} onLink={setLink} onPick={pick} onAI={() => openAIForSelection("custom")} onViewImage={setZoom} />}
      <Popover open={chip !== null} onOpenChange={(o) => { if (!o) setChip(null); }}>
        {chip && <PopoverAnchor virtualRef={{ current: chip.anchor }} />}
        <PopoverContent className="w-64 p-3" align="end" onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()} aria-label="Task details">
          <label className="block text-micro font-semibold uppercase tracking-[0.08em] text-fg-faint">Due date<input type="date" aria-label="Due date" className="nb-field mt-1 block w-full" value={(chipNode?.attrs.due as string | null) ?? ""} onChange={(e) => setTaskAt({ due: e.target.value || null })} /></label>
          <div className="mt-3 text-micro font-semibold uppercase tracking-[0.08em] text-fg-faint">Priority</div>
          <div className="mt-1 flex gap-1" role="group" aria-label="Priority">{TASK_PRIORITIES.map((p) => <button key={p} type="button" aria-pressed={chipNode?.attrs.priority === p} onClick={() => setTaskAt({ priority: chipNode?.attrs.priority === p ? null : p })} className={cn("cb-btn cb-btn-text flex-1 justify-center border border-line", chipNode?.attrs.priority === p && "is-active")}>{p[0].toUpperCase() + p.slice(1)}</button>)}</div>
          <div className="mt-3 flex justify-between"><Button size="xs" variant="ghost" onClick={() => setTaskAt({ due: null, priority: null })}>Clear</Button><Button size="xs" onClick={() => setChip(null)}>Done</Button></div>
        </PopoverContent>
      </Popover>
      <Dialog open={linkOpen} onOpenChange={(o) => { if (!o) { setLinkOpen(false); editorRef.current?.commands.focus(); } }}>
        <SheetContent title="Link" description="Paste or type an address. The selected text becomes the link.">
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); applyLink(linkUrl); }}>
            <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} aria-label="Link address" placeholder="https://…" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" autoFocus className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-[16px] outline-none focus:border-accent/60" />
            <div className="flex gap-2">{editor.isActive("link") && <Button type="button" variant="outline" className="h-11" onClick={() => applyLink(null)}>Remove link</Button>}<Button type="submit" className="h-11 flex-1">Apply</Button></div>
          </form>
        </SheetContent>
      </Dialog>
      <Dialog open={zoom !== null} onOpenChange={(o) => { if (!o) setZoom(null); }}>
        <SheetContent title="Image" className="sm:w-[min(72rem,calc(100vw-2rem))]">{zoom && <><div className="max-h-[70dvh] overflow-auto rounded-lg bg-bg-sunk" style={{ touchAction: "pinch-zoom pan-x pan-y" }}><img src={zoom} alt="" className="mx-auto block h-auto max-w-none" style={{ width: "100%" }} /></div><div className="mt-3 flex gap-2"><a href={zoom} target="_blank" rel="noopener" className="flex h-11 flex-1 items-center justify-center rounded-lg border border-line text-[14px] font-medium">Open original</a><a href={zoom} download className="flex h-11 flex-1 items-center justify-center rounded-lg border border-line text-[14px] font-medium">Download</a></div></>}</SheetContent>
      </Dialog>
      {ai && <AIInline state={ai} editor={editor} onClose={() => setAi(null)} />}
    </div>
  );
}
