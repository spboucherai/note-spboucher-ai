"use client";
import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { nanoid } from "nanoid";
import { Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, Quote, Code2, Minus, Table, Image, Film, Paperclip, Sigma, SquareSigma, Lightbulb, ChevronRight, Sparkles, Link2, FileText, Database, Hash, Type, Footprints, Wand2 } from "lucide-react";
import { SuggestionList, makeRenderer, type Item } from "./suggestion-ui";

export type SlashContext = { onAI: (editor: Editor, range: Range, mode: string) => void; onUpload: (editor: Editor, range: Range, accept: string) => void; onNewPage: (editor: Editor, range: Range, type: "page" | "database") => void };
export const slashItems = (ctx: SlashContext) => (q: string): Item[] => {
  const C = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);
  const all: (Item & { keywords?: string })[] = [
    { id: "text", group: "Basic", title: "Text", hint: "Plain paragraph", icon: <Type />, keywords: "paragraph", run: undefined },
    { id: "h1", group: "Basic", title: "Heading 1", hint: "Section title", icon: <Heading1 />, keywords: "title h1" },
    { id: "h2", group: "Basic", title: "Heading 2", icon: <Heading2 />, keywords: "h2" },
    { id: "h3", group: "Basic", title: "Heading 3", icon: <Heading3 />, keywords: "h3" },
    { id: "bullet", group: "Basic", title: "Bulleted list", icon: <List />, keywords: "ul list" },
    { id: "ordered", group: "Basic", title: "Numbered list", icon: <ListOrdered />, keywords: "ol numbered" },
    { id: "todo", group: "Basic", title: "To-do list", hint: "Checklist", icon: <ListChecks />, keywords: "task checkbox todo" },
    { id: "toggle", group: "Basic", title: "Toggle", hint: "Collapsible block", icon: <ChevronRight />, keywords: "details collapse" },
    { id: "quote", group: "Basic", title: "Quote", icon: <Quote />, keywords: "blockquote" },
    { id: "callout", group: "Basic", title: "Callout", hint: "Highlighted note", icon: <Lightbulb />, keywords: "note info warning" },
    { id: "divider", group: "Basic", title: "Divider", icon: <Minus />, keywords: "hr rule" },
    { id: "code", group: "Advanced", title: "Code block", hint: "Syntax highlighted", icon: <Code2 />, keywords: "code snippet" },
    { id: "table", group: "Advanced", title: "Table", hint: "3 × 3 with header", icon: <Table />, keywords: "grid" },
    { id: "math", group: "Advanced", title: "Equation", hint: "Block LaTeX", icon: <SquareSigma />, keywords: "latex formula equation" },
    { id: "imath", group: "Advanced", title: "Inline equation", icon: <Sigma />, keywords: "latex inline" },
    { id: "footnote", group: "Advanced", title: "Footnote", icon: <Footprints />, keywords: "citation reference note" },
    { id: "image", group: "Media", title: "Image", hint: "Upload or paste", icon: <Image />, keywords: "picture photo" },
    { id: "video", group: "Media", title: "Video", hint: "YouTube / Vimeo URL", icon: <Film />, keywords: "youtube embed" },
    { id: "file", group: "Media", title: "File", hint: "Attach PDF, DOCX, …", icon: <Paperclip />, keywords: "attachment upload pdf" },
    { id: "link", group: "Links", title: "Link to page", hint: "Type @ to mention", icon: <Link2 />, keywords: "mention page" },
    { id: "page", group: "Links", title: "New sub-page", icon: <FileText />, keywords: "subpage child" },
    { id: "db", group: "Links", title: "New database", hint: "Table / board / calendar", icon: <Database />, keywords: "database table kanban" },
    { id: "ai-write", group: "AI", title: "Ask AI to write", hint: "Generate content here", icon: <Sparkles />, keywords: "ai generate write" },
    { id: "ai-continue", group: "AI", title: "Continue writing", icon: <Wand2 />, keywords: "ai continue" },
    { id: "ai-summary", group: "AI", title: "Summarize page", icon: <Hash />, keywords: "ai summary tldr" },
  ];
  const run = (id: string) => (editor: Editor, range: Range) => {
    switch (id) {
      case "text": return C(editor, range).setParagraph().run();
      case "h1": return C(editor, range).setHeading({ level: 1 }).run();
      case "h2": return C(editor, range).setHeading({ level: 2 }).run();
      case "h3": return C(editor, range).setHeading({ level: 3 }).run();
      case "bullet": return C(editor, range).toggleBulletList().run();
      case "ordered": return C(editor, range).toggleOrderedList().run();
      case "todo": return C(editor, range).toggleTaskList().run();
      case "toggle": return C(editor, range).insertContent({ type: "details", attrs: { open: true }, content: [{ type: "detailsSummary", content: [{ type: "text", text: "Toggle" }] }, { type: "detailsContent", content: [{ type: "paragraph" }] }] }).run();
      case "quote": return C(editor, range).toggleBlockquote().run();
      case "callout": return C(editor, range).insertContent({ type: "callout", attrs: { kind: "note", icon: "💡" }, content: [{ type: "paragraph" }] }).run();
      case "divider": return C(editor, range).setHorizontalRule().run();
      case "code": return C(editor, range).toggleCodeBlock().run();
      case "table": return C(editor, range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      case "math": return C(editor, range).insertContent({ type: "blockMath", attrs: { latex: "E = mc^2" } }).run();
      case "imath": return C(editor, range).insertContent({ type: "inlineMath", attrs: { latex: "x^2" } }).run();
      case "footnote": { const id = String(1 + editor.state.doc.content.content.filter((n: any) => n.type.name === "footnote").length); C(editor, range).insertContent({ type: "footnoteRef", attrs: { id } }).run(); editor.chain().focus("end").insertContent({ type: "footnote", attrs: { id }, content: [{ type: "text", text: "Footnote text" }] }).run(); return; }
      case "image": return ctx.onUpload(editor, range, "image/*");
      case "file": return ctx.onUpload(editor, range, "*/*");
      case "video": { const url = window.prompt("Video URL (YouTube / Vimeo)"); if (url) C(editor, range).setYoutubeVideo({ src: url }).run(); else C(editor, range).run(); return; }
      case "link": return C(editor, range).insertContent("@").run();
      case "page": return ctx.onNewPage(editor, range, "page");
      case "db": return ctx.onNewPage(editor, range, "database");
      case "ai-write": return ctx.onAI(editor, range, "write");
      case "ai-continue": return ctx.onAI(editor, range, "continue");
      case "ai-summary": return ctx.onAI(editor, range, "summarize");
    }
  };
  const qq = q.toLowerCase();
  return all.filter((i) => !qq || i.title.toLowerCase().includes(qq) || i.keywords?.includes(qq)).map((i) => ({ ...i, data: run(i.id) })).slice(0, 30);
};
export const SlashCommand = Extension.create<{ ctx: SlashContext }>({
  name: "slashCommand",
  addOptions() { return { ctx: { onAI: () => {}, onUpload: () => {}, onNewPage: () => {} } }; },
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, char: "/", startOfLine: false, allowSpaces: false,
      command: ({ editor, range, props }: any) => { props.data?.(editor, range); },
      items: ({ query }: { query: string }) => slashItems(this.options.ctx)(query),
      render: makeRenderer(SuggestionList, { empty: "No block matches" }) })];
  },
});
