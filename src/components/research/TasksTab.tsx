"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner, Empty } from "@/components/ui/primitives";
import { Select, dateInput } from "./ui";
import { cn, fmtDate } from "@/lib/utils";

export const taskKey = (pageId: string) => ["research-tasks", pageId];
export function TasksTab({ pageId }: { pageId: string }) {
  const qc = useQueryClient(); const [title, setTitle] = useState(""); const [due, setDue] = useState("");
  const { data: tasks = [], isLoading } = useQuery<any[]>({ queryKey: taskKey(pageId), queryFn: () => api(`/api/research/tasks?pageId=${pageId}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: taskKey(pageId) }); qc.invalidateQueries({ queryKey: ["research-overview"] }); };
  async function add() { const t = title.trim(); if (!t) return; await api("/api/research/tasks", { method: "POST", json: { pageId, title: t, dueAt: due || null } }); setTitle(""); setDue(""); refresh(); }
  async function patch(id: string, json: any) { await api(`/api/research/tasks/${id}`, { method: "PATCH", json }); refresh(); }
  async function del(id: string) { await api(`/api/research/tasks/${id}`, { method: "DELETE" }); refresh(); }
  const open = tasks.filter((t) => t.status !== "done"); const done = tasks.filter((t) => t.status === "done");
  const Row = ({ t }: { t: any }) => { const overdue = t.status !== "done" && t.dueAt && new Date(t.dueAt) < new Date(); return (
    <div className={cn("flex min-h-10 items-center gap-2 rounded-md px-1 hover:bg-bg-sunk/70", t.status === "done" && "opacity-60")}>
      <input type="checkbox" checked={t.status === "done"} onChange={(e) => patch(t.id, { status: e.target.checked ? "done" : "todo" })} className="size-4 accent-[var(--accent)]" aria-label="Done" />
      <input defaultValue={t.title} className={cn("min-w-0 flex-1 bg-transparent text-[13px] outline-none", t.status === "done" && "line-through")} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== t.title) patch(t.id, { title: e.target.value.trim() }); }} />
      <Select value={t.priority ?? "medium"} onChange={(e) => patch(t.id, { priority: e.target.value })} className="hidden h-7 text-[11px] sm:block"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></Select>
      <input type="date" defaultValue={dateInput(t.dueAt)} onChange={(e) => patch(t.id, { dueAt: e.target.value || null })} className={cn("h-7 w-[8.5rem] rounded-md border border-line bg-bg-elev px-1.5 text-[11px]", overdue && "border-danger/50 text-danger")} aria-label="Due date" />
      <button className="grid size-8 place-items-center rounded-md text-fg-faint hover:bg-bg-sunk hover:text-danger" onClick={() => del(t.id)} aria-label="Delete"><Trash2 className="size-3.5" /></button>
    </div>); };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task (Enter to add)" className="h-8 min-w-[12rem] flex-1 text-[13px]" onKeyDown={(e) => { if (e.key === "Enter") add(); }} /><input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 rounded-md border border-line bg-bg-elev px-2 text-[12px]" aria-label="Due" /><Button size="sm" onClick={add} disabled={!title.trim()}><Plus /> Add</Button></div>
      {isLoading ? <div className="flex justify-center py-8"><Spinner /></div> : !tasks.length ? <Empty icon={<CheckSquare />} title="No tasks" hint="Keep the to-do list of this paper here; the AI planner can propose tasks you accept into this list." /> : (
        <div className="mt-3">
          <div className="space-y-0.5">{open.map((t) => <Row key={t.id} t={t} />)}</div>
          {done.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-[12px] text-fg-faint">{done.length} completed</summary><div className="mt-1 space-y-0.5">{done.map((t) => <Row key={t.id} t={t} />)}</div></details>}
          <div className="mt-2 text-[11px] text-fg-faint">{open.length} open · {open.filter((t) => t.dueAt && new Date(t.dueAt) < new Date()).length} overdue{open[0]?.dueAt ? ` · next due ${fmtDate(open.find((t) => t.dueAt)?.dueAt)}` : ""}</div>
        </div>
      )}
    </div>
  );
}
