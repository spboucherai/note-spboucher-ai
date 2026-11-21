/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/client/knowledge.ts
 * Description      : pure logic of the knowledge screens (Graph 2.0, Thought
 *                    Constellation, Timeline, Time Machine, Health, Brief,
 *                    Semantic Zoom, Ask My Knowledge): filters, edge styles,
 *                    path finding, level of detail, event grouping, the honesty
 *                    labels of the time machine, a block diff, health
 *                    categories and their navigations, scroll-anchor mapping,
 *                    ask scopes. No React, no DOM, no fetch: unit-tested in
 *                    tests/unit/next-k-logic.test.ts.
 * Module           : lib
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

import type { EdgeV, NodeV, GraphView, GraphViewData } from "@/lib/graph/views";
import { docBlocks, type PMNode } from "@/lib/editor/text";

/* ------------------------------------------------------------------ graph 2.0 ------------------------------------------------------------------ */
export const VIEWS: { id: GraphView; label: string; hint: string; needsPage: boolean }[] = [
  { id: "global", label: "Global", hint: "Every page, reference and concept", needsPage: false },
  { id: "local", label: "Local", hint: "A page and its neighbours", needsPage: true },
  { id: "project", label: "Project", hint: "A project page and its sub-pages", needsPage: true },
  { id: "timeline", label: "Chronological", hint: "What was created or changed in a period", needsPage: false },
  { id: "concepts", label: "Concepts", hint: "Pages gathered around their concepts", needsPage: false },
  { id: "documents", label: "Documents", hint: "Documents, their files and references", needsPage: false },
  { id: "references", label: "References", hint: "References and the pages that cite them", needsPage: false },
];
export const REL_TYPES = ["related", "supports", "contradicts", "extends", "example_of", "part_of", "cites", "precedes", "follows", "about", "answers", "duplicates"] as const;
export type RelType = (typeof REL_TYPES)[number];
export const REL_LABEL: Record<string, string> = { related: "related to", supports: "supports", contradicts: "contradicts", extends: "extends", example_of: "is an example of", part_of: "is part of", cites: "cites", precedes: "precedes", follows: "follows", about: "is about", answers: "answers", duplicates: "duplicates" };
export type Tone = "accent" | "success" | "danger" | "warning" | "ai" | "muted";
/** Colour family of a relation type: agreement green, conflict red, order amber, the rest ultramarine. */
export const relTone = (relType: string): Tone => (relType === "supports" || relType === "answers" ? "success" : relType === "contradicts" ? "danger" : relType === "precedes" || relType === "follows" ? "warning" : relType === "duplicates" ? "muted" : "accent");
export const EDGE_KIND_LABEL: Record<string, string> = { link: "Link", typed: "Typed relation", ai_suggested: "AI link suggestion", cites: "Citation", reference: "Reference", about: "Concept", relation: "Database relation", attachment: "Attachment" };
export const ORIGINS = ["user", "ai", "system"] as const; export const STATUSES = ["accepted", "suggested"] as const;
export interface GraphFilter { relTypes: string[] | null; origins: string[]; statuses: string[]; kinds: string[] | null }
export const DEFAULT_FILTER: GraphFilter = { relTypes: null, origins: [...ORIGINS], statuses: [...STATUSES], kinds: null };
export const isDefaultFilter = (f: GraphFilter) => f.relTypes === null && f.kinds === null && f.origins.length === ORIGINS.length && f.statuses.length === STATUSES.length;
/** An edge whose relation can be edited through /api/graph/relations (a real row, not a synthetic `e-…` one). */
export const isRealEdge = (e: Pick<EdgeV, "id">) => !e.id.startsWith("e-");
export const isAI = (e: Pick<EdgeV, "origin" | "kind">) => e.origin === "ai" || e.kind === "ai_suggested";
/**
 * Client-side filter of a graph view. `relTypes` applies to the edges that carry a meaning (typed relations and AI link suggestions);
 * the other families are filtered by `kinds`. Nodes are kept (an unfiltered node without edge is still a page) unless `dropIsolated`.
 * Degrees are recomputed on what is left.
 */
export function filterGraph<T extends Pick<GraphViewData, "nodes" | "edges">>(data: T, f: GraphFilter, dropIsolated = false): { nodes: NodeV[]; edges: EdgeV[] } {
  const rel = f.relTypes ? new Set(f.relTypes) : null; const kinds = f.kinds ? new Set(f.kinds) : null; const origins = new Set(f.origins); const statuses = new Set(f.statuses);
  const edges = data.edges.filter((e) => origins.has(e.origin) && statuses.has(e.status) && (!kinds || kinds.has(e.kind)) && (!rel || !(e.kind === "typed" || e.kind === "ai_suggested") || rel.has(e.relType)));
  const deg = new Map<string, [number, number]>(); for (const e of edges) { const a = deg.get(e.source) ?? [0, 0]; a[1]++; deg.set(e.source, a); const b = deg.get(e.target) ?? [0, 0]; b[0]++; deg.set(e.target, b); }
  const nodes = data.nodes.map((n) => { const d = deg.get(n.id) ?? [0, 0]; return { ...n, in: d[0], out: d[1], degree: d[0] + d[1] }; }).filter((n) => !dropIsolated || n.degree > 0);
  return { nodes, edges };
}
export interface EdgeStyle { tone: Tone; dash: number[] | null; width: number; arrow: boolean; ai: boolean; label: string }
/** How an edge is drawn: suggested = dashed in the AI colour with an AI badge; typed relations by tone; citations dotted; links plain. */
export function edgeStyle(e: Pick<EdgeV, "kind" | "relType" | "status" | "origin" | "sub" | "confidence">): EdgeStyle {
  const ai = isAI(e); const suggested = e.status === "suggested";
  const label = suggested ? `AI suggestion · ${e.kind === "about" ? "concept" : REL_LABEL[e.relType] ?? e.relType}${e.confidence != null ? ` · ${Math.round(e.confidence * 100)} %` : ""}` : e.kind === "typed" ? `${REL_LABEL[e.relType] ?? e.relType}${ai ? " · accepted AI relation" : ""}` : e.kind === "relation" ? `database relation${e.sub ? ` · ${e.sub}` : ""}` : (EDGE_KIND_LABEL[e.kind] ?? e.kind).toLowerCase();
  if (suggested) return { tone: "ai", dash: [4, 3], width: 1.3, arrow: e.kind !== "about", ai: true, label };
  if (e.kind === "typed") return { tone: relTone(e.relType), dash: null, width: 1.5, arrow: true, ai, label };
  if (e.kind === "cites" || e.kind === "reference") return { tone: "muted", dash: [1.5, 2.5], width: 1, arrow: e.kind === "cites", ai, label };
  if (e.kind === "about") return { tone: "muted", dash: null, width: 0.9, arrow: false, ai, label };
  if (e.kind === "relation") return { tone: "success", dash: null, width: 1, arrow: true, ai, label };
  if (e.kind === "attachment") return { tone: "muted", dash: null, width: 0.6, arrow: false, ai, label };
  return { tone: "muted", dash: null, width: 0.9, arrow: true, ai, label };
}
/** Shortest undirected path between two nodes (breadth-first). Returns the node ids and the edge ids along it, or null. */
export function shortestPath(edges: Pick<EdgeV, "id" | "source" | "target">[], from: string, to: string): { nodes: string[]; edges: string[] } | null {
  if (from === to) return { nodes: [from], edges: [] };
  const adj = new Map<string, { n: string; e: string }[]>(); const add = (a: string, b: string, e: string) => { const l = adj.get(a); if (l) l.push({ n: b, e }); else adj.set(a, [{ n: b, e }]); };
  for (const e of edges) { add(e.source, e.target, e.id); add(e.target, e.source, e.id); }
  const prev = new Map<string, { n: string; e: string }>(); const seen = new Set([from]); let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const a of frontier) for (const { n, e } of adj.get(a) ?? []) { if (seen.has(n)) continue; seen.add(n); prev.set(n, { n: a, e }); if (n === to) { const nodes = [to], es: string[] = []; let c = to; while (c !== from) { const p = prev.get(c)!; es.unshift(p.e); nodes.unshift(p.n); c = p.n; } return { nodes, edges: es }; } next.push(n); }
    frontier = next;
  }
  return null;
}
export interface ViewQuery { view: GraphView; pageId?: string | null; depth?: number; from?: string | null; to?: string | null; suggestions?: boolean; hideOrphans?: boolean }
/** Query string of GET /api/graph for a view; null when the view needs a page and none is chosen. */
export function viewQuery(q: ViewQuery): string | null {
  const def = VIEWS.find((v) => v.id === q.view); if (!def) return null; if (def.needsPage && !q.pageId) return null;
  const p = new URLSearchParams({ view: q.view }); if (def.needsPage) p.set("pageId", q.pageId!); if (q.view === "local") p.set("depth", String(Math.min(4, Math.max(1, q.depth ?? 1))));
  if (q.view === "timeline") { if (q.from) p.set("from", q.from); if (q.to) p.set("to", q.to); }
  if (q.suggestions === false) p.set("suggestions", "0"); if (q.hideOrphans) p.set("hideOrphans", "1");
  return p.toString();
}
export interface Lod { /** edges draw themselves one by one (Knowledge Connections) */ drawIn: boolean; /** per-edge dashes and arrowheads */ decorations: boolean; warmupTicks: number; cooldownTicks: number; /** zoom above which every label is drawn */ labelsAt: number; /** link hit-testing on the canvas (click an edge) */ linkHover: boolean }
/** Level of detail by size: the budget is 5 000 nodes / 20 000 edges interactive. */
export function lodFor(nodes: number, edges: number): Lod {
  if (nodes <= 400 && edges <= 1500) return { drawIn: true, decorations: true, warmupTicks: 60, cooldownTicks: 180, labelsAt: 1.6, linkHover: true };
  if (nodes <= 1500 && edges <= 6000) return { drawIn: false, decorations: true, warmupTicks: 30, cooldownTicks: 120, labelsAt: 2.2, linkHover: true };
  return { drawIn: false, decorations: false, warmupTicks: 0, cooldownTicks: 90, labelsAt: 3, linkHover: false };
}
/** Progress (0…1) of one edge of a staggered draw-in: edges start `stagger` ms apart (the whole wave never lasts more than `cap` ms) and take `dur` ms each. */
export function drawProgress(elapsed: number, index: number, count: number, dur = 420, stagger = 14, cap = 900): number {
  const step = count > 1 ? Math.min(stagger, cap / (count - 1)) : 0; const t = (elapsed - index * step) / dur; const c = t <= 0 ? 0 : t >= 1 ? 1 : t; return 1 - (1 - c) ** 3;
}
export const drawInDuration = (count: number, dur = 420, stagger = 14, cap = 900) => dur + (count > 1 ? Math.min(stagger * (count - 1), cap) : 0);

/* ------------------------------------------------------------------ constellation ------------------------------------------------------------------ */
export type ZoomTier = "clusters" | "stars" | "titles";
/** Semantic zoom of the constellation: far = clusters, middle = stars and their links, near = titles (a selected star shows its preview). */
export const zoomTier = (scale: number, base = 1): ZoomTier => (scale < base * 1.6 ? "clusters" : scale < base * 4.5 ? "stars" : "titles");
export interface Pt { id: string; x: number; y: number }
/** Scale and offset that fit the points in a w×h box with a margin; coordinates are in [-1, 1] with y up. */
export function fitTransform(points: Pt[], w: number, h: number, margin = 56): { k: number; tx: number; ty: number } {
  if (!points.length || w <= 0 || h <= 0) return { k: 1, tx: w / 2, ty: h / 2 };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const sx = Math.max(x1 - x0, 1e-6), sy = Math.max(y1 - y0, 1e-6); const k = Math.max(1, Math.min((w - 2 * margin) / sx, (h - 2 * margin) / sy));
  return { k, tx: w / 2 - ((x0 + x1) / 2) * k, ty: h / 2 + ((y0 + y1) / 2) * k };
}
export const toScreen = (p: { x: number; y: number }, t: { k: number; tx: number; ty: number }): [number, number] => [p.x * t.k + t.tx, -p.y * t.k + t.ty];
/** Nearest point to a screen position within `radius` px, or null. */
export function hitTest(points: Pt[], t: { k: number; tx: number; ty: number }, sx: number, sy: number, radius = 14): string | null {
  let best: string | null = null, bd = radius * radius; for (const p of points) { const [x, y] = toScreen(p, t); const d = (x - sx) ** 2 + (y - sy) ** 2; if (d <= bd) { bd = d; best = p.id; } } return best;
}
export type Dir = "left" | "right" | "up" | "down";
/**
 * Keyboard navigation between stars: the next point in a direction is the one inside a 90° cone that minimises distance, with a
 * penalty for being off-axis. From no selection, the point closest to the centre of the cloud.
 */
export function nearestInDirection(points: Pt[], currentId: string | null, dir: Dir): string | null {
  if (!points.length) return null; const cur = points.find((p) => p.id === currentId);
  if (!cur) { const cx = points.reduce((s, p) => s + p.x, 0) / points.length, cy = points.reduce((s, p) => s + p.y, 0) / points.length; let b = points[0]; for (const p of points) if ((p.x - cx) ** 2 + (p.y - cy) ** 2 < (b.x - cx) ** 2 + (b.y - cy) ** 2) b = p; return b.id; }
  const ux = dir === "left" ? -1 : dir === "right" ? 1 : 0, uy = dir === "up" ? 1 : dir === "down" ? -1 : 0; let best: string | null = null, score = Infinity;
  for (const p of points) { if (p.id === cur.id) continue; const dx = p.x - cur.x, dy = p.y - cur.y; const along = dx * ux + dy * uy; const across = Math.abs(dx * uy - dy * ux); if (along <= 1e-9 || across > along) continue; const s = along + 2 * across; if (s < score) { score = s; best = p.id; } }
  return best;
}
/** Categorical slots for project / tag / section colouring: the 8 most frequent keys get a slot, the rest share "other". */
export function colourSlots(keys: (string | null)[], max = 8): Map<string, number> {
  const n = new Map<string, number>(); for (const k of keys) if (k) n.set(k, (n.get(k) ?? 0) + 1);
  return new Map([...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([k], i) => [k, i]));
}

/* ------------------------------------------------------------------ timeline ------------------------------------------------------------------ */
export interface KEvent { id: string; at: string; kind: string; pageId: string | null; pageTitle: string | null; pageIcon: string | null; entityKind: string | null; entityId: string | null; actor: string; device: string | null; summary: string; data: Record<string, any> }
export const EVENT_FAMILIES: { id: string; label: string; kinds: string }[] = [
  { id: "page", label: "Pages", kinds: "page.created,page.renamed,page.edited,page.moved,page.archived,page.unarchived,page.trashed,page.restored,page.purged" },
  { id: "version", label: "Versions", kinds: "page.version" },
  { id: "links", label: "Links & relations", kinds: "link.*,relation.*" },
  { id: "task", label: "Tasks", kinds: "task.*" },
  { id: "capture", label: "Captures", kinds: "capture.*" },
  { id: "reference", label: "References & files", kinds: "reference.*,attachment.added" },
  { id: "tag", label: "Tags", kinds: "tag.*" },
  { id: "ai", label: "AI & agents", kinds: "ai.applied,agent.applied" },
  { id: "decision", label: "Decisions", kinds: "decision.recorded" },
  { id: "canvas", label: "Canvas", kinds: "canvas.edited" },
];
const EVENT_VERB: Record<string, string> = {
  "page.created": "Created", "page.renamed": "Renamed", "page.edited": "Edited", "page.moved": "Moved", "page.archived": "Archived", "page.unarchived": "Unarchived", "page.trashed": "Moved to trash", "page.restored": "Restored from trash", "page.purged": "Deleted forever", "page.version": "Version saved",
  "tag.added": "Tag added", "tag.removed": "Tag removed", "link.added": "Link added", "link.removed": "Link removed", "relation.created": "Relation created", "relation.accepted": "Relation accepted", "relation.rejected": "Relation rejected", "relation.removed": "Relation removed",
  "reference.added": "Reference added", "reference.linked": "Reference linked", "attachment.added": "File attached", "task.created": "Task created", "task.completed": "Task completed", "task.reopened": "Task reopened", "capture.created": "Captured", "capture.filed": "Capture filed",
  "ai.applied": "AI result inserted", "agent.applied": "Agent change applied", "decision.recorded": "Decision recorded", "canvas.edited": "Canvas edited",
};
export const eventVerb = (kind: string) => EVENT_VERB[kind] ?? kind;
/** Back-filled events (page.created from the creation date, page.version from the old history) are flagged by the server. */
export const isReconstructed = (e: Pick<KEvent, "data">) => e.data?.backfilled === true;
/** One line of detail under the verb, from the event's own data (nothing is inferred). */
export function eventDetail(e: KEvent): string {
  const d = e.data ?? {};
  switch (e.kind) {
    case "page.renamed": return `“${d.from ?? ""}” → “${d.to ?? ""}”`;
    case "page.version": return `v${d.version ?? "?"}${d.reason ? ` · ${d.reason}` : ""}`;
    case "page.edited": return d.wordCount != null ? `${d.wordCount} words` : "";
    case "link.added": case "link.removed": return d.toTitle ? `→ ${d.toTitle}` : "";
    case "relation.created": case "relation.accepted": case "relation.rejected": case "relation.removed": return `${d.fromTitle ?? "?"} ${REL_LABEL[d.relType] ?? d.relType ?? "→"} ${d.toTitle ?? "?"}`;
    case "tag.added": case "tag.removed": return d.tag ? `#${d.tag}` : "";
    case "reference.linked": return d.title ?? d.citeKey ?? "";
    case "reference.added": return d.citeKey ?? "";
    case "capture.created": return d.kind ?? "";
    case "capture.filed": return d.action ?? "";
    case "ai.applied": return [d.action, d.model].filter(Boolean).join(" · ");
    case "agent.applied": return [d.agent, d.change].filter(Boolean).join(" · ");
    case "page.trashed": case "page.restored": return d.count > 1 ? `${d.count} pages` : "";
    default: return "";
  }
}
export const dayKey = (iso: string, timeZone?: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
export function dayLabel(key: string, todayKey: string): string {
  const d = new Date(`${key}T12:00:00Z`); const t = new Date(`${todayKey}T12:00:00Z`); const diff = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  const long = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", ...(d.getUTCFullYear() !== t.getUTCFullYear() ? { year: "numeric" } : {}) }).format(d);
  return diff === 0 ? `Today · ${long}` : diff === 1 ? `Yesterday · ${long}` : long;
}
/** Events (newest first, possibly several pages of the cursor concatenated) grouped by calendar day; duplicates by id are dropped. */
export function groupEventsByDay(events: KEvent[], timeZone?: string, now = new Date()): { key: string; label: string; events: KEvent[] }[] {
  const seen = new Set<string>(); const out: { key: string; label: string; events: KEvent[] }[] = []; const today = dayKey(now.toISOString(), timeZone);
  for (const e of events) { if (seen.has(e.id)) continue; seen.add(e.id); const key = dayKey(e.at, timeZone); const last = out[out.length - 1]; if (last && last.key === key) last.events.push(e); else out.push({ key, label: dayLabel(key, today), events: [e] }); }
  return out;
}
export interface EventFilter { families: string[]; pageId?: string | null; projectId?: string | null; from?: string | null; to?: string | null }
/** Query string of GET /api/events. `pageId` wins over `projectId` (the API refuses both). */
export function eventsQuery(f: EventFilter, cursor?: string | null, limit = 50): string {
  const p = new URLSearchParams(); const kinds = EVENT_FAMILIES.filter((x) => f.families.includes(x.id)).map((x) => x.kinds).join(",");
  if (kinds) p.set("kinds", kinds); if (f.pageId) p.set("pageId", f.pageId); else if (f.projectId) p.set("projectId", f.projectId);
  if (f.from) p.set("from", f.from); if (f.to) p.set("to", f.to); p.set("limit", String(limit)); if (cursor) p.set("cursor", cursor);
  return p.toString();
}

/* ------------------------------------------------------------------ time machine ------------------------------------------------------------------ */
export interface TMPage { id: string; title: string; icon: string | null; section: string; parentId: string | null; existed: boolean; trashedAt: string | null; source: "current" | "version" | "version_after" | "none"; exact: boolean; version: number | null; versionId: string | null; versionAt: string | null; wordCount: number | null; currentTitle: string; currentVersion: number; changedSince: boolean; content?: PMNode; properties?: unknown }
export interface Honesty { label: string; detail: string; tone: "exact" | "approximate" | "none"; restorable: boolean }
/** What the time machine can honestly say about a page at a date — the wording follows `source` / `exact` exactly as the API reports them. */
export function honesty(p: Pick<TMPage, "existed" | "source" | "exact" | "versionAt" | "version" | "versionId" | "changedSince">, fmt: (iso: string) => string = (s) => s): Honesty {
  if (!p.existed) return { label: "Did not exist yet", detail: "This page was created after that date.", tone: "none", restorable: false };
  switch (p.source) {
    case "current": return { label: "Exact", detail: "Unchanged since that date: what you see is the page as it is today.", tone: "exact", restorable: false };
    case "version": return { label: p.exact ? "Exact" : "Approximate", detail: `History entry v${p.version ?? "?"} saved ${p.versionAt ? fmt(p.versionAt) : "before that date"} — the most recent one at or before that date. Entries are taken every 10 minutes or 20 saves, so edits made between that entry and the chosen date are not in it.`, tone: p.exact ? "exact" : "approximate", restorable: Boolean(p.versionId) };
    case "version_after": return { label: p.exact ? "Exact" : "Approximate", detail: `No history entry exists at or before that date. This is the first entry saved after it (v${p.version ?? "?"}${p.versionAt ? `, ${fmt(p.versionAt)}` : ""}): the page as it was just before that later save.`, tone: p.exact ? "exact" : "approximate", restorable: Boolean(p.versionId) };
    default: return { label: "No record", detail: "The page existed at that date, but no history entry covers it.", tone: "none", restorable: false };
  }
}
export interface DiffOp { op: "same" | "add" | "del"; text: string }
export const blockTexts = (doc: PMNode | null | undefined): string[] => docBlocks(doc).map((b) => b.text.replace(/\s+/g, " ").trim()).filter(Boolean);
/** Block-level diff (longest common subsequence): `del` = in the old version only, `add` = in the new one only. */
export function diffBlocks(before: string[], after: string[]): DiffOp[] {
  const n = before.length, m = after.length; const w = m + 1; const L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * w + j] = before[i] === after[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  const out: DiffOp[] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (before[i] === after[j]) { out.push({ op: "same", text: before[i] }); i++; j++; } else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) out.push({ op: "del", text: before[i++] }); else out.push({ op: "add", text: after[j++] }); }
  while (i < n) out.push({ op: "del", text: before[i++] }); while (j < m) out.push({ op: "add", text: after[j++] });
  return out;
}
export const diffStats = (ops: DiffOp[]) => ({ added: ops.filter((o) => o.op === "add").length, removed: ops.filter((o) => o.op === "del").length, same: ops.filter((o) => o.op === "same").length });
/** Date scrubber: position 0…steps ↔ instant between `min` and `max` (linear). */
export const sliderToDate = (pos: number, steps: number, min: number, max: number) => new Date(Math.round(min + (Math.min(steps, Math.max(0, pos)) / steps) * (max - min)));
export const dateToSlider = (t: number, steps: number, min: number, max: number) => (max <= min ? steps : Math.round(((Math.min(max, Math.max(min, t)) - min) / (max - min)) * steps));

/* ------------------------------------------------------------------ health ------------------------------------------------------------------ */
export interface HealthSection<T = any> { count: number; ids: string[]; items: T[]; overdue?: number; withoutDate?: number }
export interface Health { computedAt: string; inactiveDays: number; score: { pages: number; issues: number }; orphans: HealthSection; brokenLinks: HealthSection; missingReferences: HealthSection; potentialDuplicates: HealthSection; untitled: HealthSection; inactiveProjects: HealthSection; openTasks: HealthSection }
export type HealthKey = "orphans" | "brokenLinks" | "missingReferences" | "potentialDuplicates" | "untitled" | "inactiveProjects" | "openTasks";
export const HEALTH_CATEGORIES: { id: HealthKey; label: string; hint: string }[] = [
  { id: "orphans", label: "Orphan pages", hint: "Pages without any accepted link or relation." },
  { id: "brokenLinks", label: "Broken links", hint: "Links, block references and files whose target no longer exists." },
  { id: "missingReferences", label: "Missing references", hint: "Citations of a reference that was deleted or never existed." },
  { id: "potentialDuplicates", label: "Potential duplicates", hint: "Pages with the same title or the same text." },
  { id: "untitled", label: "Untitled pages", hint: "Pages still called “Untitled”." },
  { id: "inactiveProjects", label: "Inactive projects", hint: "Projects whose pages have not changed for a while." },
  { id: "openTasks", label: "Open tasks", hint: "Tasks not done yet; overdue ones count as issues." },
];
/** Number that counts as "issues" for a category (the API counts overdue tasks, not all open ones). */
export const issueCount = (h: Health, k: HealthKey) => (k === "openTasks" ? h.openTasks.overdue ?? 0 : h[k].count);
export interface HealthRow { key: string; title: string; detail: string; href: string | null; links?: { label: string; href: string }[] }
const pageHref = (id: string, block?: string | null) => `/p/${id}${block ? `#block-${block}` : ""}`;
/** Drill-down rows of a category. Every row is a navigation to where the issue can be looked at — nothing is fixed automatically. */
export function healthRows(h: Health, k: HealthKey, fmt: (iso: string) => string = (s) => s): HealthRow[] {
  const items = h[k].items as any[];
  switch (k) {
    case "orphans": return items.map((o) => ({ key: o.id, title: `${o.icon ? `${o.icon} ` : ""}${o.title || "Untitled"}`, detail: `${o.section} · edited ${fmt(o.updatedAt)}`, href: pageHref(o.id) }));
    case "brokenLinks": return items.map((b, i) => ({ key: `${b.pageId}:${b.targetId}:${b.blockId ?? i}`, title: b.title || "Untitled", detail: `${b.kind === "page" ? "Link to a page" : b.kind === "block" ? "Reference to a block" : "File"} that ${b.reason === "trashed" ? "is in the trash" : "no longer exists"}`, href: pageHref(b.pageId, b.blockId) }));
    case "missingReferences": return items.map((m, i) => ({ key: `${m.pageId}:${m.refId}:${m.blockId ?? i}`, title: m.title || "Untitled", detail: `Citation of a reference that ${m.reason === "deleted" ? "was deleted" : "does not exist"}`, href: pageHref(m.pageId, m.blockId) }));
    case "potentialDuplicates": return items.map((d, i) => ({ key: `${d.reason}:${d.pageIds.join(",")}:${i}`, title: d.title || "Untitled", detail: `${d.pageIds.length} pages with the same ${d.reason === "title" ? "title" : "text"}`, href: null, links: (d.pageIds as string[]).map((id, n) => ({ label: `Open copy ${n + 1}`, href: pageHref(id) })) }));
    case "untitled": return items.map((u) => ({ key: u.id, title: "Untitled", detail: `${u.section} · ${u.empty ? "empty" : "has content"} · edited ${fmt(u.updatedAt)}`, href: pageHref(u.id) }));
    case "inactiveProjects": return items.map((p) => ({ key: p.id, title: `${p.icon ? `${p.icon} ` : ""}${p.title || "Untitled"}`, detail: `No change for ${p.idleDays} days (last activity ${fmt(p.lastActivityAt)})`, href: pageHref(p.id) }));
    case "openTasks": return items.map((t) => ({ key: t.id, title: t.title, detail: `${t.overdue ? "Overdue" : t.dueAt ? "Due" : "No date"}${t.dueAt ? ` · ${fmt(t.dueAt)}` : ""}${t.priority ? ` · ${t.priority}` : ""}`, href: t.pageId ? pageHref(t.pageId) : "/tasks" }));
  }
}

/* ------------------------------------------------------------------ semantic zoom ------------------------------------------------------------------ */
export const ZOOM_LEVELS = [{ id: 1, label: "Synopsis", key: "1" }, { id: 2, label: "Outline", key: "2" }, { id: 3, label: "Full", key: "3" }, { id: 4, label: "Full + connections", key: "4" }] as const;
export type ZoomLevel = 1 | 2 | 3 | 4;
/** ⌥1…⌥4 (Alt + digit, read from `code` so macOS dead keys do not matter). */
export function zoomShortcut(e: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string }): ZoomLevel | null { if (!e.altKey || e.metaKey || e.ctrlKey) return null; const m = /^Digit([1-4])$/.exec(e.code); return m ? (Number(m[1]) as ZoomLevel) : null; }
/**
 * Scroll anchor across levels. `blocks` = the ids of the top-level blocks of the document in order (null for a block without id);
 * `sections` = the outline (heading block ids, or the first block of the leading section). Returns the id of the outline section that
 * holds `blockId` — the element to bring back under the reader's eyes when going from the full text to the outline.
 */
export function sectionOf(blocks: (string | null)[], sections: { blockId: string | null }[], blockId: string | null): string | null {
  if (!blockId) return sections[0]?.blockId ?? null; const starts = new Set(sections.map((s) => s.blockId).filter(Boolean) as string[]);
  const at = blocks.indexOf(blockId); if (at < 0) return starts.has(blockId) ? blockId : sections[0]?.blockId ?? null;
  for (let i = at; i >= 0; i--) { const b = blocks[i]; if (b && starts.has(b)) return b; }
  return sections[0]?.blockId ?? null;
}

/* ------------------------------------------------------------------ ask my knowledge ------------------------------------------------------------------ */
export type AskScope = "all" | "page" | "project" | "selection";
export const SCOPES: { id: AskScope; label: string; hint: string }[] = [
  { id: "all", label: "All my notes", hint: "Evidence may come from the whole workspace." },
  { id: "page", label: "This page", hint: "Only the page that is open." },
  { id: "project", label: "This project", hint: "The project of the open page: its root page and every sub-page." },
  { id: "selection", label: "Selection", hint: "Only the text you selected — no search is run." },
];
export interface ScopeContext { pageId?: string | null; selection?: string | null; projectId?: string | null }
export const scopeAvailable = (s: AskScope, c: ScopeContext) => (s === "all" ? true : s === "page" ? Boolean(c.pageId) : s === "project" ? Boolean(c.pageId || c.projectId) : Boolean(c.selection?.trim()));
export const scopeUnavailableReason = (s: AskScope) => (s === "page" ? "Open a page first." : s === "project" ? "Open a page of the project first." : s === "selection" ? "Select text in a page first." : "");
/** Scope applies to the modes that search (notes, draft, contradictions); `selection` only to notes (API-NEXT-AI §2). */
export const scopeApplies = (mode: string, s: AskScope) => (s === "selection" ? mode === "notes" : mode === "notes" || mode === "draft" || mode === "contradictions");
/** Fields added to the body of POST /api/ai/chat for a scope. `all` adds nothing (the 2.x request, unchanged). */
export function scopeBody(mode: string, s: AskScope, c: ScopeContext & { selectionBlockId?: string | null }): Record<string, unknown> {
  if (s === "all" || !scopeApplies(mode, s) || !scopeAvailable(s, c)) return {};
  if (s === "page") return { scope: "page" };
  if (s === "project") return { scope: "project", ...(c.projectId ? { projectId: c.projectId } : {}) };
  return { scope: "selection", selection: c.selection!.slice(0, 20_000), ...(c.selectionBlockId ? { selectionBlockId: c.selectionBlockId } : {}) };
}
/** The honest "insufficient evidence" state, worded from what the API reported (`evidence`, `uncited`). */
export function evidenceNotice(evidence: string | null | undefined, uncited: boolean | undefined, mode = "notes", scope: AskScope = "all"): { title: string; detail: string } | null {
  const where = scope === "page" ? "this page" : scope === "project" ? "this project" : scope === "selection" ? "the selection" : mode === "draft" ? "your reference documents" : "your notes";
  if (evidence === "none") return { title: "Insufficient evidence", detail: `Nothing relevant enough was found in ${where}. No AI provider was called and nothing was answered from general knowledge.` };
  if (evidence === "insufficient") return { title: "Insufficient evidence", detail: uncited ? `The model wrote an answer without citing any passage of ${where}, so the answer was withheld.` : `The passages found in ${where} do not support an answer.` };
  return null;
}
export function starterQuestions(c: { pageId?: string | null; pageTitle?: string | null; hasSelection?: boolean }): { text: string; scope: AskScope }[] {
  const out: { text: string; scope: AskScope }[] = [];
  if (c.hasSelection) out.push({ text: "What does this passage claim, and what supports it?", scope: "selection" });
  if (c.pageId) out.push({ text: "What are the main claims of this page?", scope: "page" }, { text: "Which questions does this page leave open?", scope: "page" }, { text: "What did I decide in this project, and why?", scope: "project" });
  out.push({ text: "What did I write most recently, and what is still unresolved?", scope: "all" }, { text: "Which of my notes disagree with each other?", scope: "all" }, { text: "What are my open decisions?", scope: "all" });
  return out.slice(0, 5);
}

/* ------------------------------------------------------------------ brief ------------------------------------------------------------------ */
/** "overdue by 3 days", "today", "tomorrow", "in 4 days" — from two instants, calendar days in the viewer's zone. */
export function dueLabel(dueAt: string, now = new Date(), timeZone?: string): string {
  const a = new Date(`${dayKey(dueAt, timeZone)}T12:00:00Z`).getTime(), b = new Date(`${dayKey(now.toISOString(), timeZone)}T12:00:00Z`).getTime(); const d = Math.round((a - b) / 86_400_000);
  return d < -1 ? `overdue by ${-d} days` : d === -1 ? "overdue since yesterday" : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
}
