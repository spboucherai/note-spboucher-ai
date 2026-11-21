/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/research/ProjectTools.tsx
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
 * file: src/components/research/ProjectTools.tsx
 * description: project-level tools of the research panel — "Sections" (insert a hypothesis / methods note / equation / result / figure /
 *   question / decision / bibliography template at the end of the page, built from existing nodes), "Export" (LaTeX skeleton of the
 *   project as .tex or as a .zip with figures, and the project's BibTeX file — `GET /api/research/export.tex`, API-NEXT-AI §8, with the
 *   export report shown before downloading) and the outline of the project's pages (children of the research page).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Download, FileArchive, FileCode2, LayoutTemplate, Plus, TriangleAlert } from "lucide-react";
import { api } from "@/lib/client/api";
import { useOnline } from "@/lib/client/hooks";
import { Menu, MenuTrigger, MenuContent, MenuItem, Popover, PopoverTrigger, PopoverContent, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { SECTION_TEMPLATES } from "@/lib/research/template";
import { cn } from "@/lib/utils";
import { errText } from "./ui";

const HEAD_BTN = "flex h-11 items-center gap-1 rounded-md border border-line bg-bg-elev px-3 text-[13px] font-medium hover:bg-bg-sunk md:h-7 md:px-2 md:text-[12px]";
/** Insert ProseMirror nodes at the end of the open page (PageView listens; `plain` = the owner's own material, no AI wrapper). */
export function insertNodes(nodes: unknown[]) { window.dispatchEvent(new CustomEvent("note:insert-markdown", { detail: { markdown: " ", nodes, plain: true } })); }

export function SectionTemplates() {
  return (
    <Menu>
      <MenuTrigger asChild><button type="button" className={HEAD_BTN} aria-label="Insert a research section"><LayoutTemplate className="size-4 md:size-3.5" /><span className="hidden sm:inline">Sections</span></button></MenuTrigger>
      <MenuContent className="w-64">
        {SECTION_TEMPLATES.map((t) => <MenuItem key={t.id} className="flex-col items-start gap-0" onSelect={() => insertNodes(t.nodes())}><span className="text-[13px] font-medium">{t.label}</span><span className="text-[11.5px] text-fg-muted">{t.hint}</span></MenuItem>)}
      </MenuContent>
    </Menu>
  );
}

interface ExportReport { title: string; citeKeys: string[]; missingKeys: string[]; missingRefs: string[]; figures: { name: string }[]; sections: number; hypotheses: number; experiments: number; unknownNodes: string[] }
export const texUrl = (projectId: string, format?: "zip" | "json") => `/api/research/export.tex?projectId=${projectId}${format ? `&format=${format}` : ""}`;
export const bibUrl = (projectId: string) => `/api/research/references/export.bib?projectId=${projectId}`;
export function ExportMenu({ pageId }: { pageId: string }) {
  const [open, setOpen] = React.useState(false); const online = useOnline();
  const rep = useQuery<ExportReport>({ queryKey: ["research-export-report", pageId], enabled: open, staleTime: 0, gcTime: 0, retry: false, queryFn: () => api(texUrl(pageId, "json")) });
  const r = rep.data; const row = "flex min-h-11 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-bg-hover md:min-h-8";
  const warn = r ? [r.missingKeys.length ? `${r.missingKeys.length} cited key${r.missingKeys.length === 1 ? "" : "s"} not in the library: ${r.missingKeys.slice(0, 6).join(", ")}${r.missingKeys.length > 6 ? "…" : ""}` : "", r.missingRefs.length ? `${r.missingRefs.length} citation${r.missingRefs.length === 1 ? "" : "s"} point to a deleted reference (exported as [?])` : "", r.unknownNodes.length ? `Blocks left out: ${r.unknownNodes.join(", ")}` : ""].filter(Boolean) : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className={HEAD_BTN} aria-label="Export the project"><Download className="size-4 md:size-3.5" /><span className="hidden sm:inline">Export</span></button></PopoverTrigger>
      <PopoverContent align="end" className="w-[min(21rem,calc(100vw-1.5rem))] p-2" data-testid="research-export">
        <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">Export this project</div>
        <a className={row} href={texUrl(pageId)} download data-testid="export-tex"><FileCode2 className="size-4 text-fg-muted" /><span className="min-w-0 flex-1"><span className="block font-medium">LaTeX (.tex)</span><span className="block text-[11.5px] text-fg-muted">Article skeleton: this page, then one section per child page</span></span></a>
        <a className={row} href={texUrl(pageId, "zip")} download data-testid="export-zip"><FileArchive className="size-4 text-fg-muted" /><span className="min-w-0 flex-1"><span className="block font-medium">LaTeX + figures (.zip)</span><span className="block text-[11.5px] text-fg-muted">main.tex, references.bib, figures/</span></span></a>
        <a className={row} href={bibUrl(pageId)} download data-testid="export-bib"><BookMarked className="size-4 text-fg-muted" /><span className="min-w-0 flex-1"><span className="block font-medium">BibTeX (.bib)</span><span className="block text-[11.5px] text-fg-muted">References attached to or cited in the project</span></span></a>
        <div className="mt-1 border-t border-line px-2 pt-2 text-[12px] text-fg-muted" data-testid="export-report" aria-live="polite">
          {!online ? "You are offline — exports need the server." : rep.isLoading ? <Skeleton className="h-4 w-3/4" /> : rep.isError ? <span className="text-danger-text">The export report could not be computed: {errText(rep.error)}</span>
            : r ? <><div>{r.sections} section{r.sections === 1 ? "" : "s"} · {r.citeKeys.length} cite key{r.citeKeys.length === 1 ? "" : "s"} · {r.figures.length} figure{r.figures.length === 1 ? "" : "s"} · {r.hypotheses} hypothes{r.hypotheses === 1 ? "is" : "es"} · {r.experiments} experiment{r.experiments === 1 ? "" : "s"}</div>
                {warn.map((w) => <div key={w} className="mt-1 flex items-start gap-1.5 text-fg"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /><span className="min-w-0 break-words">{w}</span></div>)}
                <div className="mt-1 text-fg-faint">No AI is involved; equations and \cite keys are exported verbatim.</div></> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface TreeNode { id: string; title: string; icon: string | null; type: string; parentId?: string | null }
/** The pages of the project (children of the research page) and a way to add one. */
export function ProjectOutline({ pageId }: { pageId: string }) {
  const qc = useQueryClient(); const online = useOnline(); const [busy, setBusy] = React.useState(false);
  const tree = useQuery<TreeNode[]>({ queryKey: ["tree"], staleTime: 10_000, queryFn: () => api("/api/tree") });
  const kids = (tree.data ?? []).filter((n) => n.parentId === pageId && n.type !== "database");
  async function add() {
    if (busy) return; setBusy(true);
    try { await api("/api/pages", { method: "POST", json: { title: "New project page", parentId: pageId, section: "research" } }); await qc.invalidateQueries({ queryKey: ["tree"] }); toast("Page added to the project", { tone: "success" }); }
    catch (e) { toast("Page not created", { description: errText(e), tone: "danger" }); } finally { setBusy(false); }
  }
  if (tree.isLoading) return null;
  return (
    <nav className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Project pages" data-testid="project-outline">
      <span className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">Project pages</span>
      {kids.length === 0 && <span className="text-[12px] text-fg-muted">None yet — each child page becomes a section of the LaTeX export.</span>}
      {kids.map((k) => <Link key={k.id} href={`/p/${k.id}`} className="flex min-h-9 max-w-full items-center gap-1 rounded-md border border-line bg-bg px-2 text-[12.5px] hover:bg-bg-hover md:min-h-7"><span aria-hidden>{k.icon ?? "📄"}</span><span className="truncate">{k.title || "Untitled"}</span></Link>)}
      <button type="button" onClick={add} disabled={busy || !online} className={cn("flex min-h-9 items-center gap-1 rounded-md border border-dashed border-line-strong px-2 text-[12.5px] text-fg-muted hover:bg-bg-hover disabled:opacity-50 md:min-h-7")}><Plus className="size-3.5" /> Add page</button>
    </nav>
  );
}
