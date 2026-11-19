"use client";
/**
 * file: src/components/editor/extensions/slash.tsx
 * description: the "/" block menu. 3.0 adds the Next Generation blocks (diagram, drawing, chart, live view, citation, bibliography,
 *   PDF, block reference, runnable code, voice note, canvas) and the knowledge callouts (decision, question, hypothesis). The same list
 *   feeds the Universal Command Center ("Insert …" commands).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { nanoid } from "nanoid";
import { Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, Quote, Code2, Minus, Table, Image, Film, Paperclip, Sigma, SquareSigma, Lightbulb, ChevronRight, Sparkles, Link2, FileText, Database, Hash, Type, Footprints, Wand2, Workflow, PenLine, ChartColumn, ListFilter, BookMarked, Library, FileSearch, CornerDownRight, SquareTerminal, Mic, Shapes, Scale, CircleHelp, FlaskConical } from "lucide-react";
import { requestOpenCitation } from "../nodes/CitationView";
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
    { id: "decision", group: "Knowledge", title: "Decision", hint: "Record what was decided", icon: <Scale />, keywords: "callout decision décision choice" },
    { id: "question", group: "Knowledge", title: "Open question", hint: "Something still to answer", icon: <CircleHelp />, keywords: "callout question" },
    { id: "hypothesis", group: "Knowledge", title: "Hypothesis", hint: "An assumption to test", icon: <FlaskConical />, keywords: "callout hypothesis hypothèse assumption" },
    { id: "cite", group: "Knowledge", title: "Citation", hint: "Cite a reference of your library", icon: <BookMarked />, keywords: "cite citation reference source" },
    { id: "bibliography", group: "Knowledge", title: "Bibliography", hint: "References cited in this page", icon: <Library />, keywords: "bibliography references références" },
    { id: "blockref", group: "Knowledge", title: "Block reference", hint: "Show a block of another page", icon: <CornerDownRight />, keywords: "reference transclusion embed synced block" },
    { id: "query", group: "Knowledge", title: "Live view", hint: "Tasks, pages or rows that update themselves", icon: <ListFilter />, keywords: "query living view vue dynamic tasks" },
    { id: "code", group: "Advanced", title: "Code block", hint: "Syntax highlighted", icon: <Code2 />, keywords: "code snippet" },
    { id: "table", group: "Advanced", title: "Table", hint: "3 × 3 with header", icon: <Table />, keywords: "grid" },
    { id: "math", group: "Advanced", title: "Equation", hint: "Block LaTeX", icon: <SquareSigma />, keywords: "latex formula equation" },
    { id: "imath", group: "Advanced", title: "Inline equation", icon: <Sigma />, keywords: "latex inline" },
    { id: "footnote", group: "Advanced", title: "Footnote", icon: <Footprints />, keywords: "citation reference note" },
    { id: "mermaid", group: "Advanced", title: "Diagram", hint: "Mermaid flowchart, sequence, Gantt…", icon: <Workflow />, keywords: "mermaid diagram diagramme flowchart graph" },
    { id: "chart", group: "Advanced", title: "Chart", hint: "Bar, line, area, pie, scatter", icon: <ChartColumn />, keywords: "chart graph graphique data plot" },
    { id: "runcode", group: "Advanced", title: "Runnable code", hint: "JavaScript in an isolated sandbox", icon: <SquareTerminal />, keywords: "run code execute javascript sandbox" },
    { id: "image", group: "Media", title: "Image", hint: "Upload or paste", icon: <Image />, keywords: "picture photo" },
    { id: "video", group: "Media", title: "Video", hint: "YouTube / Vimeo URL", icon: <Film />, keywords: "youtube embed" },
    { id: "file", group: "Media", title: "File", hint: "Attach PDF, DOCX, …", icon: <Paperclip />, keywords: "attachment upload pdf" },
    { id: "drawing", group: "Media", title: "Drawing", hint: "Pen, marker, highlighter", icon: <PenLine />, keywords: "draw drawing dessin sketch ink pencil" },
    { id: "pdf", group: "Media", title: "PDF to annotate", hint: "Read, highlight and take notes", icon: <FileSearch />, keywords: "pdf annotate highlight reader" },
    { id: "audio", group: "Media", title: "Voice note", hint: "Record or attach audio", icon: <Mic />, keywords: "audio voice record recording memo vocal" },
    { id: "canvas", group: "Media", title: "Canvas", hint: "Link an infinite canvas", icon: <Shapes />, keywords: "canvas whiteboard board" },
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
      case "decision": return C(editor, range).insertContent({ type: "callout", attrs: { kind: "decision", icon: "⚖️" }, content: [{ type: "paragraph" }] }).run();
      case "question": return C(editor, range).insertContent({ type: "callout", attrs: { kind: "question", icon: "❓" }, content: [{ type: "paragraph" }] }).run();
      case "hypothesis": return C(editor, range).insertContent({ type: "callout", attrs: { kind: "hypothesis", icon: "🧪" }, content: [{ type: "paragraph" }] }).run();
      case "cite": requestOpenCitation(); return C(editor, range).insertContent([{ type: "citation" }, { type: "text", text: " " }]).run();
      case "bibliography": return C(editor, range).insertContent({ type: "bibliography" }).run();
      case "blockref": return C(editor, range).insertContent({ type: "blockRef" }).run();
      case "query": return C(editor, range).insertContent({ type: "queryView" }).run();
      case "mermaid": return C(editor, range).insertContent({ type: "mermaid" }).run();
      case "chart": return C(editor, range).insertContent({ type: "chart" }).run();
      case "runcode": return C(editor, range).insertContent({ type: "runCode" }).run();
      case "drawing": return C(editor, range).insertContent({ type: "drawing" }).run();
      case "pdf": return C(editor, range).insertContent({ type: "pdf" }).run();
      case "audio": return C(editor, range).insertContent({ type: "audio" }).run();
      case "canvas": return C(editor, range).insertContent({ type: "canvasLink" }).run();
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
  // best first: the title starts with the query, then contains it, then a keyword does (stable inside each rank)
  const rank = (i: (typeof all)[number]) => { const t = i.title.toLowerCase(); return !qq ? 0 : t.startsWith(qq) ? 0 : t.includes(qq) ? 1 : i.keywords?.includes(qq) ? 2 : -1; };
  return all.map((i, n) => ({ i, n, r: rank(i) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r || a.n - b.n).map(({ i }) => ({ ...i, data: run(i.id) })).slice(0, 48);
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
