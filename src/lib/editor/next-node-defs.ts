/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/editor/next-node-defs.ts
 * Description      : SP Note Next Generation node catalogue (SPEC §2) — names,
 *                    attrs and defaults of the new leaf atoms, exactly as
 *                    stored in the ProseMirror JSON. Pure data + types: shared
 *                    by the Tiptap schema
 *                    (src/components/editor/extensions/next-nodes.tsx), the
 *                    Markdown conversion (markdown-client.ts) and the tests. Do
 *                    not rename a node or an attr: four codebases read this
 *                    format.
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
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

export interface MermaidAttrs { code: string; preview: string | null; previewHash: string | null }
export interface DrawingAttrs { ink: string | null; preview: string | null; pk: string | null; width: number; height: number; background: string }
export type ChartKind = "bar" | "line" | "area" | "pie" | "scatter";
export type ChartCell = string | number | null;
export interface ChartAttrs { kind: ChartKind; title: string; columns: string[]; rows: ChartCell[][]; x: string | null; y: string[]; source: { databaseId: string; viewId?: string } | null }
export type QuerySource = "tasks" | "pages" | "database" | "references" | "backlinks";
export interface QueryFilter { tag?: string; section?: string; status?: string; parentId?: string; text?: string; dueBefore?: string; dueAfter?: string }
export interface QueryViewAttrs { source: QuerySource; databaseId: string | null; viewId: string | null; filter: QueryFilter; layout: "list" | "table" | "board"; limit: number; title: string }
export interface CitationAttrs { refId: string | null; locator: string; label: string }
export interface BibliographyAttrs { style: string; title: string }
export interface PdfAnnotation { id: string; page: number; kind: "highlight" | "note" | "ink"; color: string; rects: [number, number, number, number][]; text: string; note: string; ink?: [number, number][]; createdAt: string }
export interface PdfAttrs { attachmentId: string | null; name: string; page: number; annotations: PdfAnnotation[] }
export interface BlockRefAttrs { pageId: string | null; blockId: string | null; mode: "embed" | "link" }
export interface RunOutput { text: string; error: boolean; ms: number; at: string }
export interface RunCodeAttrs { language: string; code: string; output: RunOutput | null }
export interface TranscriptLine { t: number; text: string }
export interface AudioSummary { text: string; decisions: string[]; tasks: string[]; model: string; at: string }
export interface AudioAttrs { attachmentId: string | null; duration: number; title: string; recordedAt: string | null; transcript: TranscriptLine[]; transcriptStatus: "none" | "pending" | "done" | "failed"; transcriptEngine: string | null; summary: AudioSummary | null }
export interface CanvasLinkAttrs { pageId: string | null }

export interface NextNodeDef { name: string; inline: boolean; label: string; defaults: Record<string, unknown> }
/** Defaults are frozen: ProseMirror shares the default value between nodes, so it must never be mutated in place. */
const def = (name: string, label: string, defaults: Record<string, unknown>, inline = false): NextNodeDef => ({ name, inline, label, defaults: Object.freeze(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, v && typeof v === "object" ? Object.freeze(v) : v]))) });
export const NEXT_NODES: NextNodeDef[] = [
  def("mermaid", "Diagram", { code: "", preview: null, previewHash: null } satisfies MermaidAttrs),
  def("drawing", "Drawing", { ink: null, preview: null, pk: null, width: 0, height: 0, background: "none" } satisfies DrawingAttrs),
  def("chart", "Chart", { kind: "bar", title: "", columns: [], rows: [], x: null, y: [], source: null } satisfies ChartAttrs),
  def("queryView", "Live view", { source: "tasks", databaseId: null, viewId: null, filter: {}, layout: "list", limit: 25, title: "" } satisfies QueryViewAttrs),
  def("citation", "Citation", { refId: null, locator: "", label: "" } satisfies CitationAttrs, true),
  def("bibliography", "Bibliography", { style: "apa", title: "Références" } satisfies BibliographyAttrs),
  def("pdf", "PDF", { attachmentId: null, name: "", page: 1, annotations: [] } satisfies PdfAttrs),
  def("blockRef", "Block reference", { pageId: null, blockId: null, mode: "embed" } satisfies BlockRefAttrs),
  def("runCode", "Runnable code", { language: "javascript", code: "", output: null } satisfies RunCodeAttrs),
  def("audio", "Voice note", { attachmentId: null, duration: 0, title: "", recordedAt: null, transcript: [], transcriptStatus: "none", transcriptEngine: null, summary: null } satisfies AudioAttrs),
  def("canvasLink", "Canvas", { pageId: null } satisfies CanvasLinkAttrs),
];
export const NEXT_NODE_NAMES = NEXT_NODES.map((n) => n.name);
export const NEXT_BLOCK_NAMES = NEXT_NODES.filter((n) => !n.inline).map((n) => n.name);
export const nextNodeDef = (name: string) => NEXT_NODES.find((n) => n.name === name);
/** Callout kinds: the five of 2.x plus the three knowledge kinds of 3.0, with their default icon. */
export const CALLOUT_KINDS: { kind: string; label: string; icon: string }[] = [
  { kind: "note", label: "Note", icon: "💡" }, { kind: "info", label: "Info", icon: "ℹ️" }, { kind: "warning", label: "Warning", icon: "⚠️" }, { kind: "danger", label: "Danger", icon: "⛔" }, { kind: "ai", label: "AI", icon: "✨" },
  { kind: "decision", label: "Decision", icon: "⚖️" }, { kind: "question", label: "Question", icon: "❓" }, { kind: "hypothesis", label: "Hypothesis", icon: "🧪" },
];
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
