"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Plus, Trash2, ChevronDown, ChevronRight, Database, GitBranch } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Spinner, Empty } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { Field, Select, KVEditor, EXP_TONE } from "./ui";
import { timeAgo, cn } from "@/lib/utils";

const STATUSES = ["planned", "running", "done", "failed"];
export const expKey = (pageId: string) => ["research-experiments", pageId];
export function ExperimentsTab({ pageId }: { pageId: string }) {
  const qc = useQueryClient(); const [name, setName] = useState(""); const [open, setOpen] = useState<Record<string, boolean>>({});
  const { data: exps = [], isLoading } = useQuery<any[]>({ queryKey: expKey(pageId), queryFn: () => api(`/api/research/experiments?pageId=${pageId}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: expKey(pageId) }); qc.invalidateQueries({ queryKey: ["research-overview"] }); };
  async function create() { const n = name.trim(); if (!n) return; const e = await api("/api/research/experiments", { method: "POST", json: { pageId, name: n } }); setName(""); setOpen((o) => ({ ...o, [e.id]: true })); refresh(); }
  async function patch(id: string, json: any) { try { await api(`/api/research/experiments/${id}`, { method: "PATCH", json }); refresh(); } catch (e: any) { toast("Save failed", { description: e.message, tone: "danger" }); } }
  async function del(e: any) { if (!confirm(`Delete experiment “${e.name}”?`)) return; await api(`/api/research/experiments/${e.id}`, { method: "DELETE" }); refresh(); }
  return (
    <div>
      <div className="flex items-center gap-1.5"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New experiment name (e.g. Baseline hedonic, 2015–2024)" className="h-8 text-[13px]" onKeyDown={(e) => { if (e.key === "Enter") create(); }} /><Button size="sm" onClick={create} disabled={!name.trim()}><Plus /> Add</Button></div>
      {isLoading ? <div className="flex justify-center py-8"><Spinner /></div> : !exps.length ? <Empty icon={<FlaskConical />} title="No experiments" hint="Track each estimation or simulation run: parameters, metrics, dataset and code repository." /> : (
        <div className="mt-3 space-y-2">{exps.map((e) => { const isOpen = open[e.id] ?? false; return (
          <div key={e.id} className="rounded-lg border border-line bg-bg-elev">
            <div className="flex items-center gap-2 px-3 py-2">
              <button className="grid size-6 place-items-center rounded text-fg-faint hover:bg-bg-sunk" onClick={() => setOpen((o) => ({ ...o, [e.id]: !isOpen }))} aria-label="Toggle">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button>
              <input defaultValue={e.name} className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none" onBlur={(ev) => { if (ev.target.value.trim() && ev.target.value !== e.name) patch(e.id, { name: ev.target.value.trim() }); }} />
              <Select value={e.status} onChange={(ev) => patch(e.id, { status: ev.target.value })} className="h-7 text-[12px]">{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
              <Badge tone={EXP_TONE[e.status] ?? "neutral"} className="hidden sm:inline-flex">{e.status}</Badge>
              <button className="grid size-8 place-items-center rounded-md text-fg-faint hover:bg-bg-sunk hover:text-danger" onClick={() => del(e)} aria-label="Delete"><Trash2 className="size-4" /></button>
            </div>
            {!isOpen && <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-2 pl-11 text-[11px] text-fg-faint">{Object.entries(e.metrics ?? {}).slice(0, 6).map(([k, v]) => <span key={k}><span className="font-mono">{k}</span>={String(v)}</span>)}{!Object.keys(e.metrics ?? {}).length && <span>{Object.keys(e.params ?? {}).length} params · no metrics yet</span>}<span>· updated {timeAgo(e.updatedAt)}</span></div>}
            {isOpen && <div className={cn("grid gap-3 border-t border-line p-3 sm:grid-cols-2")}>
              <Field label="Parameters"><KVEditor value={e.params ?? {}} onChange={(v) => patch(e.id, { params: v })} placeholderKey="alpha" placeholderValue="0.05" /></Field>
              <Field label="Metrics"><KVEditor value={e.metrics ?? {}} onChange={(v) => patch(e.id, { metrics: v })} placeholderKey="rmse" placeholderValue="0.123" /></Field>
              <Field label={<span className="flex items-center gap-1"><Database className="size-3" /> Dataset</span>}><Input defaultValue={e.datasetRef ?? ""} placeholder="path, DOI or URL" className="h-8 text-[12px]" onBlur={(ev) => { if ((ev.target.value || null) !== (e.datasetRef ?? null)) patch(e.id, { datasetRef: ev.target.value || null }); }} /></Field>
              <Field label={<span className="flex items-center gap-1"><GitBranch className="size-3" /> Repository</span>}><Input defaultValue={e.repoUrl ?? ""} placeholder="https://…" className="h-8 text-[12px]" onBlur={(ev) => { if ((ev.target.value || null) !== (e.repoUrl ?? null)) patch(e.id, { repoUrl: ev.target.value || null }); }} /></Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea defaultValue={e.notes ?? ""} className="min-h-[60px] text-[13px]" onBlur={(ev) => { if ((ev.target.value || null) !== (e.notes ?? null)) patch(e.id, { notes: ev.target.value || null }); }} /></Field>
              <div className="text-[11px] text-fg-faint sm:col-span-2">Created {timeAgo(e.createdAt)}{e.startedAt ? ` · started ${timeAgo(e.startedAt)}` : ""}{e.finishedAt ? ` · finished ${timeAgo(e.finishedAt)}` : ""}</div>
            </div>}
          </div>); })}</div>
      )}
    </div>
  );
}
