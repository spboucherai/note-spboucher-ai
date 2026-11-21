/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/research/ResearchPanel.tsx
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
/** Research workspace panel rendered above the editor of a research page (status, venue, deadline, repo, datasets + tabs). */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FlaskConical, GitBranch, Database, CalendarClock, BookMarked, FileText, CheckSquare, Sparkles, X, Plus, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { Tabs, TabsList, TabsTrigger, TabsContent, Badge } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { FIELD, Select, PAPER_STATUSES, STATUS_TONE } from "./ui";
import { ReferencesTab, refsKey, attKey } from "./ReferencesTab";
import { FilesTab } from "./FilesTab";
import { ExperimentsTab, expKey } from "./ExperimentsTab";
import { TasksTab, taskKey } from "./TasksTab";
import { AITab } from "./AITab";
import { LatexSnippets } from "./LatexSnippets";
import { SectionTemplates, ExportMenu, ProjectOutline } from "./ProjectTools";
import { cn } from "@/lib/utils";

type Meta = { status?: string; venue?: string; deadline?: string; repoUrl?: string; datasets?: string[]; [k: string]: unknown };
export function ResearchPanel({ pageId }: { pageId: string }) {
  const qc = useQueryClient();
  const { data: page } = useQuery<any>({ queryKey: ["research-page", pageId], queryFn: () => api(`/api/pages/${pageId}`), staleTime: 30_000 });
  const { data: refs = [] } = useQuery<any[]>({ queryKey: refsKey(pageId), queryFn: () => api(`/api/research/references?pageId=${pageId}`) });
  const { data: files = [] } = useQuery<any[]>({ queryKey: attKey(pageId), queryFn: () => api(`/api/attachments?pageId=${pageId}`) });
  const { data: exps = [] } = useQuery<any[]>({ queryKey: expKey(pageId), queryFn: () => api(`/api/research/experiments?pageId=${pageId}`) });
  const { data: tasks = [] } = useQuery<any[]>({ queryKey: taskKey(pageId), queryFn: () => api(`/api/research/tasks?pageId=${pageId}`) });
  const [open, setOpen] = useState(true); const [tab, setTab] = useState("references"); const [meta, setMeta] = useState<Meta>({}); const [dsDraft, setDsDraft] = useState(""); const loaded = useRef(false);
  useEffect(() => { try { const o = localStorage.getItem("research-panel-open"); if (o != null) setOpen(o === "1"); const t = localStorage.getItem(`research-tab-${pageId}`); if (t) setTab(t); } catch {} }, [pageId]);
  useEffect(() => { if (page && !loaded.current) { setMeta((page.properties ?? {}) as Meta); loaded.current = true; } }, [page]);
  const timer = useRef<any>(null);
  /** Merge into the freshest server copy of properties so other editors of `properties` (tags) are not clobbered. */
  async function persist(patch: Partial<Meta>) {
    const next = { ...meta, ...patch }; setMeta(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { const fresh = await api(`/api/pages/${pageId}`); const merged = { ...(fresh.properties ?? {}), ...next }; await api(`/api/pages/${pageId}`, { method: "PATCH", json: { properties: merged } }); qc.setQueryData(["research-page", pageId], { ...fresh, properties: merged }); qc.invalidateQueries({ queryKey: ["research-overview"] }); }
      catch (e: any) { toast("Research properties not saved", { description: `${e.status === 0 ? "No connection." : e.message} Your entries are still on screen.`, tone: "danger", action: { label: "Retry", run: () => persist({}) } }); }
    }, 500);
  }
  const openTasks = tasks.filter((t) => t.status !== "done").length; const overdue = tasks.filter((t) => t.status !== "done" && t.dueAt && new Date(t.dueAt) < new Date()).length;
  const deadlineSoon = meta.deadline && (new Date(meta.deadline).getTime() - Date.now()) / 864e5 < 14;
  const datasets = Array.isArray(meta.datasets) ? meta.datasets : [];
  return (
    <section className="mt-4 min-w-0 rounded-xl border border-line bg-bg-elev shadow-card" aria-label="Research workspace">
      <header className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button onClick={() => { setOpen(!open); try { localStorage.setItem("research-panel-open", open ? "0" : "1"); } catch {} }} className="flex h-11 items-center gap-1.5 rounded-md px-1.5 text-[14px] font-medium hover:bg-bg-sunk md:h-8 md:text-[13px]" aria-expanded={open}>{open ? <ChevronDown className="size-4 text-fg-faint" /> : <ChevronRight className="size-4 text-fg-faint" />}<FlaskConical className="size-4 text-accent" /> Research</button>
        <Select value={meta.status ?? ""} onChange={(e) => persist({ status: e.target.value || undefined })} className={cn("capitalize", !meta.status && "text-fg-faint")} aria-label="Status"><option value="">status…</option>{PAPER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        {!open && <span className="flex flex-wrap items-center gap-1 text-[11px] text-fg-faint">{meta.status && <Badge tone={STATUS_TONE[meta.status] ?? "neutral"} className="capitalize">{meta.status}</Badge>}<span>{refs.length} refs</span><span>· {files.length} files</span><span>· {exps.length} exp.</span><span className={overdue ? "text-danger-text" : ""}>· {openTasks} tasks{overdue ? ` (${overdue} overdue)` : ""}</span>{meta.venue && <span>· {meta.venue}</span>}{meta.deadline && <span className={deadlineSoon ? "text-warning-text" : ""}>· due {meta.deadline}</span>}</span>}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5"><SectionTemplates /><LatexSnippets compact /><ExportMenu pageId={pageId} /><Link href="/research" className="flex h-11 items-center gap-1 rounded-md border border-line bg-bg-elev px-3 text-[13px] font-medium hover:bg-bg-sunk md:h-7 md:px-2 md:text-[12px]" aria-label="Working papers overview"><LayoutGrid className="size-4 md:size-3.5" /><span className="hidden sm:inline">Overview</span></Link></span>
      </header>
      {open && (
        <div className="border-t border-line px-3 pb-3 pt-2">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex min-w-0 flex-col gap-0.5"><span className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">Venue / target journal</span><Input value={meta.venue ?? ""} onChange={(e) => persist({ venue: e.target.value })} placeholder="e.g. Journal of Financial Economics" className={FIELD} /></label>
            <label className="flex min-w-0 flex-col gap-0.5"><span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint"><CalendarClock className="size-3" /> Deadline</span><input type="date" value={meta.deadline ?? ""} onChange={(e) => persist({ deadline: e.target.value || undefined })} className={cn("h-11 min-w-0 rounded-md border border-line bg-bg-elev px-2 text-[16px] shadow-card md:h-8 md:text-[13px]", deadlineSoon && "border-warning/60")} /></label>
            <label className="flex min-w-0 flex-col gap-0.5"><span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint"><GitBranch className="size-3" /> Git repository</span><div className="flex items-center gap-1"><Input value={meta.repoUrl ?? ""} onChange={(e) => persist({ repoUrl: e.target.value })} placeholder="https://…" inputMode="url" autoCapitalize="none" className={FIELD} />{meta.repoUrl && /^https?:\/\//.test(meta.repoUrl) && <a href={meta.repoUrl} target="_blank" rel="noopener noreferrer" className="grid h-11 shrink-0 place-items-center px-2 text-[13px] text-accent hover:underline md:h-8 md:text-[11px]">Open</a>}</div></label>
            <div className="flex min-w-0 flex-col gap-0.5"><span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint"><Database className="size-3" /> Datasets</span><div className="flex min-h-11 flex-wrap items-center gap-1 rounded-md border border-line bg-bg-elev px-1.5 py-1 shadow-card md:min-h-8 md:py-0.5">{datasets.map((d) => <span key={d} className="flex max-w-full items-center rounded bg-bg-sunk pl-2 text-[13px] md:text-[11px]"><a href={/^https?:/.test(d) ? d : undefined} target="_blank" rel="noopener noreferrer" className="truncate hover:text-accent">{d}</a><button type="button" className="grid size-9 shrink-0 place-items-center text-fg-muted hover:text-danger-text md:size-6" onClick={() => persist({ datasets: datasets.filter((x) => x !== d) })} aria-label={`Remove dataset ${d}`}><X className="size-3.5 md:size-3" /></button></span>)}<input value={dsDraft} onChange={(e) => setDsDraft(e.target.value)} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && dsDraft.trim()) { e.preventDefault(); persist({ datasets: [...datasets, dsDraft.trim()] }); setDsDraft(""); } }} onBlur={() => { if (dsDraft.trim()) { persist({ datasets: [...datasets, dsDraft.trim()] }); setDsDraft(""); } }} placeholder={datasets.length ? "" : "name or URL, Enter"} aria-label="Add a dataset" enterKeyHint="done" autoCapitalize="none" className="h-9 min-w-[6rem] flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-faint md:h-6 md:text-[12px]" /><Plus className="size-3 text-fg-faint" aria-hidden /></div></div>
          </div>
          <ProjectOutline pageId={pageId} />
          <Tabs value={tab} onValueChange={(v) => { setTab(v); try { localStorage.setItem(`research-tab-${pageId}`, v); } catch {} }} className="mt-3">
            <div className="-mx-3 overflow-x-auto overscroll-x-contain px-3 [scrollbar-width:none]"><TabsList className="h-12 w-max md:h-8 [&>button]:h-11 [&>button]:px-3.5 [&>button]:text-[14px] md:[&>button]:h-7 md:[&>button]:px-3 md:[&>button]:text-[13px]">
              <TabsTrigger value="references"><BookMarked className="mr-1 size-3.5" /> References <span className="ml-1 text-fg-faint">{refs.length}</span></TabsTrigger>
              <TabsTrigger value="files"><FileText className="mr-1 size-3.5" /> Files <span className="ml-1 text-fg-faint">{files.length}</span></TabsTrigger>
              <TabsTrigger value="experiments"><FlaskConical className="mr-1 size-3.5" /> Experiments <span className="ml-1 text-fg-faint">{exps.length}</span></TabsTrigger>
              <TabsTrigger value="tasks"><CheckSquare className="mr-1 size-3.5" /> Tasks <span className={cn("ml-1", overdue ? "text-danger-text" : "text-fg-faint")}>{openTasks}</span></TabsTrigger>
              <TabsTrigger value="ai"><Sparkles className="mr-1 size-3.5 text-ai" /> AI</TabsTrigger>
            </TabsList></div>
            <TabsContent value="references" className="mt-3 outline-none"><ReferencesTab pageId={pageId} /></TabsContent>
            <TabsContent value="files" className="mt-3 outline-none"><FilesTab pageId={pageId} /></TabsContent>
            <TabsContent value="experiments" className="mt-3 outline-none"><ExperimentsTab pageId={pageId} /></TabsContent>
            <TabsContent value="tasks" className="mt-3 outline-none"><TasksTab pageId={pageId} /></TabsContent>
            <TabsContent value="ai" className="mt-3 outline-none"><AITab pageId={pageId} pageTitle={page?.title ?? "Working paper"} /></TabsContent>
          </Tabs>
        </div>
      )}
    </section>
  );
}
