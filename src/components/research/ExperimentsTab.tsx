"use client";
/** Experiments of a page: cards; each one opens a form sheet (draft kept until saved). */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Database, FlaskConical, GitBranch, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useOnline } from "@/lib/client/hooks";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Dialog, Empty, SheetContent, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { AREA, ErrorBox, EXP_TONE, FIELD, Field, KVEditor, ListSkeleton, Select, TButton, errText } from "./ui";
import { timeAgo, cn } from "@/lib/utils";

const STATUSES = ["planned", "running", "done", "failed"];
type Exp = any;
export const expKey = (pageId: string) => ["research-experiments", pageId];
export function ExperimentsTab({ pageId }: { pageId: string }) {
  const qc = useQueryClient(); const online = useOnline();
  const [name, setName] = useState(""); const [creating, setCreating] = useState(false); const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery<Exp[]>({ queryKey: expKey(pageId), queryFn: () => api(`/api/research/experiments?pageId=${pageId}`) });
  const exps = q.data ?? [];
  const refresh = () => { qc.invalidateQueries({ queryKey: expKey(pageId) }); qc.invalidateQueries({ queryKey: ["research-overview"] }); };
  async function create() {
    const n = name.trim(); if (!n || creating) return; setCreating(true);
    try { const e = await api("/api/research/experiments", { method: "POST", json: { pageId, name: n } }); setName(""); refresh(); setOpenId(e.id); }
    catch (e) { toast("Could not create the experiment", { description: `${errText(e)} The name is still in the field.`, tone: "danger", action: { label: "Retry", run: create } }); } finally { setCreating(false); }
  }
  const current = exps.find((e) => e.id === openId) ?? null;
  return (
    <div className="min-w-0">
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New experiment (e.g. Baseline hedonic 2015–2024)" aria-label="New experiment name" enterKeyHint="done" className={cn(FIELD, "min-w-0 flex-1")} />
        <TButton type="submit" disabled={!name.trim() || creating || !online}>{creating ? <Spinner className="size-3.5 border-t-white" /> : <Plus />} Add</TButton>
      </form>
      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorBox title="Could not load the experiments" message={errText(q.error)} onRetry={() => q.refetch()} /> : !exps.length ? (
        <Empty icon={<FlaskConical />} title="No experiments yet" hint="Track each estimation or simulation run: parameters, metrics, dataset and code repository. Type a name above to start." />
      ) : (
        <ul className="mt-3 space-y-2">{exps.map((e) => { const metrics = Object.entries(e.metrics ?? {}); return (
          <li key={e.id}><button type="button" onClick={() => setOpenId(e.id)} className="flex min-h-16 w-full items-center gap-2 rounded-lg border border-line bg-bg-elev p-3 text-left hover:bg-bg-sunk">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="min-w-0 break-words text-[14px] font-medium leading-snug">{e.name}</span><Badge tone={EXP_TONE[e.status] ?? "neutral"}>{e.status}</Badge></span>
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-fg-muted">{metrics.slice(0, 4).map(([k, v]) => <span key={k} className="max-w-full truncate"><span className="font-mono">{k}</span> = {String(v)}</span>)}{metrics.length > 4 && <span>+{metrics.length - 4} more</span>}{!metrics.length && <span>{Object.keys(e.params ?? {}).length} parameter(s) · no metrics yet</span>}<span>· updated {timeAgo(e.updatedAt)}</span></span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-fg-faint" aria-hidden />
          </button></li>); })}</ul>
      )}
      <Dialog open={current !== null} onOpenChange={(o) => { if (!o) setOpenId(null); }}><SheetContent title="Experiment" className="sm:w-[min(40rem,calc(100vw-2rem))]">{current && <ExpForm key={current.id} e={current} pageId={pageId} onSaved={refresh} onClose={() => setOpenId(null)} />}</SheetContent></Dialog>
    </div>
  );
}

function ExpForm({ e, pageId, onSaved, onClose }: { e: Exp; pageId: string; onSaved: () => void; onClose: () => void }) {
  const online = useOnline();
  const [v, setV] = useState({ name: e.name as string, status: e.status as string, params: (e.params ?? {}) as Record<string, unknown>, metrics: (e.metrics ?? {}) as Record<string, unknown>, datasetRef: (e.datasetRef ?? "") as string, repoUrl: (e.repoUrl ?? "") as string, notes: (e.notes ?? "") as string });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify({ name: e.name, status: e.status, params: e.params ?? {}, metrics: e.metrics ?? {}, datasetRef: e.datasetRef ?? "", repoUrl: e.repoUrl ?? "", notes: e.notes ?? "" });
  async function save() {
    if (busy || !v.name.trim()) return; setBusy(true); setError(null);
    try { await api(`/api/research/experiments/${e.id}`, { method: "PATCH", json: { name: v.name.trim(), status: v.status, params: v.params, metrics: v.metrics, datasetRef: v.datasetRef.trim() || null, repoUrl: v.repoUrl.trim() || null, notes: v.notes.trim() || null } }); onSaved(); toast("Experiment saved", { tone: "success" }); onClose(); }
    catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }
  async function del() {
    try {
      await api(`/api/research/experiments/${e.id}`, { method: "DELETE" }); onSaved(); onClose();
      // an experiment is deleted for good on the server: Undo creates it again from the copy held here
      toast(`Experiment “${e.name}” deleted`, { action: { label: "Undo", run: async () => { try { await api("/api/research/experiments", { method: "POST", json: { pageId, name: e.name, status: e.status, params: e.params ?? {}, metrics: e.metrics ?? {}, datasetRef: e.datasetRef ?? null, repoUrl: e.repoUrl ?? null, notes: e.notes ?? null } }); onSaved(); toast("Experiment restored", { tone: "success" }); } catch (err) { toast("Could not restore the experiment", { description: errText(err), tone: "danger" }); } } } });
    } catch (err) { toast("Could not delete", { description: errText(err), tone: "danger" }); }
  }
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
      <Field label="Name" className="sm:col-span-2"><Input value={v.name} onChange={(ev) => setV({ ...v, name: ev.target.value })} className={FIELD} required /></Field>
      <Field label="Status"><Select value={v.status} onChange={(ev) => setV({ ...v, status: ev.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
      <div className="self-end text-[12px] text-fg-muted">Created {timeAgo(e.createdAt)}{e.startedAt ? ` · started ${timeAgo(e.startedAt)}` : ""}{e.finishedAt ? ` · finished ${timeAgo(e.finishedAt)}` : ""}</div>
      <Field label="Parameters" className="sm:col-span-2"><KVEditor value={v.params} onChange={(p) => setV({ ...v, params: p })} placeholderKey="alpha" placeholderValue="0.05" /></Field>
      <Field label="Metrics" className="sm:col-span-2"><KVEditor value={v.metrics} onChange={(m) => setV({ ...v, metrics: m })} placeholderKey="rmse" placeholderValue="0.123" /></Field>
      <Field label={<span className="flex items-center gap-1"><Database className="size-3" /> Dataset</span>}><Input value={v.datasetRef} onChange={(ev) => setV({ ...v, datasetRef: ev.target.value })} placeholder="path, DOI or URL" autoCapitalize="none" className={FIELD} /></Field>
      <Field label={<span className="flex items-center gap-1"><GitBranch className="size-3" /> Repository</span>} hint={/^https?:\/\//.test(v.repoUrl) ? <a href={v.repoUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">Open the repository</a> : undefined}><Input value={v.repoUrl} onChange={(ev) => setV({ ...v, repoUrl: ev.target.value })} placeholder="https://…" inputMode="url" autoCapitalize="none" className={FIELD} /></Field>
      <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes} onChange={(ev) => setV({ ...v, notes: ev.target.value })} className={cn(AREA, "min-h-[88px]")} /></Field>
      {error && <div className="sm:col-span-2"><ErrorBox className="mt-0" title="Not saved — your changes are still here" message={error} onRetry={save} /></div>}
      {!online && <p className="text-[12px] text-fg-muted sm:col-span-2">You are offline. Keep this sheet open; save when the connection is back.</p>}
      <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <TButton type="button" variant="ghost" className="text-danger hover:text-danger" onClick={del}><Trash2 /> Delete</TButton>
        <div className="flex flex-col-reverse gap-2 sm:flex-row"><TButton type="button" variant="ghost" onClick={onClose}>{dirty ? "Discard changes" : "Close"}</TButton><TButton type="submit" disabled={busy || !dirty || !v.name.trim() || !online}>{busy ? <Spinner className="size-3.5 border-t-white" /> : null} Save</TButton></div>
      </div>
    </form>
  );
}
