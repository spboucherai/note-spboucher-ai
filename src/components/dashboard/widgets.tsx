/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/dashboard/widgets.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw, Check, ArrowRight, FlaskConical, BookMarked, Beaker, Share2, Star, Clock, Pencil, FolderKanban, Inbox, ExternalLink } from "lucide-react";
import { api } from "@/lib/client/api";
import { useUI } from "@/lib/client/store";
import { cn, timeAgo, fmtDate, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { Markdown } from "@/components/markdown";
import { Chat } from "@/components/chat/Chat";
import { PageGraphCard } from "@/components/graph/PageGraphCard";
import type { WidgetType } from "./types";

export interface PageLite { id: string; title: string; icon: string | null; section: string; type: string; updatedAt: string; lastOpenedAt?: string | null; wordCount?: number; pinned?: boolean; properties?: Record<string, unknown> }
export interface DashboardData {
  layout: { widgets: { id: string; type: WidgetType; size: "half" | "wide" | "third"; config?: Record<string, unknown> }[]; custom: boolean };
  user: { displayName: string; username: string; preferences: Record<string, unknown> };
  recent: PageLite[]; pinned: PageLite[]; modified: PageLite[]; projects: PageLite[];
  tasks: { id: string; title: string; status: string; priority: string | null; dueAt: string | null; project: string | null; pageId: string | null; pageTitle: string | null }[];
  research: { pages: PageLite[]; experiments: { id: string; name: string; status: string; pageId: string | null; updatedAt: string }[]; counts: { references: number; experiments: number; researchPages: number } };
  graph: { top: { id: string; title: string; icon: string | null; section: string; degree: number }[]; suggested: number; edges: number };
  usage: { today: { calls: number; costUsd: number; errors: number }; budgetUsd: number };
  summary: { text: string; model: string; provider: string; costUsd: number | null; latencyMs: number; at: string; pages: number; tasks: number } | null;
  stats: { editedThisWeek: number };
}
export interface WidgetProps { data: DashboardData; refresh: () => void; config?: Record<string, unknown> }

const pageIcon = (p: { icon: string | null; type: string }) => p.icon ?? (p.type === "database" ? "🗂" : p.type === "research" ? "🔬" : "📄");
export function PageRow({ p, meta }: { p: PageLite; meta?: React.ReactNode }) {
  return (
    <Link href={`/p/${p.id}`} className="flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-bg-sunk">
      <span className="w-5 shrink-0 text-center">{pageIcon(p)}</span>
      <span className="min-w-0 flex-1 truncate">{p.title || "Untitled"}</span>
      <span className="shrink-0 text-[11px] text-fg-faint">{meta ?? timeAgo(p.updatedAt)}</span>
    </Link>
  );
}
export function EmptyLine({ children }: { children: React.ReactNode }) { return <div className="px-2 py-6 text-center text-[12px] text-fg-faint">{children}</div>; }
const More = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} className="mt-auto flex items-center gap-1 px-2 pt-2 text-[12px] text-fg-muted hover:text-accent">{children}<ArrowRight className="size-3" /></Link>;

// ---------- quick capture
export function QuickCapture({ data, refresh }: WidgetProps) {
  const [title, setTitle] = useState(""); const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  const qc = useQueryClient(); const openAI = useUI((s) => s.openAI);
  const section = (data.user.preferences?.defaultSection as string) || "notes";
  async function save() {
    if (!title.trim() && !text.trim()) return; setBusy(true);
    try {
      const { markdownToDoc } = await import("@/lib/editor/markdown-client");
      const p = await api("/api/pages", { method: "POST", json: { title: title.trim() || text.trim().split("\n")[0].slice(0, 80), section: ["notes", "documents", "projects", "research"].includes(section) ? section : "notes", content: { type: "doc", content: text.trim() ? markdownToDoc(text) : [{ type: "paragraph" }] } } });
      qc.invalidateQueries({ queryKey: ["tree"] }); setTitle(""); setText(""); refresh();
      toast("Note created", { description: p.title, tone: "success" });
    } catch (e: any) { toast("Could not save", { description: e.message, tone: "danger" }); } finally { setBusy(false); }
  }
  const ask = () => openAI({ prefill: [title.trim(), text.trim()].filter(Boolean).join("\n\n") || null });
  return (
    <div className="flex flex-1 flex-col gap-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }} />
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Capture a thought, a reference, a to-do… (Markdown ok, ⌘⏎ to save)" className="min-h-[96px] flex-1 resize-none" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || (!title.trim() && !text.trim())}>{busy ? <Spinner className="size-3.5" /> : <Pencil />} Save to {section === "notes" ? "My Notes" : section}</Button>
        <Button size="sm" variant="ghost" className="text-ai hover:text-ai" onClick={ask}><Sparkles /> Ask AI instead</Button>
      </div>
    </div>
  );
}
// ---------- page lists
export function RecentPages({ data }: WidgetProps) { return <div className="flex flex-1 flex-col">{data.recent.length ? data.recent.map((p) => <PageRow key={p.id} p={p} meta={timeAgo(p.lastOpenedAt && new Date(p.lastOpenedAt) > new Date(p.updatedAt) ? p.lastOpenedAt : p.updatedAt)} />) : <EmptyLine>No pages yet — create one from the sidebar.</EmptyLine>}</div>; }
export function Pinned({ data }: WidgetProps) { return <div className="flex flex-1 flex-col">{data.pinned.length ? data.pinned.map((p) => <PageRow key={p.id} p={p} meta={<Star className="size-3.5 text-warning" />} />) : <EmptyLine>Pin pages from the sidebar menu to see them here.</EmptyLine>}</div>; }
export function RecentlyModified({ data }: WidgetProps) { return <div className="flex flex-1 flex-col">{data.modified.length ? data.modified.map((p) => <PageRow key={p.id} p={p} meta={<span className="flex items-center gap-1"><Clock className="size-3" />{timeAgo(p.updatedAt)}</span>} />) : <EmptyLine>Nothing edited yet.</EmptyLine>}<div className="px-2 pt-2 text-[11px] text-fg-faint">{data.stats.editedThisWeek} page{data.stats.editedThisWeek === 1 ? "" : "s"} edited this week</div></div>; }

// ---------- tasks due
const PRIORITY_TONE: Record<string, "danger" | "warning" | "neutral"> = { high: "danger", medium: "neutral", low: "neutral" };
export function TasksDue({ data, refresh }: WidgetProps) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const now = new Date(); const today = new Date(now); today.setHours(0, 0, 0, 0);
  async function complete(id: string) { setDone((s) => new Set(s).add(id)); try { await api("/api/tasks", { method: "PATCH", json: { id, status: "done" } }); setTimeout(refresh, 400); } catch (e: any) { toast("Could not complete task", { description: e.message, tone: "danger" }); setDone((s) => { const n = new Set(s); n.delete(id); return n; }); } }
  const rows = data.tasks.filter((t) => !done.has(t.id));
  return (
    <div className="flex flex-1 flex-col">
      {rows.length ? rows.slice(0, 10).map((t) => { const due = t.dueAt ? new Date(t.dueAt) : null; const overdue = due && due < today; const isToday = due && due >= today && due < new Date(today.getTime() + 864e5); return (
        <div key={t.id} className="flex min-h-10 items-center gap-2 rounded-md px-2 py-1 hover:bg-bg-sunk">
          <button onClick={() => complete(t.id)} className="grid size-5 shrink-0 place-items-center rounded border border-line-strong hover:border-accent hover:bg-accent-soft" aria-label="Complete task"><Check className="size-3 opacity-0 hover:opacity-100" /></button>
          <div className="min-w-0 flex-1"><div className="truncate text-[13px]">{t.title}</div>{(t.project || t.pageTitle) && <div className="truncate text-[11px] text-fg-faint">{t.project && <span>#{t.project}</span>}{t.project && t.pageTitle && " · "}{t.pageId && <Link href={`/p/${t.pageId}`} className="hover:text-accent">{t.pageTitle}</Link>}</div>}</div>
          {t.priority === "high" && <Badge tone="danger">high</Badge>}
          {due && <span className={cn("shrink-0 text-[11px]", overdue ? "font-medium text-danger-text" : isToday ? "text-accent" : "text-fg-faint")}>{overdue ? "overdue · " : ""}{fmtDate(due, { month: "short", day: "numeric" })}</span>}
        </div>); }) : <EmptyLine>Nothing due in the next 7 days.</EmptyLine>}
      <More href="/tasks"><Inbox className="size-3.5" /> Open tasks</More>
    </div>
  );
}
// ---------- active projects
export function ActiveProjects({ data }: WidgetProps) {
  return <div className="flex flex-1 flex-col">{data.projects.length ? data.projects.map((p) => { const st = (p.properties?.status as string) || null; return <PageRow key={p.id} p={p} meta={<span className="flex items-center gap-1.5">{st && <Badge tone="accent">{st}</Badge>}<span>{timeAgo(p.updatedAt)}</span></span>} />; }) : <EmptyLine>No active project. Pages in <b>Projects</b> and research pages with a status show up here.</EmptyLine>}<More href="/"><FolderKanban className="size-3.5" /> Projects section in the sidebar</More></div>;
}
// ---------- research activity
export function ResearchActivity({ data }: WidgetProps) {
  const c = data.research.counts;
  const Stat = ({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) => <div className="flex min-w-0 flex-1 basis-[30%] items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-2"><span className="shrink-0 text-fg-faint [&_svg]:size-4">{icon}</span><div className="min-w-0"><div className="text-base font-semibold leading-5 tabular-nums">{n}</div><div className="truncate text-[11px] text-fg-muted">{label}</div></div></div>;
  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex gap-2"><Stat icon={<FlaskConical />} n={c.researchPages} label="research pages" /><Stat icon={<Beaker />} n={c.experiments} label="experiments" /><Stat icon={<BookMarked />} n={c.references} label="references" /></div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
        <div><div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">Recent research</div>{data.research.pages.length ? data.research.pages.map((p) => <PageRow key={p.id} p={p} />) : <EmptyLine>No research page yet.</EmptyLine>}</div>
        <div><div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">Experiments</div>{data.research.experiments.length ? data.research.experiments.map((e) => <Link key={e.id} href={e.pageId ? `/p/${e.pageId}` : "#"} className="flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-bg-sunk"><span className="min-w-0 flex-1 truncate">{e.name}</span><Badge tone={e.status === "running" ? "accent" : e.status === "done" || e.status === "completed" ? "success" : "neutral"}>{e.status}</Badge></Link>) : <EmptyLine>No experiment logged.</EmptyLine>}</div>
      </div>
    </div>
  );
}
// ---------- AI summary
export function AISummary({ data, refresh }: WidgetProps) {
  const [busy, setBusy] = useState(false); const s = data.summary;
  async function run() { setBusy(true); try { await api("/api/dashboard/summary", { method: "POST" }); refresh(); toast("Weekly summary ready", { tone: "ai" }); } catch (e: any) { toast("Summary failed", { description: e.message, tone: "danger" }); } finally { setBusy(false); } }
  return (
    <div className="flex flex-1 flex-col">
      {s ? <>
        <Markdown text={s.text} className="text-[13.5px] leading-6 [&_p]:my-1.5" />
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-3 text-[11px] text-fg-faint"><Sparkles className="size-3 text-ai" /><span>{s.model}</span><span>· {money(s.costUsd)}</span><span>· {s.pages} pages, {s.tasks} tasks</span><span>· {timeAgo(s.at)}</span><button onClick={run} disabled={busy} className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-bg-sunk hover:text-fg">{busy ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />} Refresh</button></div>
      </> : <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center"><Sparkles className="size-6 text-ai" /><p className="text-[13px] text-fg-muted">Get a digest of what you worked on in the last 7 days and what deserves attention next.</p><Button variant="ai" size="sm" onClick={run} disabled={busy}>{busy ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <Sparkles />} Summarize my week</Button></div>}
    </div>
  );
}
// ---------- graph highlights
export function GraphHighlights({ data }: WidgetProps) {
  const hub = data.graph.top[0];
  return (
    <div className="flex flex-1 flex-col">
      {hub && <div className="mb-2"><PageGraphCard pageId={hub.id} title={null} height={150} /><div className="px-2 pt-1 text-[11px] text-fg-faint">Neighbourhood of <Link href={`/p/${hub.id}`} className="text-fg-muted hover:text-accent">{hub.title || "Untitled"}</Link>, your most connected page</div></div>}
      {data.graph.top.length ? data.graph.top.slice(0, 5).map((p) => <PageRow key={p.id} p={{ ...p, type: "page", updatedAt: "" }} meta={<span className="tabular-nums">{p.degree} link{p.degree === 1 ? "" : "s"}</span>} />) : <EmptyLine>No accepted links yet. Mention pages with @ to build the graph.</EmptyLine>}
      <div className="mt-auto flex items-center justify-between px-2 pt-2 text-[12px]"><span className="text-fg-muted">{data.graph.edges} edges · <span className={cn(data.graph.suggested > 0 && "font-medium text-ai")}>{data.graph.suggested} AI suggestion{data.graph.suggested === 1 ? "" : "s"} pending</span></span><Link href="/graph" className="flex items-center gap-1 text-fg-muted hover:text-accent"><Share2 className="size-3.5" /> Graph</Link></div>
    </div>
  );
}
// ---------- AI chat
export function AIChat() { return <div className="-m-4 mt-0 h-[440px] min-h-0 border-t border-line"><Chat compact /></div>; }
// ---------- usage
export function Usage({ data }: WidgetProps) {
  const u = data.usage; const pct = u.budgetUsd > 0 ? Math.min(100, (u.today.costUsd / u.budgetUsd) * 100) : 0;
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-end gap-4"><div><div className="text-2xl font-semibold tabular-nums tracking-tight">{money(u.today.costUsd)}</div><div className="text-[11px] text-fg-muted">spent today</div></div><div><div className="text-2xl font-semibold tabular-nums tracking-tight">{u.today.calls}</div><div className="text-[11px] text-fg-muted">call{u.today.calls === 1 ? "" : "s"}{u.today.errors ? <span className="text-danger-text"> · {u.today.errors} failed</span> : null}</div></div></div>
      <div><div className="mb-1 flex justify-between text-[11px] text-fg-muted"><span>Daily budget</span><span className="tabular-nums">{pct.toFixed(0)}% of ${u.budgetUsd.toFixed(2)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-bg-sunk"><div className={cn("h-full rounded-full transition-[width]", pct >= 90 ? "bg-danger" : pct >= 60 ? "bg-warning" : "bg-accent")} style={{ width: `${pct}%` }} /></div></div>
      <More href="/ai/models"><ExternalLink className="size-3.5" /> Models, routes and usage</More>
    </div>
  );
}
export const WIDGET_COMPONENTS: Record<WidgetType, (p: WidgetProps) => React.ReactNode> = { quick_capture: QuickCapture, recent_pages: RecentPages, pinned: Pinned, tasks_due: TasksDue, active_projects: ActiveProjects, research_activity: ResearchActivity, recently_modified: RecentlyModified, ai_summary: AISummary, graph_highlights: GraphHighlights, ai_chat: AIChat, usage: Usage };
