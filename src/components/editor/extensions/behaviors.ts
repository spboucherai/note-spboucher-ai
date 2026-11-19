/**
 * file: src/components/editor/extensions/behaviors.ts
 * description: editor behaviours added in 3.0 — (1) Markdown paste: plain text that is clearly Markdown is converted to blocks
 *   (including the Next Generation forms of SPEC §2) instead of being pasted as literal text; (2) Semantic zoom, level 2 "outline":
 *   node decorations hide everything but the headings and the first block of each section (the document itself is untouched).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { markdownToDoc } from "@/lib/editor/markdown-client";

/** Block-level Markdown markers. One is enough; inline emphasis alone is not (ordinary prose often contains * or _). */
const MD_BLOCK = /^(#{1,6}\s+\S|\s*[-*+]\s+\S|\s*\d+[.)]\s+\S|\s*>\s?\S|```|~~~|\s*[-*+]\s+\[[ xX]\]\s|\|.+\|\s*$|\$\$|\[\[[0-9a-f-]{36}#[\w-]+\]\]\s*$|\[(PDF|Audio|Vue|Canvas)[:\]])/m;
export function looksLikeMarkdown(text: string): boolean {
  if (!text || text.length < 3 || text.length > 400_000) return false;
  if (MD_BLOCK.test(text)) return true;
  // several lines with inline Markdown (links / bold / code) also count
  const inline = (text.match(/\[[^\]\n]+\]\([^)\s]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`/g) ?? []).length;
  return inline >= 2 && /\n/.test(text);
}
export const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ key: new PluginKey("markdownPaste"), props: {
      handlePaste(view, event) {
        const cd = event.clipboardData; if (!cd || !editor.isEditable) return false;
        if ((view as unknown as { input?: { shiftKey?: boolean } }).input?.shiftKey) return false; // ⌘⇧V = paste as plain text
        if (cd.files?.length) return false; // files are handled by the upload handler
        const html = cd.getData("text/html"); const text = cd.getData("text/plain");
        // rich content from a web page or from this editor keeps its own structure; a code editor's HTML (one <pre>/<span> soup) does not count
        if (html && !/^\s*(<meta[^>]*>)?\s*<(pre|code|span|div)[\s>]/i.test(html) && /<(p|h[1-6]|ul|ol|table|blockquote|img|a)\b/i.test(html)) return false;
        if (editor.isActive("codeBlock") || !looksLikeMarkdown(text)) return false;
        const nodes = markdownToDoc(text); if (!nodes.length) return false;
        // a single paragraph is inserted inline (keeps the surrounding sentence); anything else as blocks
        const content = nodes.length === 1 && nodes[0].type === "paragraph" ? nodes[0].content ?? [] : nodes;
        return editor.chain().focus().insertContent(content).run();
      },
    } })];
  },
});

export const zoomKey = new PluginKey<{ level: 2 | 3; deco: DecorationSet }>("semanticZoom");
function outlineDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []; let afterHeading = false; let any = false;
  doc.forEach((node, pos) => {
    if (node.type.name === "heading") { afterHeading = true; any = true; decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "sz-heading" })); return; }
    if (afterHeading && node.isTextblock && node.content.size > 0) { afterHeading = false; decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "sz-first" })); return; }
    if (afterHeading && !node.isTextblock) afterHeading = false;
    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "sz-hidden" }));
  });
  // a page without headings has no outline: show the first lines of every block instead of an empty screen
  if (!any) return DecorationSet.create(doc, (() => { const d: Decoration[] = []; doc.forEach((n, p) => d.push(Decoration.node(p, p + n.nodeSize, { class: "sz-first" }))); return d; })());
  return DecorationSet.create(doc, decos);
}
/** Level 3 = full text (no decoration, zero cost). Level 2 = outline. Set with `editor.view.dispatch(tr.setMeta(zoomKey, level))`. */
export const SemanticZoom = Extension.create({
  name: "semanticZoom",
  addProseMirrorPlugins() {
    return [new Plugin({ key: zoomKey,
      state: { init: () => ({ level: 3 as 2 | 3, deco: DecorationSet.empty }),
        apply(tr, prev, _o, state) { const meta = tr.getMeta(zoomKey) as 2 | 3 | undefined; const level = meta ?? prev.level; if (level === 3) return prev.level === 3 && meta === undefined ? prev : { level, deco: DecorationSet.empty }; if (meta !== undefined || tr.docChanged) return { level, deco: outlineDecorations(state.doc) }; return prev; } },
      props: { decorations(state) { return zoomKey.getState(state)?.deco ?? null; }, attributes(state): Record<string, string> { return zoomKey.getState(state)?.level === 2 ? { "data-zoom": "outline" } : {}; } },
    })];
  },
});

/**
 * Typing while a whole block card is selected must never replace it (ProseMirror's default for a node selection): a diagram, a
 * drawing or a recording would vanish for one stray key. The text goes to a new paragraph right after the block instead.
 * Backspace / Delete still remove the selected block — that is an explicit gesture.
 */
export const AtomGuard = Extension.create({
  name: "atomGuard",
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey("atomGuard"), props: {
      handleTextInput(view, _from, _to, text) {
        const sel = view.state.selection; if (!(sel instanceof NodeSelection) || !sel.node.isBlock || !sel.node.isAtom) return false;
        const para = view.state.schema.nodes.paragraph; if (!para) return false;
        const at = sel.to; const tr = view.state.tr.insert(at, para.create(null, view.state.schema.text(text)));
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1 + text.length)).scrollIntoView()); return true;
      },
    } })];
  },
});
