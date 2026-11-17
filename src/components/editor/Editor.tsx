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
import { MobileToolbar } from "./MobileToolbar";
import { Dialog, SheetContent } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useIsTouch, useKeyboardInset } from "@/lib/client/hooks";
import { X, RotateCcw, FileUp } from "lucide-react";
import type { PMNode } from "@/lib/editor/text";

const lowlight = createLowlight(common);
export type EditorHandle = TEditor;

export interface Uploaded { id: string; url: string; name: string; size: number; mime: string }
/** Upload with real progress and cancellation (XMLHttpRequest: fetch has no upload progress). Rejects with a readable message. */
export function uploadFile(file: File, pageId?: string | null, opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<Uploaded> {
  return new Promise((resolve, reject) => {
    const fd = new FormData(); fd.append("file", file); if (pageId) fd.append("pageId", pageId);
    const x = new XMLHttpRequest(); x.open("POST", "/api/attachments"); x.responseType = "json"; x.withCredentials = true;
    x.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total); };
    x.onload = () => { if (x.status === 401) { window.location.assign("/login"); return reject(new Error("Sign-in required")); } if (x.status >= 200 && x.status < 300 && x.response) resolve(x.response as Uploaded); else reject(new Error(x.response?.error ?? (x.status === 413 ? "File too large (200 MB max)" : `Upload failed (${x.status})`))); };
    x.onerror = () => reject(new Error("Network lost during upload")); x.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    opts.signal?.addEventListener("abort", () => x.abort());
    x.send(fd);
  });
}
interface UploadJob { id: string; file: File; pos?: number; progress: number; state: "uploading" | "failed"; error?: string; abort: AbortController }

export function Editor({ content, onChange, onReady, pageId, editable = true, placeholder = "Write, or press “/” for blocks and “@” to link pages…", className, autofocus }: { content: PMNode; onChange?: (doc: PMNode, editor: TEditor) => void; onReady?: (e: TEditor) => void; pageId?: string | null; editable?: boolean; placeholder?: string; className?: string; autofocus?: boolean }) {
  const [ai, setAi] = useState<AIInlineState | null>(null); const [focused, setFocused] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null); const pendingRange = useRef<{ from: number; to: number } | null>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]); const [linkOpen, setLinkOpen] = useState(false); const [linkUrl, setLinkUrl] = useState(""); const linkRange = useRef<{ from: number; to: number } | null>(null); const [zoom, setZoom] = useState<string | null>(null);
  const isTouch = useIsTouch(); const kb = useKeyboardInset();
  const runUpload = useCallback(async (editor: TEditor, job: UploadJob) => {
    try {
      const up = await uploadFile(job.file, pageId, { signal: job.abort.signal, onProgress: (f) => setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, progress: f } : j))) });
      const f = job.file; const node = f.type.startsWith("image/") ? { type: "image", attrs: { src: up.url, alt: up.name, title: up.name } } : { type: "fileBlock", attrs: { src: up.url, name: up.name, size: up.size, mime: up.mime, attachmentId: up.id } };
      if (job.pos != null && job.pos <= editor.state.doc.content.size) editor.chain().insertContentAt(job.pos, node).run(); else editor.chain().focus().insertContent(node).run();
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
  const editor = useEditor({ extensions, content: content as any, editable, immediatelyRender: false, autofocus: autofocus ? "end" : false, editorProps: { attributes: { class: "ProseMirror", spellcheck: "true", "aria-label": "Page content", role: "textbox", "aria-multiline": "true" }, scrollThreshold: { top: 72, bottom: 132, left: 0, right: 0 }, scrollMargin: { top: 72, bottom: 132, left: 0, right: 0 }, handleClickOn: (_v, _pos, node, _np, ev) => { if (node.type.name === "image" && !editable) { setZoom(node.attrs.src); ev.preventDefault(); return true; } return false; }, handleKeyDown: (_v, e) => { if ((e.metaKey || e.ctrlKey) && e.key === "j") { e.preventDefault(); openAIForSelection(); return true; } return false; } }, onUpdate: ({ editor }) => onChange?.(editor.getJSON() as PMNode, editor), onCreate: ({ editor }) => { editorRef.current = editor; onReady?.(editor); }, onFocus: () => setFocused(true), onBlur: () => setTimeout(() => setFocused(false), 150) });
  useEffect(() => { editorRef.current = editor; }, [editor]);
  useEffect(() => { if (editor && editor.isEditable !== editable) editor.setEditable(editable); }, [editor, editable]);

  const openAIForSelection = useCallback((mode = "custom") => {
    const e = editorRef.current; if (!e) return;
    const { from, to } = e.state.selection; const sel = e.state.doc.textBetween(from, to, "\n");
    setAi({ mode, selection: sel || e.getText(), replaceRange: sel ? { from, to } : null, insertAt: to, pageId });
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

  if (!editor) return <div className={cn("note-editor min-h-[40vh] pulse-soft", className)} />;
  const B = ({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) => <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn("grid size-7 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk hover:text-fg [&_svg]:size-4", active && "bg-accent-soft text-accent")}>{children}</button>;
  return (
    <div className={cn("note-editor relative", className)}>
      <input ref={fileInput} type="file" multiple className="hidden" aria-hidden tabIndex={-1} onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length && editorRef.current) insertUploaded(editorRef.current, files); e.target.value = ""; }} />
      {editable && !isTouch && (
        <DragHandle editor={editor} className="drag-handle" computePositionConfig={{ placement: "left-start" }}><GripVertical className="size-4" /></DragHandle>
      )}
      {editable && !isTouch && (
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
      {jobs.length > 0 && <ul aria-label="Uploads" className="mt-3 space-y-1.5">{jobs.map((j) => <li key={j.id} className={cn("flex items-center gap-2 rounded-lg border bg-bg-elev px-3 py-2 text-[13px]", j.state === "failed" ? "border-danger/40" : "border-line")}>
        <FileUp className="size-4 shrink-0 text-fg-muted" /><div className="min-w-0 flex-1"><div className="truncate">{j.file.name}</div>{j.state === "uploading" ? <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-sunk" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.progress * 100)} aria-label={`Uploading ${j.file.name}`}><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(3, Math.round(j.progress * 100))}%` }} /></div> : <div className="text-[12px] text-danger">{j.error}</div>}</div>
        {j.state === "uploading" ? <><span className="tabular-nums text-[12px] text-fg-faint">{Math.round(j.progress * 100)}%</span><button type="button" aria-label={`Cancel upload of ${j.file.name}`} onClick={() => j.abort.abort()} className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk"><X className="size-4" /></button></> : <><button type="button" onClick={() => retryJob(j)} className="flex h-9 items-center gap-1 rounded-md px-2 font-medium text-accent"><RotateCcw className="size-4" />Retry</button><button type="button" aria-label="Dismiss" onClick={() => setJobs((js) => js.filter((x) => x.id !== j.id))} className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk"><X className="size-4" /></button></>}
      </li>)}</ul>}
      {editable && isTouch && (focused || linkOpen) && !ai && <MobileToolbar editor={editor} inset={kb} onLink={setLink} onPick={pick} onAI={() => openAIForSelection("custom")} onViewImage={setZoom} />}
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
