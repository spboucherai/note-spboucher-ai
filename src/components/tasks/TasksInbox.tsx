"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2, CalendarDays, Flag, Hash, Link2, X, Inbox as InboxIcon, Filter, ChevronDown, Search } from "lucide-react";
import { endOfDay, startOfDay, addDays, isBefore, format } from "date-fns";
import { api } from "@/lib/client/api";
import { cn, fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Empty, Kbd, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, Popover, PopoverTrigger, PopoverContent, Spinner, Switch } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { parseTaskInput } from "./parse";
import type { TreeNode } from "@/components/shell/types";

export interface Task { id: string; title: string; status: string; priority: "low" | "medium" | "high" | null; dueAt: string | null; completedAt: string | null; project: string | null; pageId: string | null; pageTitle: string | null; pageIcon: string | null; createdAt: string; updatedAt: string }
type GroupId = "overdue" | "today" | "week" | "later" | "nodate" | "done";
const GROUPS: { id: GroupId; label: string }[] = [{ id: "overdue", label: "Overdue" }, { id: "today", label: "Today" }, { id: "week", label: "This week" }, { id: "later", label: "Later" }, { id: "nodate", label: "No date" }, { id: "done", label: "Done" }];
const PRIORITIES = ["high", "medium", "low"] as const;
const prioTone = (p: string | null) => (p === "high" ? "danger" : p === "low" ? "neutral" : "warning") as "danger" | "neutral" | "warning";
const toLocalInput = (iso: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "");
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function groupOf(t: Task, now: Date): GroupId {
  if (t.status === "done") return "done";
  if (!t.dueAt) return "nodate";
  const d = new Date(t.dueAt);
  if (isBefore(d, startOfDay(now))) return "overdue";
  if (!isBefore(endOfDay(now), d)) return "today";
  if (!isBefore(endOfDay(addDays(now, 6)), d)) return "week";
  return "later";
}

function PagePicker({ value, label, onChange, tree }: { value: string | null; label: string | null; onChange: (id: string | null, title: string | null) => void; tree: TreeNode[] }) {
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false);
  const hits = useMemo(() => { const s = q.trim().toLowerCase(); return (s ? tree.filter((n) => n.title.toLowerCase().includes(s)) : tree).slice(0, 30); }, [q, tree]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className="flex h-9 max-w-full items-center gap-1.5 rounded-md border border-line bg-bg-elev px-2.5 text-[13px] hover:bg-bg-sunk"><Link2 className="size-3.5 text-fg-faint" /><span className={cn("truncate", !value && "text-fg-faint")}>{label ?? "Link a page"}</span>{value && <X className="size-3.5 shrink-0 text-fg-faint hover:text-danger" onClick={(e) => { e.stopPropagation(); onChange(null, null); }} />}</button></PopoverTrigger>
      <PopoverContent className="w-80 p-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-line px-2"><Search className="size-3.5 text-fg-faint" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages…" className="h-8 flex-1 bg-transparent text-[13px] outline-none" /></div>
        <div className="mt-1 max-h-64 overflow-y-auto">{hits.length ? hits.map((n) => <button key={n.id} type="button" onClick={() => { onChange(n.id, n.title || "Untitled"); setOpen(false); }} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-bg-sunk", n.id === value && "bg-bg-sunk")}><span className="w-4 text-center">{n.icon ?? "📄"}</span><span className="min-w-0 flex-1 truncate">{n.title || "Untitled"}</span><span className="text-[10px] text-fg-faint">{n.section}</span></button>) : <div className="px-2 py-3 text-center text-[12px] text-fg-faint">No match</div>}</div>
      </PopoverContent>
    </Popover>
  );
}

function TaskRow({ t, tree, projects, onPatch, onDelete, editing, setEditing }: { t: Task; tree: TreeNode[]; projects: string[]; onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>; onDelete: (id: string) => void; editing: boolean; setEditing: (v: boolean) => void }) {
  const [draft, setDraft] = useState({ title: t.title, dueAt: toLocalInput(t.dueAt), priority: (t.priority ?? "medium") as "low" | "medium" | "high", project: t.project ?? "", pageId: t.pageId, pageTitle: t.pageTitle });
  const [busy, setBusy] = useState(false); const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setDraft({ title: t.title, dueAt: toLocalInput(t.dueAt), priority: (t.priority ?? "medium") as any, project: t.project ?? "", pageId: t.pageId, pageTitle: t.pageTitle }); setTimeout(() => titleRef.current?.focus(), 0); } /* eslint-disable-next-line */ }, [editing]);
  async function save() { if (!draft.title.trim()) return; setBusy(true); try { await onPatch(t.id, { title: draft.title.trim(), dueAt: fromLocalInput(draft.dueAt), priority: draft.priority, project: draft.project.trim() || null, pageId: draft.pageId }); setEditing(false); } finally { setBusy(false); } }
  const due = t.dueAt ? new Date(t.dueAt) : null; const overdue = due && t.status !== "done" && isBefore(due, startOfDay(new Date()));
  if (editing) return (
    <div className="rounded-lg border border-accent/40 bg-bg-elev p-3 shadow-card" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(false); } else if (e.key === "Enter" && !(e.target as HTMLElement).closest("[data-no-enter]")) { e.preventDefault(); save(); } }}>
      <Input ref={titleRef} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Task title" className="mb-2" />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-bg-elev px-2 text-[13px]"><CalendarDays className="size-3.5 text-fg-faint" /><input type="datetime-local" value={draft.dueAt} onChange={(e) => setDraft({ ...draft, dueAt: e.target.value })} className="bg-transparent text-[13px] outline-none" />{draft.dueAt && <button type="button" onClick={() => setDraft({ ...draft, dueAt: "" })} className="text-fg-faint hover:text-danger"><X className="size-3.5" /></button>}</label>
        <div className="flex h-9 items-center rounded-md border border-line bg-bg-elev p-0.5">{PRIORITIES.map((p) => <button key={p} type="button" onClick={() => setDraft({ ...draft, priority: p })} className={cn("h-full rounded px-2 text-[12px] capitalize", draft.priority === p ? "bg-bg-sunk font-medium" : "text-fg-muted")}>{p}</button>)}</div>
        <label className="flex h-9 items-center gap-1 rounded-md border border-line bg-bg-elev px-2 text-[13px]"><Hash className="size-3.5 text-fg-faint" /><input list="task-projects" value={draft.project} onChange={(e) => setDraft({ ...draft, project: e.target.value })} placeholder="project" className="w-28 bg-transparent outline-none placeholder:text-fg-faint" /><datalist id="task-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist></label>
        <span data-no-enter><PagePicker value={draft.pageId} label={draft.pageTitle} onChange={(id, title) => setDraft({ ...draft, pageId: id, pageTitle: title })} tree={tree} /></span>
        <div className="ml-auto flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel <Kbd>Esc</Kbd></Button><Button size="sm" onClick={save} disabled={busy || !draft.title.trim()}>{busy ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <Check />} Save <Kbd>⏎</Kbd></Button></div>
      </div>
    </div>
  );
  return (
    <div className={cn("group flex min-h-11 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-bg-sunk", t.status === "done" && "opacity-60")}>
      <button onClick={() => onPatch(t.id, { status: t.status === "done" ? "todo" : "done" })} className={cn("grid size-5 shrink-0 place-items-center rounded border transition-colors", t.status === "done" ? "border-accent bg-accent text-accent-fg" : "border-line-strong hover:border-accent hover:bg-accent-soft")} aria-label={t.status === "done" ? "Mark as not done" : "Complete"}><Check className={cn("size-3", t.status !== "done" && "opacity-0 group-hover:opacity-40")} /></button>
      <button onClick={() => setEditing(true)} className="min-w-0 flex-1 text-left">
        <div className={cn("truncate text-[13.5px]", t.status === "done" && "line-through")}>{t.title}</div>
        {(t.project || t.pageId) && <div className="flex items-center gap-2 truncate text-[11px] text-fg-faint">{t.project && <span className="flex items-center gap-0.5"><Hash className="size-3" />{t.project}</span>}{t.pageId && <Link href={`/p/${t.pageId}`} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-0.5 hover:text-accent"><Link2 className="size-3 shrink-0" /><span className="truncate">{t.pageIcon ?? ""} {t.pageTitle ?? "page"}</span></Link>}</div>}
      </button>
      {t.priority && t.priority !== "medium" && <Badge tone={prioTone(t.priority)}>{t.priority}</Badge>}
      {due && <span className={cn("hidden shrink-0 text-[11px] tabular-nums sm:inline", overdue ? "font-medium text-danger" : "text-fg-faint")}>{fmtDate(due, { month: "short", day: "numeric", hour: due.getHours() !== 17 || due.getMinutes() !== 0 ? "numeric" : undefined, minute: due.getHours() !== 17 || due.getMinutes() !== 0 ? "2-digit" : undefined })}</span>}
      <button onClick={() => onDelete(t.id)} className="grid size-8 shrink-0 place-items-center rounded-md text-fg-faint opacity-0 hover:bg-danger/10 hover:text-danger focus:opacity-100 group-hover:opacity-100 md:size-7" aria-label="Delete task"><Trash2 className="size-3.5" /></button>
    </div>
  );
}

export function TasksInbox() {
  const qc = useQueryClient();
  const [showDone, setShowDone] = useState(false); const [project, setProject] = useState<string | null>(null); const [prio, setPrio] = useState<string | null>(null);
  const { data: tasks = [], isLoading } = useQuery({ queryKey: ["tasks", showDone], queryFn: () => api<Task[]>(`/api/tasks${showDone ? "?done=1" : ""}`), staleTime: 5_000 });
  const { data: tree = [] } = useQuery({ queryKey: ["tree"], queryFn: () => api<TreeNode[]>("/api/tree"), staleTime: 10_000 });
  const [input, setInput] = useState(""); const [adding, setAdding] = useState(false); const [editingId, setEditingId] = useState<string | null>(null); const inputRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (input.trim() ? parseTaskInput(input) : null), [input]);
  const projects = useMemo(() => Array.from(new Set(tasks.map((t) => t.project).filter((x): x is string => Boolean(x)))).sort(), [tasks]);
  const now = new Date();
  const filtered = tasks.filter((t) => (!project || t.project === project) && (!prio || t.priority === prio));
  const grouped = useMemo(() => { const m: Record<GroupId, Task[]> = { overdue: [], today: [], week: [], later: [], nodate: [], done: [] }; for (const t of filtered) m[groupOf(t, now)].push(t); return m; /* eslint-disable-next-line */ }, [filtered]);
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const el = e.target as HTMLElement; const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable; if (!typing && e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); inputRef.current?.focus(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  async function add() {
    const p = preview; if (!p || !p.title) return; setAdding(true);
    try { await api("/api/tasks", { method: "POST", json: { title: p.title, dueAt: p.dueAt?.toISOString() ?? null, priority: p.priority ?? "medium", project: p.project ?? (project || null) } }); setInput(""); invalidate(); }
    catch (e: any) { toast("Could not add task", { description: e.message, tone: "danger" }); } finally { setAdding(false); }
  }
  async function patch(id: string, body: Record<string, unknown>) {
    qc.setQueryData<Task[]>(["tasks", showDone], (old) => old?.map((t) => (t.id === id ? { ...t, ...body, completedAt: body.status === "done" ? new Date().toISOString() : body.status === "todo" ? null : t.completedAt } as Task : t)));
    try { await api("/api/tasks", { method: "PATCH", json: { id, ...body } }); } catch (e: any) { toast("Update failed", { description: e.message, tone: "danger" }); } finally { invalidate(); }
  }
  async function remove(id: string) { qc.setQueryData<Task[]>(["tasks", showDone], (old) => old?.filter((t) => t.id !== id)); try { await api(`/api/tasks?id=${id}`, { method: "DELETE" }); toast("Task deleted"); } catch (e: any) { toast("Delete failed", { description: e.message, tone: "danger" }); } finally { invalidate(); } }
  const open = tasks.filter((t) => t.status !== "done").length;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold tracking-tight">Tasks</h1><p className="mt-0.5 text-[13px] text-fg-muted">{open} open{grouped.overdue.length ? <span className="text-danger"> · {grouped.overdue.length} overdue</span> : null}</p></div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Menu><MenuTrigger asChild><Button size="sm" variant={project ? "secondary" : "ghost"}><Hash /> {project ?? "Project"} <ChevronDown className="size-3" /></Button></MenuTrigger><MenuContent><MenuItem onSelect={() => setProject(null)}>All projects {!project && "✓"}</MenuItem><MenuSeparator />{projects.length ? projects.map((p) => <MenuItem key={p} onSelect={() => setProject(p)}>{p} {project === p && "✓"}</MenuItem>) : <div className="px-2 py-1.5 text-xs text-fg-muted">No project yet — add #name when creating a task</div>}</MenuContent></Menu>
          <Menu><MenuTrigger asChild><Button size="sm" variant={prio ? "secondary" : "ghost"}><Flag /> {prio ?? "Priority"} <ChevronDown className="size-3" /></Button></MenuTrigger><MenuContent><MenuItem onSelect={() => setPrio(null)}>Any priority {!prio && "✓"}</MenuItem><MenuSeparator />{PRIORITIES.map((p) => <MenuItem key={p} onSelect={() => setPrio(p)} className="capitalize">{p} {prio === p && "✓"}</MenuItem>)}</MenuContent></Menu>
          <label className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-fg-muted"><Switch checked={showDone} onCheckedChange={setShowDone} /> Show done</label>
        </div>
      </div>
      <div className="mb-6 rounded-xl border border-line bg-bg-elev p-2 shadow-card focus-within:border-accent/50">
        <div className="flex items-center gap-2"><Plus className="ml-1 size-4 shrink-0 text-fg-faint" /><input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } else if (e.key === "Escape") { setInput(""); (e.target as HTMLInputElement).blur(); } }} placeholder='Add a task… e.g. "Send abstract to JIMF nov 15 !high #thesis"' className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-faint" /><Button size="sm" onClick={add} disabled={!preview || adding}>{adding ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : "Add"}</Button></div>
        <div className="flex min-h-6 flex-wrap items-center gap-1.5 px-1 pt-1 text-[11px] text-fg-faint">
          {preview ? <><span className="truncate text-fg-muted">{preview.title}</span>{preview.dueAt && <Badge tone="accent"><CalendarDays className="mr-1 size-3" />{fmtDate(preview.dueAt, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Badge>}{preview.priority && <Badge tone={prioTone(preview.priority)}>{preview.priority}</Badge>}{(preview.project ?? project) && <Badge>#{preview.project ?? project}</Badge>}</> : <span>Understands <i>tomorrow</i>, <i>next monday</i>, <i>in 3 days</i>, <i>nov 15</i>, <i>at 9am</i>, <i>!high</i>, <i>#project</i>. Press <Kbd>n</Kbd> to focus.</span>}
        </div>
      </div>
      {isLoading ? <div className="flex justify-center py-16"><Spinner /></div> : !filtered.length ? <Empty icon={<InboxIcon />} title={tasks.length ? "No task matches the filters" : "Inbox zero"} hint={tasks.length ? "Clear the project or priority filter." : "Add your first task above. Tasks with a due date also show on the home dashboard."} action={tasks.length ? <Button size="sm" variant="outline" onClick={() => { setProject(null); setPrio(null); }}><Filter /> Clear filters</Button> : undefined} /> : (
        <div className="space-y-6">
          {GROUPS.filter((g) => grouped[g.id].length).map((g) => (
            <section key={g.id}>
              <div className={cn("mb-1 flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-wider", g.id === "overdue" ? "text-danger" : g.id === "today" ? "text-accent" : "text-fg-faint")}>{g.label}<span className="font-normal tabular-nums">{grouped[g.id].length}</span></div>
              <div className="space-y-0.5">{grouped[g.id].map((t) => <TaskRow key={t.id} t={t} tree={tree} projects={projects} onPatch={patch} onDelete={remove} editing={editingId === t.id} setEditing={(v) => setEditingId(v ? t.id : null)} />)}</div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
