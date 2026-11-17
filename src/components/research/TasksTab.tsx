"use client";
/** Tasks of a page: 48 px rows with a full-size checkbox; details (priority, due date) in a sheet; delete with Undo. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckSquare, ChevronRight, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useOnline } from "@/lib/client/hooks";
import { Input } from "@/components/ui/input";
import { Badge, Dialog, Empty, SheetContent, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { ErrorBox, FIELD, Field, ListSkeleton, Select, TButton, dateInput, errText } from "./ui";
import { cn, fmtDate } from "@/lib/utils";

type Task = any;
export const taskKey = (pageId: string) => ["research-tasks", pageId];
const isOverdue = (t: Task) => t.status !== "done" && t.dueAt && new Date(t.dueAt) < new Date();
export function TasksTab({ pageId }: { pageId: string }) {
  const qc = useQueryClient(); const online = useOnline();
  const [title, setTitle] = useState(""); const [due, setDue] = useState(""); const [adding, setAdding] = useState(false); const [openId, setOpenId] = useState<string | null>(null); const [showDone, setShowDone] = useState(false);
  const q = useQuery<Task[]>({ queryKey: taskKey(pageId), queryFn: () => api(`/api/research/tasks?pageId=${pageId}`) });
  const tasks = q.data ?? [];
  const refresh = () => { qc.invalidateQueries({ queryKey: taskKey(pageId) }); qc.invalidateQueries({ queryKey: ["research-overview"] }); };
  async function add() {
    const t = title.trim(); if (!t || adding) return; setAdding(true);
    try { await api("/api/research/tasks", { method: "POST", json: { pageId, title: t, dueAt: due || null } }); setTitle(""); setDue(""); refresh(); }
    catch (e) { toast("Task not added", { description: `${errText(e)} The text is still in the field.`, tone: "danger", action: { label: "Retry", run: add } }); } finally { setAdding(false); }
  }
  async function toggle(t: Task) {
    const status = t.status === "done" ? "todo" : "done";
    qc.setQueryData<Task[]>(taskKey(pageId), (old) => (old ?? []).map((x) => (x.id === t.id ? { ...x, status } : x))); // optimistic, rolled back on failure
    try { await api(`/api/research/tasks/${t.id}`, { method: "PATCH", json: { status } }); refresh(); }
    catch (e) { qc.setQueryData<Task[]>(taskKey(pageId), (old) => (old ?? []).map((x) => (x.id === t.id ? { ...x, status: t.status } : x))); toast("Could not update the task", { description: errText(e), tone: "danger", action: { label: "Retry", run: () => toggle(t) } }); }
  }
  async function del(t: Task) {
    try { await api(`/api/research/tasks/${t.id}`, { method: "DELETE" }); setOpenId(null); refresh(); toast("Task deleted", { action: { label: "Undo", run: async () => { try { await api(`/api/research/tasks/${t.id}?action=restore`, { method: "POST" }); refresh(); } catch (e) { toast("Could not restore the task", { description: errText(e), tone: "danger" }); } } } }); }
    catch (e) { toast("Could not delete the task", { description: errText(e), tone: "danger" }); }
  }
  const open = tasks.filter((t) => t.status !== "done"); const done = tasks.filter((t) => t.status === "done"); const overdue = open.filter(isOverdue).length; const next = open.find((t) => t.dueAt);
  const current = tasks.find((t) => t.id === openId) ?? null;
  const Row = ({ t }: { t: Task }) => (
    <li className={cn("flex min-h-12 items-stretch rounded-md hover:bg-bg-sunk/70", t.status === "done" && "opacity-60")}>
      <label className="grid w-11 shrink-0 cursor-pointer place-items-center"><input type="checkbox" checked={t.status === "done"} onChange={() => toggle(t)} className="size-5 accent-[var(--accent)] md:size-4" aria-label={`${t.status === "done" ? "Reopen" : "Complete"}: ${t.title}`} /></label>
      <button type="button" onClick={() => setOpenId(t.id)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left">
        <span className="min-w-0 flex-1"><span className={cn("block break-words text-[14px] leading-snug", t.status === "done" && "line-through")}>{t.title}</span>{(t.dueAt || t.priority === "high") && <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">{t.dueAt && <span className={cn("inline-flex items-center gap-1", isOverdue(t) && "font-medium text-danger")}><CalendarClock className="size-3.5" aria-hidden />{isOverdue(t) ? "Overdue · " : "Due "}{fmtDate(t.dueAt)}</span>}{t.priority === "high" && <Badge tone="warning">high</Badge>}</span>}</span>
        <ChevronRight className="size-4 shrink-0 text-fg-faint" aria-hidden />
      </button>
    </li>
  );
  return (
    <div className="min-w-0">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task" aria-label="New task" enterKeyHint="done" className={cn(FIELD, "w-full min-w-0 md:w-auto md:flex-1")} />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date (optional)" className="h-11 min-w-0 flex-1 rounded-md border border-line bg-bg-elev px-2 text-[16px] md:h-8 md:flex-none md:text-[12px]" />
        <TButton type="submit" disabled={!title.trim() || adding || !online}>{adding ? <Spinner className="size-3.5 border-t-white" /> : <Plus />} Add</TButton>
      </form>
      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorBox title="Could not load the tasks" message={errText(q.error)} onRetry={() => q.refetch()} /> : !tasks.length ? (
        <Empty icon={<CheckSquare />} title="No tasks yet" hint="Keep the to-do list of this paper here. The AI planner can also propose tasks that you accept into this list." />
      ) : (
        <div className="mt-3">
          {open.length ? <ul className="space-y-0.5">{open.map((t) => <Row key={t.id} t={t} />)}</ul> : <p className="py-3 text-[13px] text-fg-muted">Everything is done.</p>}
          {done.length > 0 && <><button type="button" aria-expanded={showDone} onClick={() => setShowDone(!showDone)} className="mt-2 flex min-h-11 items-center gap-1 text-[13px] text-fg-muted md:min-h-8"><ChevronRight className={cn("size-4 transition-transform", showDone && "rotate-90")} aria-hidden /> {done.length} completed</button>{showDone && <ul className="space-y-0.5">{done.map((t) => <Row key={t.id} t={t} />)}</ul>}</>}
          <div className="mt-2 text-[12px] text-fg-faint">{open.length} open{overdue ? ` · ${overdue} overdue` : ""}{next ? ` · next due ${fmtDate(next.dueAt)}` : ""}</div>
        </div>
      )}
      <Dialog open={current !== null} onOpenChange={(o) => { if (!o) setOpenId(null); }}><SheetContent title="Task">{current && <TaskForm key={current.id} t={current} onSaved={refresh} onClose={() => setOpenId(null)} onDelete={() => del(current)} />}</SheetContent></Dialog>
    </div>
  );
}
function TaskForm({ t, onSaved, onClose, onDelete }: { t: Task; onSaved: () => void; onClose: () => void; onDelete: () => void }) {
  const online = useOnline();
  const [v, setV] = useState({ title: t.title as string, priority: (t.priority ?? "medium") as string, due: dateInput(t.dueAt), status: t.status as string });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function save() {
    if (busy || !v.title.trim()) return; setBusy(true); setError(null);
    try { await api(`/api/research/tasks/${t.id}`, { method: "PATCH", json: { title: v.title.trim(), priority: v.priority, dueAt: v.due || null, status: v.status } }); onSaved(); onClose(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Field label="Task"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} className={FIELD} required /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Status"><Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="todo">to do</option><option value="doing">doing</option><option value="done">done</option></Select></Field>
        <Field label="Priority"><Select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></Select></Field>
      </div>
      <Field label="Due date"><div className="flex gap-2"><input type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} className="h-11 min-w-0 flex-1 rounded-md border border-line bg-bg-elev px-2 text-[16px] md:h-8 md:text-[13px]" />{v.due && <TButton type="button" variant="ghost" onClick={() => setV({ ...v, due: "" })}>Clear</TButton>}</div></Field>
      {error && <ErrorBox className="mt-0" title="Not saved — your changes are still here" message={error} onRetry={save} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <TButton type="button" variant="ghost" className="text-danger hover:text-danger" onClick={onDelete}><Trash2 /> Delete</TButton>
        <div className="flex flex-col-reverse gap-2 sm:flex-row"><TButton type="button" variant="ghost" onClick={onClose}>Close</TButton><TButton type="submit" disabled={busy || !v.title.trim() || !online}>{busy ? <Spinner className="size-3.5 border-t-white" /> : null} Save</TButton></div>
      </div>
    </form>
  );
}
