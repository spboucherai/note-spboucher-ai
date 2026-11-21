/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/editor/extensions/next-nodes.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
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
/**
 * file: src/components/editor/extensions/next-nodes.tsx
 * description: Tiptap schema of the Next Generation nodes (SPEC §2). Each one is a leaf atom whose attrs are declared in
 *   src/lib/editor/next-node-defs.ts and whose rendering is a React node view (src/components/editor/nodes/*). The HTML form
 *   (`<div data-node="…" data-attrs="{json}">`) exists for the clipboard and drag-and-drop only; the stored format is the JSON.
 *   Also here: the two "unknown" boxes that keep a node type this client does not know (see src/lib/editor/unknown.ts).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { Node, Mark, Extension, type Editor } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { PackageOpen } from "lucide-react";
import { NEXT_NODES, type NextNodeDef } from "@/lib/editor/next-node-defs";
import { UNKNOWN_BLOCK, UNKNOWN_INLINE, UNKNOWN_MARK, XATTRS, type SchemaInfo } from "@/lib/editor/unknown";
import { NodeFrame, type LeafViewProps } from "../nodes/frame";
import { MermaidView } from "../nodes/MermaidView";
import { DrawingView } from "../nodes/DrawingView";
import { ChartView } from "../nodes/ChartView";
import { QueryView } from "../nodes/QueryView";
import { CitationView, BibliographyView } from "../nodes/CitationView";
import { PdfView } from "../nodes/PdfView";
import { BlockRefView, CanvasLinkView } from "../nodes/RefViews";
import { RunCodeView } from "../nodes/RunCodeView";
import { AudioView } from "../nodes/AudioView";

/** Page context for node views (attachments are uploaded against the page). Read with `noteContext(editor)`. */
export interface NoteCtx { pageId: string | null; /** set by the Editor component: how setEditorDoc reports a document that fails the schema check */ onInvalid?: (reason: string | null) => void }
export const NoteContext = Extension.create<{ pageId: string | null }>({ name: "noteContext", addOptions() { return { pageId: null }; }, addStorage() { return { pageId: this.options.pageId as string | null } as NoteCtx; } });
export const noteContext = (editor: Editor): NoteCtx => ((editor.storage as unknown as Record<string, unknown>).noteContext as NoteCtx | undefined) ?? { pageId: null };

/**
 * Which events ProseMirror must NOT handle inside a node view. Inside `[data-nv-stop]` (canvas, text layer, grid): all of them — the
 * block owns pointer, keyboard and clipboard there. Elsewhere in the frame: controls keep their events, a plain mousedown goes to
 * ProseMirror (it selects the block) and so do drag/drop and copy/cut/paste (the selected block can be dragged and copied).
 */
const stopEvent = ({ event }: { event: Event }) => {
  const t = event.target as HTMLElement | null; if (!t || typeof t.closest !== "function") return false;
  if (t.closest("[data-nv-stop]")) return true;
  if (event.type.startsWith("drag") || event.type === "drop") return false;
  if (t.closest("input,button,select,textarea,a,[contenteditable='true'],[role='button']")) return true;
  return event.type !== "mousedown" && event.type !== "copy" && event.type !== "cut" && event.type !== "paste";
};
function adapt<A>(Comp: React.ComponentType<LeafViewProps<A>>) {
  const View = (p: NodeViewProps) => {
    const editable = p.editor.isEditable;
    // a debounced write may arrive after the block was deleted or moved: it is applied only if this very node type is still at the position
    const update = React.useCallback((patch: Partial<A>) => { if (!p.editor.isEditable || p.editor.isDestroyed) return; const pos = p.getPos(); if (typeof pos !== "number") return; const at = p.editor.state.doc.nodeAt(pos); if (!at || at.type !== p.node.type) return; p.updateAttributes(patch as Record<string, unknown>); }, [p]);
    return <Comp attrs={p.node.attrs as A & { id?: string | null }} update={update} editable={editable} selected={p.selected} pageId={noteContext(p.editor).pageId} editor={p.editor} getPos={p.getPos} deleteNode={p.deleteNode} />;
  };
  View.displayName = `NodeView(${Comp.displayName ?? Comp.name})`;
  return View;
}
const readAttrs = (el: HTMLElement): Record<string, unknown> => { try { const a = JSON.parse(el.getAttribute("data-attrs") ?? "{}"); return a && typeof a === "object" ? a : {}; } catch { return {}; } };
function leaf<A>(def: NextNodeDef, Comp: React.ComponentType<LeafViewProps<A>>) {
  const tag = def.inline ? "span" : "div";
  return Node.create({
    name: def.name, group: def.inline ? "inline" : "block", inline: def.inline, atom: true, selectable: true, isolating: !def.inline,
    // not `draggable`: a draggable node view makes the browser start a drag on any mouse-down inside it, which kills text selection
    // (PDF text layer), drawing and range inputs. Blocks are moved with the handle in the left gutter and the block menu instead.
    draggable: false,
    addAttributes() { return Object.fromEntries(Object.entries(def.defaults).map(([k, d]) => [k, { default: d, parseHTML: (el: HTMLElement) => { const a = readAttrs(el); return k in a ? a[k] : d; }, renderHTML: () => ({}) }])); },
    parseHTML() { return [{ tag: `${tag}[data-node="${def.name}"]` }]; },
    renderHTML({ node }) { const { id: _id, ...attrs } = node.attrs as Record<string, unknown>; return [tag, { "data-node": def.name, "data-attrs": JSON.stringify(attrs) }]; },
    // the wrapper carries the block id like every other block (deep links #block-<id>, semantic zoom anchor)
    addNodeView() { return ReactNodeViewRenderer(adapt(Comp), { stopEvent, ...(def.inline ? { as: "span", className: "nv-inline" } : { attrs: ({ node }: { node: { attrs: Record<string, unknown> } }) => (node.attrs.id ? { id: `block-${node.attrs.id}`, "data-id": String(node.attrs.id) } : {}) as Record<string, string> }) }); },
  });
}
const VIEWS: Record<string, React.ComponentType<LeafViewProps<any>>> = {
  mermaid: MermaidView, drawing: DrawingView, chart: ChartView, queryView: QueryView, citation: CitationView, bibliography: BibliographyView,
  pdf: PdfView, blockRef: BlockRefView, runCode: RunCodeView, audio: AudioView, canvasLink: CanvasLinkView,
};
export const NextNodes = NEXT_NODES.map((d) => leaf(d, VIEWS[d.name]));

/* ---------------------------------------------------------------- unknown content ---------------------------------------------------------------- */
const typeOf = (raw: unknown) => (raw && typeof raw === "object" && typeof (raw as { type?: unknown }).type === "string" ? (raw as { type: string }).type : "?");
function UnknownBlockView(p: NodeViewProps) {
  return (
    <NodeFrame kind={UNKNOWN_BLOCK} icon={<PackageOpen />} label="Unsupported block" title={typeOf(p.node.attrs.raw)} selected={p.selected} stop={false}>
      <div className="nb-state"><div className="min-w-0"><div className="nb-state-title">This block was made with a newer version of SP Note.</div><div className="nb-state-hint">It is kept exactly as it is and will show again once this app is up to date. You can move or delete it, not edit it.</div></div></div>
    </NodeFrame>
  );
}
function UnknownInlineView(p: NodeViewProps) { return <NodeViewWrapper as="span" className="unknown-inline" title="Content from a newer version of SP Note — kept as is" data-node={UNKNOWN_INLINE}><PackageOpen className="inline size-3" aria-hidden />{typeOf(p.node.attrs.raw)}</NodeViewWrapper>; }
const rawAttr = { raw: { default: null, parseHTML: (el: HTMLElement) => { try { return JSON.parse(el.getAttribute("data-raw") ?? "null"); } catch { return null; } }, renderHTML: (a: { raw?: unknown }) => ({ "data-raw": JSON.stringify(a.raw ?? null) }) } };
/** Verbatim box for a block of an unknown type. `raw` is the original node JSON; it never goes through the schema. */
export const UnknownBlock = Node.create({
  name: UNKNOWN_BLOCK, group: "block", atom: true, selectable: true, draggable: true, isolating: true,
  addAttributes() { return rawAttr; }, parseHTML() { return [{ tag: `div[data-node="${UNKNOWN_BLOCK}"]` }]; }, renderHTML({ HTMLAttributes }) { return ["div", { ...HTMLAttributes, "data-node": UNKNOWN_BLOCK }]; },
  addNodeView() { return ReactNodeViewRenderer(UnknownBlockView); },
});
export const UnknownInline = Node.create({
  name: UNKNOWN_INLINE, group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() { return rawAttr; }, parseHTML() { return [{ tag: `span[data-node="${UNKNOWN_INLINE}"]` }]; }, renderHTML({ HTMLAttributes }) { return ["span", { ...HTMLAttributes, "data-node": UNKNOWN_INLINE }]; },
  addNodeView() { return ReactNodeViewRenderer(UnknownInlineView, { as: "span" }); },
});

/** Verbatim box for a mark of an unknown type (or a known mark carrying attrs this client does not know). The text stays editable. */
export const UnknownMark = Mark.create({
  name: UNKNOWN_MARK, excludes: "", inclusive: false, spanning: true,
  addAttributes() { return rawAttr; }, parseHTML() { return [{ tag: `span[data-mark="${UNKNOWN_MARK}"]` }]; },
  renderHTML({ HTMLAttributes }) { return ["span", { ...HTMLAttributes, "data-mark": UNKNOWN_MARK, class: "unknown-mark", title: "Formatting from a newer version of SP Note — kept as is" }, 0]; },
});
/**
 * Reserved attr `xattrs` on every node type: holds the attrs of that node this client's schema does not know (see unknown.ts).
 * Never rendered to the DOM, never stored (unwrapUnknown spreads it back), not copied when a block is split.
 */
export const XAttrs = Extension.create({
  name: "xattrs",
  addGlobalAttributes() { return [{ types: this.extensions.filter((e) => e.type === "node" && e.name !== "doc" && e.name !== "text").map((e) => e.name), attributes: { [XATTRS]: { default: null, rendered: false, keepOnSplit: false } } }]; },
});
const infoCache = new WeakMap<Schema, SchemaInfo>();
/** What a schema knows, in the form unknown.ts needs (cached per schema). The reserved names are excluded: they are never "known content". */
export function schemaInfoOf(schema: Schema): SchemaInfo {
  let info = infoCache.get(schema); if (info) return info;
  info = { nodes: new Map(), marks: new Map() };
  for (const [name, type] of Object.entries(schema.nodes)) info.nodes.set(name, { attrs: new Set(Object.keys(type.spec.attrs ?? {}).filter((k) => k !== XATTRS)), inlineContent: type.inlineContent });
  for (const [name, type] of Object.entries(schema.marks)) if (name !== UNKNOWN_MARK) info.marks.set(name, new Set(Object.keys(type.spec.attrs ?? {})));
  infoCache.set(schema, info); return info;
}
