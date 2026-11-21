/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/graph/views.ts
 * Description      : graph views of the knowledge graph 2.0 (SPEC §4.3): global
 *                    | local | project | timeline | concepts | documents |
 *                    references. One assembler builds nodes (pages, canvases,
 *                    references, concepts, attachments) and edges (document
 *                    links, typed relations, AI suggestions, citations, concept
 *                    membership, database relations) with set-based SQL — a
 *                    fixed number of queries per view, whatever the size — and
 *                    each view chooses its page set. The 2.x answer of GET
 *                    /api/graph (no `view`) is untouched.
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

import { sql as dsql } from "drizzle-orm";
import { db } from "@/db";
import { HttpError } from "@/lib/errors";
import { descendants } from "@/lib/pages/service";
import { neighbourhoodIds } from "./service";

export const GRAPH_VIEWS = ["global", "local", "project", "timeline", "concepts", "documents", "references"] as const;
export type GraphView = (typeof GRAPH_VIEWS)[number];
export type NodeKindV = "page" | "database" | "research" | "row" | "canvas" | "reference" | "concept" | "attachment";
export type EdgeKindV = "link" | "relation" | "typed" | "ai_suggested" | "cites" | "reference" | "about" | "attachment";
export interface NodeV { id: string; entityId: string; kind: NodeKindV; title: string; icon: string | null; section: string | null; createdAt: string | null; updatedAt: string | null; databaseId: string | null; degree: number; in: number; out: number; status?: string; origin?: string; external?: boolean }
export interface EdgeV { id: string; source: string; target: string; kind: EdgeKindV; relType: string; origin: string; status: string; confidence: number | null; rationale: string | null; note: string | null; model: string | null; validFrom: string | null; validTo: string | null; sourceBlockId: string | null; targetBlockId: string | null; createdAt: string | null; sub: string | null }
export interface GraphViewData { view: GraphView; nodes: NodeV[]; edges: EdgeV[]; center: string | null; range?: { from: string; to: string }; buckets?: { date: string; created: number; updated: number; edges: number }[]; stats: { pages: number; references: number; concepts: number; edges: number; suggested: number } }
export interface ViewOpts { pageId?: string | null; depth?: number; from?: Date | null; to?: Date | null; suggestions?: boolean; hideOrphans?: boolean }

const pgArr = (a: string[]) => `{${a.map((x) => `"${x.replace(/"/g, "")}"`).join(",")}}`;
const rows = async <T = any>(q: ReturnType<typeof dsql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const nodeId = (kind: string, id: string) => (kind === "reference" ? `ref:${id}` : kind === "concept" ? `concept:${id}` : id);
const pageKind = (p: { type: string; database_id: string | null }): NodeKindV => (p.database_id ? "row" : p.type === "database" ? "database" : p.type === "research" ? "research" : p.type === "canvas" ? "canvas" : "page");

interface Assemble { wsId: string; pageIds: string[] | null; suggestions: boolean; references: "linked" | "all" | "none"; concepts: "linked" | "all" | "none"; attachments: boolean; section?: string | null; external?: Set<string> }
async function assemble(a: Assemble): Promise<{ nodes: Map<string, NodeV>; edges: EdgeV[] }> {
  const nodes = new Map<string, NodeV>(); const edges: EdgeV[] = []; const seen = new Set<string>();
  const where = [dsql`p.workspace_id = ${a.wsId}`, dsql`p.deleted_at is null`];
  if (a.pageIds) where.push(dsql`p.id = any(${pgArr(a.pageIds)}::uuid[])`); if (a.section) where.push(dsql`p.section = ${a.section}`);
  const pages = await rows<{ id: string; type: string; section: string; title: string; icon: string | null; database_id: string | null; created_at: Date; updated_at: Date }>(dsql`select p.id, p.type, p.section, p.title, p.icon, p.database_id, p.created_at, p.updated_at from pages p where ${dsql.join(where, dsql` and `)}`);
  for (const p of pages) nodes.set(p.id, { id: p.id, entityId: p.id, kind: pageKind(p), title: p.title || "Untitled", icon: p.icon, section: p.section, createdAt: iso(p.created_at), updatedAt: iso(p.updated_at), databaseId: p.database_id, degree: 0, in: 0, out: 0, ...(a.external?.has(p.id) ? { external: true } : {}) });
  const ids = [...nodes.keys()]; const inSet = dsql`${pgArr(ids)}::uuid[]`;
  const push = (e: EdgeV) => { if (!nodes.has(e.source) || !nodes.has(e.target) || e.source === e.target) return; const k = `${e.kind}|${e.relType}|${e.source}|${e.target}`; if (seen.has(k)) return; seen.add(k); edges.push(e); };
  const blank = { relType: "related", origin: "system", status: "accepted", confidence: null, rationale: null, note: null, model: null, validFrom: null, validTo: null, sourceBlockId: null, targetBlockId: null, createdAt: null, sub: null };
  const st = a.suggestions ? dsql`('suggested','accepted')` : dsql`('accepted')`;
  // references and concepts first, so that edges towards them find their node
  if (a.references !== "none") {
    const refs = await rows<{ id: string; title: string; cite_key: string; page_id: string | null; created_at: Date; updated_at: Date }>(a.references === "all"
      ? dsql`select r.id, r.title, r.cite_key, r.page_id, r.created_at, r.updated_at from "references" r where r.workspace_id = ${a.wsId} and r.deleted_at is null`
      : dsql`select r.id, r.title, r.cite_key, r.page_id, r.created_at, r.updated_at from "references" r where r.workspace_id = ${a.wsId} and r.deleted_at is null and (r.page_id = any(${inSet}) or exists (select 1 from knowledge_edges k where k.workspace_id = ${a.wsId} and ((k.to_id = r.id and k.target_kind = 'reference' and k.from_id = any(${inSet})) or (k.from_id = r.id and k.source_kind = 'reference' and k.to_id = any(${inSet})))))`);
    for (const r of refs) nodes.set(`ref:${r.id}`, { id: `ref:${r.id}`, entityId: r.id, kind: "reference", title: r.title, icon: null, section: null, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), databaseId: null, degree: 0, in: 0, out: 0 });
    for (const r of refs) if (r.page_id) push({ ...blank, id: `e-ref-${r.id}`, source: r.page_id, target: `ref:${r.id}`, kind: "reference", relType: "about", createdAt: iso(r.created_at), sub: r.cite_key });
  }
  if (a.concepts !== "none") {
    const cs = await rows<{ id: string; name: string; status: string; origin: string; created_at: Date; updated_at: Date }>(a.concepts === "all"
      ? dsql`select c.id, c.name, c.status, c.origin, c.created_at, c.updated_at from concepts c where c.workspace_id = ${a.wsId} and c.status in ${st}`
      : dsql`select c.id, c.name, c.status, c.origin, c.created_at, c.updated_at from concepts c where c.workspace_id = ${a.wsId} and c.status in ${st} and exists (select 1 from page_concepts pc where pc.concept_id = c.id and pc.status in ${st} and pc.page_id = any(${inSet}))`);
    for (const c of cs) nodes.set(`concept:${c.id}`, { id: `concept:${c.id}`, entityId: c.id, kind: "concept", title: c.name, icon: null, section: null, createdAt: iso(c.created_at), updatedAt: iso(c.updated_at), databaseId: null, degree: 0, in: 0, out: 0, status: c.status, origin: c.origin });
    if (cs.length && ids.length) {
      const pcs = await rows<{ page_id: string; concept_id: string; origin: string; status: string; confidence: number | null; block_id: string | null; model: string | null; created_at: Date }>(dsql`select pc.page_id, pc.concept_id, pc.origin, pc.status, pc.confidence, pc.block_id, pc.model, pc.created_at from page_concepts pc where pc.status in ${st} and pc.page_id = any(${inSet}) and pc.concept_id = any(${pgArr(cs.map((c) => c.id))}::uuid[])`);
      for (const pc of pcs) push({ ...blank, id: `e-about-${pc.page_id}-${pc.concept_id}`, source: pc.page_id, target: `concept:${pc.concept_id}`, kind: "about", relType: "about", origin: pc.origin, status: pc.status, confidence: pc.confidence, model: pc.model, sourceBlockId: pc.block_id, createdAt: iso(pc.created_at) });
    }
  }
  if (ids.length || nodes.size) {
    // every stored edge whose two ends are in the view (pages by id; references and concepts by their prefixed node id)
    const all = [...nodes.values()].map((n) => n.entityId);
    const ks = await rows<any>(dsql`select k.* from knowledge_edges k where k.workspace_id = ${a.wsId} and k.status in ${st} and k.from_id = any(${pgArr(all)}::uuid[]) and k.to_id = any(${pgArr(all)}::uuid[])`);
    for (const k of ks) push({ id: k.id, source: nodeId(k.source_kind, k.from_id), target: nodeId(k.target_kind, k.to_id), kind: k.kind === "relation" ? "typed" : (k.kind as EdgeKindV), relType: k.rel_type, origin: k.origin, status: k.status, confidence: k.confidence, rationale: k.rationale, note: k.note, model: k.model, validFrom: iso(k.valid_from), validTo: iso(k.valid_to), sourceBlockId: k.source_block_id, targetBlockId: k.target_block_id, createdAt: iso(k.created_at), sub: k.kind === "ai_suggested" ? k.model : null });
  }
  if (ids.length) {
    const rels = await rows<{ id: string; a: string; b: string; prop: string; created_at: Date }>(dsql`select r.id, fr.page_id as a, tr.page_id as b, dp.name as prop, r.created_at from relations r join database_rows fr on fr.id = r.from_row_id join database_rows tr on tr.id = r.to_row_id join database_properties dp on dp.id = r.property_id where fr.page_id = any(${inSet}) and tr.page_id = any(${inSet}) and fr.deleted_at is null and tr.deleted_at is null`);
    for (const r of rels) push({ ...blank, id: r.id, source: r.a, target: r.b, kind: "relation", createdAt: iso(r.created_at), sub: r.prop });
    if (a.attachments) {
      const atts = await rows<{ id: string; page_id: string; filename: string; created_at: Date }>(dsql`select a.id, a.page_id, a.filename, a.created_at from attachments a where a.workspace_id = ${a.wsId} and a.deleted_at is null and a.page_id = any(${inSet})`);
      for (const t of atts) { const id = `att:${t.id}`; nodes.set(id, { id, entityId: t.id, kind: "attachment", title: t.filename, icon: null, section: null, createdAt: iso(t.created_at), updatedAt: iso(t.created_at), databaseId: null, degree: 0, in: 0, out: 0 }); push({ ...blank, id: `e-att-${t.id}`, source: t.page_id, target: id, kind: "attachment", createdAt: iso(t.created_at) }); }
    }
  }
  for (const e of edges) { const s = nodes.get(e.source)!, t = nodes.get(e.target)!; s.degree++; t.degree++; s.out++; t.in++; }
  return { nodes, edges };
}
const finish = (view: GraphView, g: { nodes: Map<string, NodeV>; edges: EdgeV[] }, center: string | null, hideOrphans: boolean | undefined, extra: Partial<GraphViewData> = {}): GraphViewData => {
  let nodes = [...g.nodes.values()]; if (hideOrphans) nodes = nodes.filter((n) => n.degree > 0 || n.id === center);
  nodes.sort((x, y) => y.degree - x.degree || x.title.localeCompare(y.title) || x.id.localeCompare(y.id));
  const count = (k: NodeKindV[]) => nodes.filter((n) => k.includes(n.kind)).length;
  return { view, nodes, edges: g.edges, center, ...extra, stats: { pages: count(["page", "database", "research", "row", "canvas"]), references: count(["reference"]), concepts: count(["concept"]), edges: g.edges.length, suggested: g.edges.filter((e) => e.status === "suggested").length } };
};
async function livePage(wsId: string, pageId: string | null | undefined, view: string): Promise<string> {
  if (!pageId) throw new HttpError(400, `view=${view} needs pageId`, "bad_request");
  const [p] = await rows<{ id: string }>(dsql`select id from pages where id = ${pageId} and workspace_id = ${wsId} and deleted_at is null`);
  if (!p) throw new HttpError(404, "Page not found", "not_found"); return p.id;
}

export async function buildGraphView(wsId: string, view: GraphView, o: ViewOpts = {}): Promise<GraphViewData> {
  const suggestions = o.suggestions !== false; const base = { wsId, suggestions };
  switch (view) {
    case "global": return finish(view, await assemble({ ...base, pageIds: null, references: "all", concepts: "all", attachments: false }), null, o.hideOrphans);
    case "local": {
      const center = await livePage(wsId, o.pageId, view);
      const ids = [...(await neighbourhoodIds(wsId, center, Math.min(4, Math.max(1, o.depth ?? 1)), suggestions)).keys()];
      return finish(view, await assemble({ ...base, pageIds: ids, references: "linked", concepts: "linked", attachments: true }), center, o.hideOrphans);
    }
    case "project": {
      const center = await livePage(wsId, o.pageId, view); const inside = [center, ...(await descendants(wsId, center))];
      // pages one hop outside the project are kept, flagged `external`, so the project is shown in its context
      const near = inside.length ? await rows<{ id: string }>(dsql`select distinct case when k.from_id = any(${pgArr(inside)}::uuid[]) then k.to_id else k.from_id end as id from knowledge_edges k where k.workspace_id = ${wsId} and k.status in ${suggestions ? dsql`('suggested','accepted')` : dsql`('accepted')`} and k.source_kind = 'page' and k.target_kind = 'page' and (k.from_id = any(${pgArr(inside)}::uuid[]) or k.to_id = any(${pgArr(inside)}::uuid[]))`) : [];
      const external = new Set(near.map((n) => n.id).filter((id) => !inside.includes(id)));
      return finish(view, await assemble({ ...base, pageIds: [...inside, ...external], references: "linked", concepts: "linked", attachments: false, external }), center, o.hideOrphans);
    }
    case "timeline": {
      const to = o.to ?? new Date(); const from = o.from ?? new Date(to.getTime() - 90 * 864e5);
      if (from > to) throw new HttpError(400, "from is after to", "bad_request");
      const f = from.toISOString(), t = to.toISOString();
      const active = await rows<{ id: string }>(dsql`select id from pages where workspace_id = ${wsId} and deleted_at is null and ((created_at >= ${f}::timestamptz and created_at <= ${t}::timestamptz) or (updated_at >= ${f}::timestamptz and updated_at <= ${t}::timestamptz))`);
      const g = await assemble({ ...base, pageIds: active.map((x) => x.id), references: "linked", concepts: "linked", attachments: false });
      // only the edges that appeared in the range; a typed relation is also kept when its validity interval overlaps the range
      g.edges = g.edges.filter((e) => (e.createdAt && e.createdAt >= f && e.createdAt <= t) || ((e.validFrom || e.validTo) && (!e.validFrom || e.validFrom <= t) && (!e.validTo || e.validTo >= f)));
      for (const n of g.nodes.values()) { n.degree = 0; n.in = 0; n.out = 0; } for (const e of g.edges) { const s = g.nodes.get(e.source)!, x = g.nodes.get(e.target)!; s.degree++; x.degree++; s.out++; x.in++; }
      const day = (s: string | null) => (s ? s.slice(0, 10) : null); const b = new Map<string, { date: string; created: number; updated: number; edges: number }>();
      const at = (d: string | null) => { if (!d || d < f.slice(0, 10) || d > t.slice(0, 10)) return null; if (!b.has(d)) b.set(d, { date: d, created: 0, updated: 0, edges: 0 }); return b.get(d)!; };
      for (const n of g.nodes.values()) if (n.kind !== "reference" && n.kind !== "concept") { const c = at(day(n.createdAt)); if (c) c.created++; const u = at(day(n.updatedAt)); if (u && day(n.updatedAt) !== day(n.createdAt)) u.updated++; }
      for (const e of g.edges) { const c = at(day(e.createdAt)); if (c) c.edges++; }
      return finish(view, g, null, o.hideOrphans, { range: { from: f, to: t }, buckets: [...b.values()].sort((x, y) => x.date.localeCompare(y.date)) });
    }
    case "concepts": {
      const linked = await rows<{ id: string }>(dsql`select distinct pc.page_id as id from page_concepts pc join concepts c on c.id = pc.concept_id where c.workspace_id = ${wsId} and pc.status in ${suggestions ? dsql`('suggested','accepted')` : dsql`('accepted')`}`);
      const g = await assemble({ ...base, pageIds: linked.map((x) => x.id), references: "none", concepts: "all", attachments: false });
      g.edges = g.edges.filter((e) => e.kind === "about" || e.source.startsWith("concept:") || e.target.startsWith("concept:"));
      for (const n of g.nodes.values()) { n.degree = 0; n.in = 0; n.out = 0; } for (const e of g.edges) { const s = g.nodes.get(e.source)!, x = g.nodes.get(e.target)!; s.degree++; x.degree++; s.out++; x.in++; }
      return finish(view, g, null, o.hideOrphans);
    }
    case "documents": return finish(view, await assemble({ ...base, pageIds: null, section: "documents", references: "linked", concepts: "none", attachments: true }), null, o.hideOrphans);
    case "references": {
      const citing = await rows<{ id: string }>(dsql`select r.page_id as id from "references" r where r.workspace_id = ${wsId} and r.deleted_at is null and r.page_id is not null union select k.from_id from knowledge_edges k where k.workspace_id = ${wsId} and k.target_kind = 'reference' and k.source_kind = 'page' union select k.to_id from knowledge_edges k where k.workspace_id = ${wsId} and k.source_kind = 'reference' and k.target_kind = 'page'`);
      const g = await assemble({ ...base, pageIds: citing.map((x) => x.id), references: "all", concepts: "none", attachments: false });
      g.edges = g.edges.filter((e) => e.source.startsWith("ref:") || e.target.startsWith("ref:"));
      for (const n of g.nodes.values()) { n.degree = 0; n.in = 0; n.out = 0; } for (const e of g.edges) { const s = g.nodes.get(e.source)!, x = g.nodes.get(e.target)!; s.degree++; x.degree++; s.out++; x.in++; }
      return finish(view, g, null, o.hideOrphans);
    }
  }
}
