/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/knowledge/GraphPanels.tsx
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
 * file: src/components/knowledge/GraphPanels.tsx
 * description: side panels and dialogs of the Knowledge Graph 2.0 — node inspector, edge inspector (accept / reject a suggested
 *   relation inline, edit note and validity dates, delete), the list of suggestions awaiting a decision, the typed-relation dialog
 *   (two pages chosen with the picker) and the concepts manager. Everything a model produced carries the AI mark and changes
 *   nothing until the user decides.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, X, Pencil, Trash2, Plus, Route, Locate, ExternalLink, Lightbulb } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Dialog, DialogContent, SheetContent, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import type { EdgeV, NodeV } from "@/lib/graph/views";
import type { TreeNode } from "@/components/shell/types";
import { EDGE_KIND_LABEL, REL_LABEL, REL_TYPES, edgeStyle, isAI, isRealEdge } from "@/lib/client/knowledge";
import { AIBadge, PagePicker, Segmented, fmtDay, pageGlyph, useTree } from "./shared";

export const KIND_LABEL: Record<string, string> = { page: "Page", database: "Database", research: "Research page", row: "Database row", canvas: "Canvas", reference: "Reference", concept: "Concept", attachment: "Attachment" };
const TONE_CLASS: Record<string, string> = { accent: "text-accent", success: "text-success-text", danger: "text-danger-text", warning: "text-fg", ai: "text-ai", muted: "text-fg-muted" };
const invalidate = (qc: ReturnType<typeof useQueryClient>) => { for (const k of ["kgraph", "kg-insights", "kg-concepts", "brief", "graph-suggestions", "page-relations"]) qc.invalidateQueries({ queryKey: [k] }); };
const entity = (nodeId: string) => nodeId.replace(/^(ref|concept|att):/, "");
export const nodeHref = (n: Pick<NodeV, "id" | "kind" | "entityId">) => (n.kind === "reference" ? "/research" : n.kind === "concept" || n.kind === "attachment" ? null : `/p/${n.entityId}`);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block"><span className="mb-1 block text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">{label}</span>{children}</label>;
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="flex gap-2 py-1 text-ui"><dt className="w-24 shrink-0 text-fg-muted">{k}</dt><dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</dd></div>;

/** Accept / reject / put back a suggestion: a relation or link suggestion (PATCH relation), or a suggested page → concept link (PATCH concept). */
export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ edge, status }: { edge: Pick<EdgeV, "id" | "kind" | "source" | "target">; status: "accepted" | "rejected" | "suggested" }) =>
      edge.kind === "about" ? api(`/api/concepts/${entity(edge.target)}`, { method: "PATCH", json: { pageLinks: [{ pageId: entity(edge.source), status }] } }) : api(`/api/graph/relations/${edge.id}`, { method: "PATCH", json: { status } }),
    onSuccess: (_d, v) => {
      invalidate(qc);
      if (v.status === "suggested") { toast("Back in the suggestions"); return; }
      toast(v.status === "accepted" ? "Relation accepted" : "Suggestion rejected", { tone: v.status === "accepted" ? "success" : "neutral", action: { label: "Undo", run: async () => { await (v.edge.kind === "about" ? api(`/api/concepts/${entity(v.edge.target)}`, { method: "PATCH", json: { pageLinks: [{ pageId: entity(v.edge.source), status: "suggested" }] } }) : api(`/api/graph/relations/${v.edge.id}`, { method: "PATCH", json: { status: "suggested" } })); invalidate(qc); } } });
    },
    onError: (e: any) => toast("Could not save the decision", { description: e?.message, tone: "danger" }),
  });
}
export function DecideButtons({ edge, compact }: { edge: EdgeV; compact?: boolean }) {
  const d = useDecide(); const busy = d.isPending;
  return (
    <div className="flex shrink-0 gap-1" data-testid="decide">
      <Button size={compact ? "xs" : "sm"} variant="outline" className="max-md:h-11 max-md:px-3" disabled={busy} onClick={() => d.mutate({ edge, status: "accepted" })} aria-label="Accept this suggestion"><Check /> Accept</Button>
      <Button size={compact ? "xs" : "sm"} variant="ghost" className="max-md:h-11 max-md:px-3" disabled={busy} onClick={() => d.mutate({ edge, status: "rejected" })} aria-label="Reject this suggestion"><X /> Reject</Button>
    </div>
  );
}
/** One line "A —relation→ B" with the AI mark when a model proposed it. */
export function EdgeLine({ edge, nodes, onFocus }: { edge: EdgeV; nodes: Map<string, NodeV>; onFocus?: (id: string) => void }) {
  const a = nodes.get(edge.source), b = nodes.get(edge.target); const st = edgeStyle(edge);
  const N = ({ n, id }: { n?: NodeV; id: string }) => <button type="button" onClick={() => onFocus?.(id)} className="min-w-0 truncate rounded-chip text-left font-medium hover:underline">{n ? `${n.icon ? `${n.icon} ` : ""}${n.title}` : "…"}</button>;
  return <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ui"><N n={a} id={edge.source} /><span className={cn("inline-flex shrink-0 items-center gap-1 text-micro", TONE_CLASS[st.tone])}><ArrowRight className="size-3" />{edge.kind === "typed" || edge.kind === "ai_suggested" ? REL_LABEL[edge.relType] ?? edge.relType : (EDGE_KIND_LABEL[edge.kind] ?? edge.kind).toLowerCase()}</span><N n={b} id={edge.target} />{isAI(edge) && <AIBadge />}</div>;
}

export function NodeInspector({ node, nodes, edges, onClose, onFocus, onEdge, onLocal, onRelate, onPath, pathTo }: { node: NodeV; nodes: Map<string, NodeV>; edges: EdgeV[]; onClose: () => void; onFocus: (id: string) => void; onEdge: (e: EdgeV) => void; onLocal: (id: string) => void; onRelate: (id: string) => void; onPath: () => void; pathTo: string | null }) {
  const mine = edges.filter((e) => e.source === node.id || e.target === node.id); const href = nodeHref(node); const qc = useQueryClient();
  const conceptDecide = useMutation({ mutationFn: (status: "accepted" | "rejected") => api(`/api/concepts/${node.entityId}`, { method: "PATCH", json: { status } }), onSuccess: (_d, s) => { invalidate(qc); toast(s === "accepted" ? "Concept accepted" : "Concept rejected", { tone: s === "accepted" ? "success" : "neutral" }); }, onError: (e: any) => toast("Could not save", { description: e?.message, tone: "danger" }) });
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="node-inspector">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1"><div className="text-[15px] font-semibold leading-5 [overflow-wrap:anywhere]">{node.icon ? `${node.icon} ` : ""}{node.title}</div><div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-micro text-fg-muted"><span>{KIND_LABEL[node.kind] ?? node.kind}</span>{node.section && <span>· {node.section}</span>}<span>· {node.degree} connection{node.degree === 1 ? "" : "s"}</span>{node.external && <Badge>outside the project</Badge>}{node.origin === "ai" && <AIBadge />}</div></div>
        <button type="button" onClick={onClose} aria-label="Close inspector" className="icon-btn max-md:size-11"><X /></button>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
        {href && <Button asChild size="sm" variant="outline" className="max-md:h-11"><Link href={href}><ExternalLink /> Open</Link></Button>}
        {node.kind !== "reference" && node.kind !== "concept" && node.kind !== "attachment" && <><Button size="sm" variant="outline" className="max-md:h-11" onClick={() => onLocal(node.entityId)}><Locate /> Local view</Button><Button size="sm" variant="outline" className="max-md:h-11" onClick={() => onRelate(node.entityId)}><Plus /> Relation</Button></>}
        <Button size="sm" variant={pathTo ? "secondary" : "outline"} className="max-md:h-11" onClick={onPath} aria-pressed={Boolean(pathTo)}><Route /> {pathTo ? "Clear path" : "Path to…"}</Button>
        {node.kind === "concept" && node.status === "suggested" && <><Button size="sm" variant="outline" className="max-md:h-11" disabled={conceptDecide.isPending} onClick={() => conceptDecide.mutate("accepted")}><Check /> Accept concept</Button><Button size="sm" variant="ghost" className="max-md:h-11" disabled={conceptDecide.isPending} onClick={() => conceptDecide.mutate("rejected")}><X /> Reject</Button></>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {mine.length ? <ul className="space-y-1">{mine.map((e) => <li key={e.id} className={cn("rounded-control border border-transparent p-2 hover:border-line hover:bg-bg", e.status === "suggested" && "ai-surface")} data-edge={e.id} data-status={e.status}>
          <EdgeLine edge={e} nodes={nodes} onFocus={onFocus} />
          {e.rationale && <p className="mt-1 text-micro leading-4 text-fg-muted">{e.rationale}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{e.status === "suggested" && <DecideButtons edge={e} compact />}<button type="button" onClick={() => onEdge(e)} className="h-7 rounded-chip px-2 text-micro font-medium text-fg-muted hover:bg-bg-hover hover:text-fg max-md:h-11 max-md:text-[13px]">Details</button></div>
        </li>)}</ul> : <p className="p-3 text-ui text-fg-muted">No connection in this view.</p>}
      </div>
    </div>
  );
}

export function EdgeInspector({ edge, nodes, onClose, onFocus, onEdit }: { edge: EdgeV; nodes: Map<string, NodeV>; onClose: () => void; onFocus: (id: string) => void; onEdit: (e: EdgeV) => void }) {
  const st = edgeStyle(edge); const qc = useQueryClient(); const src = nodes.get(edge.source);
  const del = useMutation({ mutationFn: () => api(`/api/graph/relations/${edge.id}`, { method: "DELETE" }), onSuccess: () => { invalidate(qc); toast("Relation deleted"); onClose(); }, onError: (e: any) => toast("Could not delete", { description: e?.message, tone: "danger" }) });
  const editable = edge.kind === "typed" && isRealEdge(edge);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="edge-inspector" data-edge={edge.id} data-status={edge.status}>
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5"><div className="min-w-0 flex-1"><div className="mb-1 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.08em] text-fg-muted">{EDGE_KIND_LABEL[edge.kind] ?? edge.kind}{st.ai && <AIBadge model={edge.model} />}{edge.status === "suggested" && <Badge tone="ai">suggested</Badge>}</div><EdgeLine edge={edge} nodes={nodes} onFocus={onFocus} /></div><button type="button" onClick={onClose} aria-label="Close inspector" className="icon-btn max-md:size-11"><X /></button></div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        {edge.status === "suggested" && <div className="ai-surface mb-3 p-2.5"><p className="mb-2 text-ui leading-5">A model proposed this {edge.kind === "about" ? "concept link" : "relation"}. It is not part of your graph until you accept it.</p><DecideButtons edge={edge} /></div>}
        <dl>
          <Row k="Origin">{edge.origin === "ai" ? "AI model" : edge.origin === "user" ? "You" : "Derived from the documents"}</Row>
          <Row k="Status">{edge.status}</Row>
          {edge.confidence != null && <Row k="Confidence">{Math.round(edge.confidence * 100)} %</Row>}
          {edge.rationale && <Row k="Rationale">{edge.rationale}</Row>}
          {edge.model && <Row k="Model">{edge.model}</Row>}
          {edge.note && <Row k="Note">{edge.note}</Row>}
          {(edge.validFrom || edge.validTo) && <Row k="Valid">{edge.validFrom ? fmtDay(edge.validFrom) : "…"} → {edge.validTo ? fmtDay(edge.validTo) : "…"}</Row>}
          {edge.createdAt && <Row k="Created">{fmtDay(edge.createdAt)}</Row>}
          {edge.sub && edge.kind === "relation" && <Row k="Property">{edge.sub}</Row>}
          {edge.sourceBlockId && src && nodeHref(src) && <Row k="In the text"><Link className="text-accent hover:underline" href={`${nodeHref(src)}#block-${edge.sourceBlockId}`}>Open the block that holds it</Link></Row>}
        </dl>
        {!editable && edge.status !== "suggested" && <p className="mt-2 text-micro leading-4 text-fg-muted">{edge.kind === "link" || edge.kind === "cites" ? "This edge comes from the text of the page: edit the page to change it." : edge.kind === "ai_suggested" ? "An accepted link suggestion. Reject it to remove the link." : "This edge is derived from your data and is edited where it comes from."}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {editable && <Button size="sm" variant="outline" className="max-md:h-11" onClick={() => onEdit(edge)}><Pencil /> Edit</Button>}
          {editable && <Button size="sm" variant="ghost" className="text-danger-text max-md:h-11" disabled={del.isPending} onClick={() => { if (window.confirm("Delete this relation? This cannot be undone.")) del.mutate(); }}><Trash2 /> Delete</Button>}
          {edge.kind === "ai_suggested" && edge.status === "accepted" && <RejectAccepted edge={edge} />}
        </div>
      </div>
    </div>
  );
}
function RejectAccepted({ edge }: { edge: EdgeV }) { const d = useDecide(); return <Button size="sm" variant="ghost" className="max-md:h-11" disabled={d.isPending} onClick={() => d.mutate({ edge, status: "rejected" })}><X /> Reject this link</Button>; }

export function SuggestedList({ edges, nodes, onFocus, onEdge }: { edges: EdgeV[]; nodes: Map<string, NodeV>; onFocus: (id: string) => void; onEdge: (e: EdgeV) => void }) {
  const list = edges.filter((e) => e.status === "suggested");
  if (!list.length) return <p className="p-4 text-ui leading-5 text-fg-muted">No suggestion is waiting in this view. Suggestions come from “Run AI analysis” (Insights) and from the link suggestions of a page; they are never applied on their own.</p>;
  return <ul className="space-y-1.5 p-2" data-testid="suggested-list">{list.map((e) => <li key={e.id} className="ai-surface p-2.5" data-edge={e.id}><EdgeLine edge={e} nodes={nodes} onFocus={onFocus} />{e.rationale && <p className="mt-1 text-micro leading-4 text-fg-muted">{e.rationale}</p>}<div className="mt-2 flex flex-wrap items-center gap-1.5"><DecideButtons edge={e} compact />{e.confidence != null && <span className="text-micro text-fg-muted">{Math.round(e.confidence * 100)} % confidence</span>}<button type="button" onClick={() => onEdge(e)} className="ml-auto h-7 rounded-chip px-2 text-micro font-medium text-fg-muted hover:bg-bg-hover max-md:h-11">Details</button></div></li>)}</ul>;
}

/* ------------------------------------------------------------------ typed relation: create / edit ------------------------------------------------------------------ */
const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : ""); const fromDateInput = (v: string) => (v ? `${v}T00:00:00.000Z` : null);
export interface RelationDraft { id?: string; fromId?: string | null; toId?: string | null; relType?: string; note?: string | null; validFrom?: string | null; validTo?: string | null }
export function RelationDialog({ draft, onClose }: { draft: RelationDraft | null; onClose: () => void }) {
  const qc = useQueryClient(); const { data: tree = [] } = useTree(); const editing = Boolean(draft?.id);
  const [from, setFrom] = React.useState<string | null>(null); const [to, setTo] = React.useState<string | null>(null); const [relType, setRelType] = React.useState("related"); const [note, setNote] = React.useState(""); const [vf, setVf] = React.useState(""); const [vt, setVt] = React.useState(""); const [pick, setPick] = React.useState<"from" | "to" | null>(null); const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (!draft) return; setFrom(draft.fromId ?? null); setTo(draft.toId ?? null); setRelType(draft.relType ?? "related"); setNote(draft.note ?? ""); setVf(toDateInput(draft.validFrom)); setVt(toDateInput(draft.validTo)); setErr(null); }, [draft]);
  const title = (id: string | null) => { const n = tree.find((x) => x.id === id); return n ? `${pageGlyph(n)} ${n.title || "Untitled"}` : id ? "Page" : "Choose a page…"; };
  const save = useMutation({
    mutationFn: () => editing ? api(`/api/graph/relations/${draft!.id}`, { method: "PATCH", json: { relType, note: note.trim() || null, validFrom: fromDateInput(vf), validTo: fromDateInput(vt) } })
      : api("/api/graph/relations", { method: "POST", json: { fromId: from, toId: to, relType, note: note.trim() || null, validFrom: fromDateInput(vf), validTo: fromDateInput(vt) } }),
    onSuccess: () => { invalidate(qc); toast(editing ? "Relation updated" : "Relation created", { tone: "success" }); onClose(); },
    onError: (e: any) => setErr(e instanceof ApiError && e.code === "relation_exists" ? "This relation already exists between these two pages." : e instanceof ApiError && e.code === "bad_node" ? "Choose two different, existing pages." : e?.message ?? "Could not save"),
  });
  const ok = Boolean(from && to && from !== to) && (!vf || !vt || vf <= vt);
  const input = "h-11 w-full rounded-control border border-line bg-bg px-3 text-[16px] outline-none focus:border-accent/60 sm:h-9 sm:text-ui";
  return (
    <>
      <Dialog open={Boolean(draft) && !pick} onOpenChange={(o) => { if (!o && !pick) onClose(); }}>
        <SheetContent title={editing ? "Edit relation" : "New relation"} description="A typed relation between two pages. You create it, so it is part of your graph at once.">
          <form className="grid gap-3" data-testid="relation-form" onSubmit={(e) => { e.preventDefault(); if (ok) save.mutate(); }}>
            <Field label="From"><button type="button" disabled={editing} data-testid="rel-from" onClick={() => setPick("from")} className={cn(input, "truncate text-left disabled:opacity-60")}>{title(from)}</button></Field>
            <Field label="Relation"><select value={relType} onChange={(e) => setRelType(e.target.value)} aria-label="Relation type" data-testid="rel-type" className={input}>{REL_TYPES.map((r) => <option key={r} value={r}>{REL_LABEL[r]}</option>)}</select></Field>
            <Field label="To"><button type="button" disabled={editing} data-testid="rel-to" onClick={() => setPick("to")} className={cn(input, "truncate text-left disabled:opacity-60")}>{title(to)}</button></Field>
            <Field label="Note (optional)"><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} aria-label="Note" className={cn(input, "h-auto min-h-[4.5rem] py-2 sm:h-auto")} /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Valid from"><input type="date" value={vf} onChange={(e) => setVf(e.target.value)} aria-label="Valid from" className={input} /></Field><Field label="Valid to"><input type="date" value={vt} onChange={(e) => setVt(e.target.value)} aria-label="Valid to" className={input} /></Field></div>
            {vf && vt && vf > vt && <p role="alert" className="text-ui text-danger-text">“Valid to” must not be before “Valid from”.</p>}
            {err && <p role="alert" className="text-ui text-danger-text">{err}</p>}
            <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" className="max-md:h-11" onClick={onClose}>Cancel</Button><Button type="submit" className="max-md:h-11" disabled={!ok || save.isPending}>{save.isPending && <Spinner className="size-3.5" />}{editing ? "Save" : "Create relation"}</Button></div>
          </form>
        </SheetContent>
      </Dialog>
      <PagePicker open={pick !== null} onOpenChange={(o) => { if (!o) setPick(null); }} title={pick === "from" ? "Relation from…" : "Relation to…"} exclude={[pick === "from" ? to : from].filter(Boolean) as string[]} current={pick === "from" ? from : to} onPick={(n: TreeNode) => { if (pick === "from") setFrom(n.id); else setTo(n.id); }} />
    </>
  );
}

/* ------------------------------------------------------------------ concepts ------------------------------------------------------------------ */
interface Concept { id: string; name: string; description: string | null; origin: string; status: string; model: string | null; pages: number; suggestedPages: number; pageLinks?: { pageId: string; title: string; icon: string | null; origin: string; status: string; confidence: number | null; model: string | null }[] }
export function ConceptsManager({ open, onOpenChange, onShow }: { open: boolean; onOpenChange: (o: boolean) => void; onShow?: (conceptId: string) => void }) {
  const qc = useQueryClient(); const [status, setStatus] = React.useState<"accepted" | "suggested" | "rejected">("accepted"); const [sel, setSel] = React.useState<string | null>(null); const [name, setName] = React.useState(""); const [picking, setPicking] = React.useState(false);
  const list = useQuery({ queryKey: ["kg-concepts", status], enabled: open, queryFn: () => api<{ concepts: Concept[] }>(`/api/concepts?status=${status}`) });
  const one = useQuery({ queryKey: ["kg-concepts", "one", sel], enabled: open && Boolean(sel), queryFn: () => api<Concept>(`/api/concepts/${sel}`) });
  const done = (msg?: string) => { invalidate(qc); if (msg) toast(msg, { tone: "success" }); }; const fail = (e: any) => toast(e instanceof ApiError && e.code === "concept_exists" ? "A concept with this name already exists" : "Could not save", { description: e?.message, tone: "danger" });
  const create = useMutation({ mutationFn: () => api<Concept>("/api/concepts", { method: "POST", json: { name: name.trim() } }), onSuccess: (c) => { setName(""); setStatus("accepted"); setSel(c.id); done("Concept created"); }, onError: fail });
  const patch = useMutation({ mutationFn: (json: Record<string, unknown>) => api<Concept>(`/api/concepts/${sel}`, { method: "PATCH", json }), onSuccess: () => done(), onError: fail });
  const del = useMutation({ mutationFn: () => api(`/api/concepts/${sel}`, { method: "DELETE" }), onSuccess: () => { setSel(null); done("Concept deleted"); }, onError: fail });
  const c = one.data; const [draft, setDraft] = React.useState({ name: "", description: "" }); React.useEffect(() => { if (c) setDraft({ name: c.name, description: c.description ?? "" }); }, [c?.id, c?.name, c?.description]); // eslint-disable-line react-hooks/exhaustive-deps
  const input = "h-11 w-full rounded-control border border-line bg-bg px-3 text-[16px] outline-none focus:border-accent/60 sm:h-9 sm:text-ui";
  return (
    <>
      <Dialog open={open && !picking} onOpenChange={(o) => { if (!picking) onOpenChange(o); }}>
        <DialogContent title="Concepts" description="Ideas that several pages carry. Concepts proposed by a model stay suggestions until you accept them." wide>
          <div className="grid gap-4 md:grid-cols-[16rem_1fr]" data-testid="concepts-manager">
            <div className="min-w-0">
              <Segmented label="Concept status" value={status} onChange={(s) => { setStatus(s); setSel(null); }} size="sm" options={[{ id: "accepted", label: "Accepted" }, { id: "suggested", label: "Suggested" }, { id: "rejected", label: "Rejected" }]} />
              <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="New concept name" placeholder="New concept…" className={input} /><Button type="submit" size="icon" className="max-md:size-11 shrink-0" aria-label="Create concept" disabled={!name.trim() || create.isPending}><Plus /></Button></form>
              <ul className="mt-2 max-h-[40dvh] space-y-0.5 overflow-y-auto overscroll-contain md:max-h-[52dvh]" aria-label="Concepts">
                {list.isLoading ? <li className="p-2"><Spinner /></li> : list.data?.concepts.length ? list.data.concepts.map((x) => <li key={x.id}><button type="button" aria-current={x.id === sel} onClick={() => setSel(x.id)} className={cn("flex min-h-11 w-full items-center gap-2 rounded-control px-2 text-left text-ui hover:bg-bg-hover sm:min-h-9", x.id === sel && "bg-accent-soft")}><Lightbulb className="size-4 shrink-0 text-fg-muted" /><span className="min-w-0 flex-1 truncate">{x.name}</span>{x.origin === "ai" && <AIBadge />}<span className="shrink-0 text-micro tabular-nums text-fg-muted">{x.pages}{x.suggestedPages ? ` +${x.suggestedPages}` : ""}</span></button></li>) : <li className="p-3 text-ui text-fg-muted">{status === "accepted" ? "No concept yet. Create one, or run the AI analysis from Insights." : `No ${status} concept.`}</li>}
              </ul>
            </div>
            <div className="min-w-0 rounded-card border border-line bg-bg p-3">
              {!sel ? <p className="grid h-full min-h-32 place-items-center text-ui text-fg-muted">Select a concept.</p> : one.isLoading || !c ? <Spinner /> : <>
                <div className="mb-2 flex flex-wrap items-center gap-1.5">{c.origin === "ai" && <AIBadge model={c.model} />}<Badge tone={c.status === "suggested" ? "ai" : c.status === "rejected" ? "danger" : "neutral"}>{c.status}</Badge>
                  {c.status !== "accepted" && <Button size="xs" variant="outline" className="max-md:h-11" onClick={() => patch.mutate({ status: "accepted" })}><Check /> Accept</Button>}
                  {c.status === "suggested" && <Button size="xs" variant="ghost" className="max-md:h-11" onClick={() => patch.mutate({ status: "rejected" })}><X /> Reject</Button>}
                  {onShow && c.status !== "rejected" && <Button size="xs" variant="ghost" className="max-md:h-11" onClick={() => { onShow(c.id); onOpenChange(false); }}><Locate /> Show in graph</Button>}
                  <Button size="xs" variant="ghost" className="ml-auto text-danger-text max-md:h-11" onClick={() => { if (window.confirm(`Delete the concept “${c.name}”? Its page links go with it.`)) del.mutate(); }}><Trash2 /> Delete</Button></div>
                <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); patch.mutate({ name: draft.name.trim(), description: draft.description.trim() || null }); }}>
                  <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} maxLength={120} aria-label="Concept name" className={cn(input, "font-medium")} />
                  <textarea value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} maxLength={2000} rows={2} aria-label="Description" placeholder="Description (optional)" className={cn(input, "h-auto min-h-[4rem] py-2 sm:h-auto")} />
                  {(draft.name.trim() !== c.name || (draft.description.trim() || null) !== (c.description ?? null)) && <div><Button type="submit" size="sm" className="max-md:h-11" disabled={!draft.name.trim() || patch.isPending}>Save</Button></div>}
                </form>
                <div className="mb-1 mt-3 flex items-center gap-2 text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">Pages<Button size="xs" variant="ghost" className="ml-auto max-md:h-11" onClick={() => setPicking(true)}><Plus /> Add a page</Button></div>
                <ul className="max-h-[32dvh] space-y-0.5 overflow-y-auto overscroll-contain">{c.pageLinks?.length ? c.pageLinks.map((l) => <li key={l.pageId} className={cn("flex min-h-11 items-center gap-2 rounded-control px-2 text-ui sm:min-h-9", l.status === "suggested" && "ai-surface")}><Link href={`/p/${l.pageId}`} className="min-w-0 flex-1 truncate hover:underline">{l.icon ?? "📄"} {l.title || "Untitled"}</Link>{l.origin === "ai" && <AIBadge />}
                  {l.status === "suggested" ? <><button type="button" aria-label={`Accept ${l.title}`} className="icon-btn max-md:size-11" onClick={() => patch.mutate({ pageLinks: [{ pageId: l.pageId, status: "accepted" }] })}><Check /></button><button type="button" aria-label={`Reject ${l.title}`} className="icon-btn max-md:size-11" onClick={() => patch.mutate({ pageLinks: [{ pageId: l.pageId, status: "rejected" }] })}><X /></button></> : l.status === "rejected" ? <Badge tone="danger">rejected</Badge> : <button type="button" aria-label={`Remove ${l.title}`} className="icon-btn max-md:size-11" onClick={() => patch.mutate({ removePages: [l.pageId] })}><X /></button>}</li>) : <li className="p-2 text-ui text-fg-muted">No page carries this concept yet.</li>}</ul>
              </>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <PagePicker open={picking} onOpenChange={setPicking} title="Add a page to the concept" exclude={c?.pageLinks?.filter((l) => l.status === "accepted").map((l) => l.pageId)} onPick={(n) => patch.mutate({ addPages: [n.id] })} />
    </>
  );
}
