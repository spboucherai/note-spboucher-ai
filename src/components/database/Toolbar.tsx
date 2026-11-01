"use client";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Search, Filter, ArrowUpDown, Layers, SlidersHorizontal, Plus, MoreHorizontal, Download, Upload, Copy, LayoutTemplate, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { useDb } from "./hooks";
import { FilterBuilder, SortBuilder, describeFilter } from "./FilterBuilder";
import { PropertyManager } from "./PropertyManager";
import { Sel } from "./meta";

export function Toolbar({ search, setSearch, onShowTemplates }: { search: string; setSearch: (s: string) => void; onShowTemplates: () => void }) {
  const ctx = useDb(); const qc = useQueryClient(); const r = useRouter(); const [open, setOpen] = useState<string | null>(null); const [showSearch, setShowSearch] = useState(!!search); const file = useRef<HTMLInputElement>(null);
  const nFilters = describeFilter(ctx.view.config.filter); const nSorts = ctx.view.config.sorts?.length ?? 0; const groupable = ctx.props.filter((p) => ["select", "status", "checkbox"].includes(p.type));
  const canGroup = ["board", "table", "list"].includes(ctx.view.type); const gb = ctx.view.config.groupBy ?? "";
  const importCsv = async (f: File | undefined) => { if (!f) return; const fd = new FormData(); fd.append("file", f); try { const res = await fetch(`/api/databases/${ctx.db.id}/import`, { method: "POST", body: fd, credentials: "same-origin" }); const j = await res.json(); if (!res.ok) throw new Error(j.error); toast(`Imported ${j.created} rows`, { description: j.properties.length ? `New properties: ${j.properties.join(", ")}` : undefined, tone: "success" }); ctx.refresh(); } catch (e: any) { toast("Import failed", { description: e?.message, tone: "danger" }); } finally { if (file.current) file.current.value = ""; } };
  const pill = (active: boolean) => cn("flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-fg-muted hover:bg-bg-sunk hover:text-fg [&_svg]:size-3.5", active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent");
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {showSearch ? <div className="flex h-8 items-center gap-1 rounded-md border border-line bg-bg-elev px-2"><Search className="size-3.5 text-fg-faint" /><input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rows…" className="w-28 bg-transparent text-[12px] outline-none sm:w-40" onKeyDown={(e) => { if (e.key === "Escape") { setSearch(""); setShowSearch(false); } }} /><button type="button" onClick={() => { setSearch(""); setShowSearch(false); }} className="text-fg-faint hover:text-fg"><X className="size-3.5" /></button></div> : <button type="button" onClick={() => setShowSearch(true)} className={pill(false)}><Search /></button>}
      <Popover open={open === "filter"} onOpenChange={(o) => setOpen(o ? "filter" : null)}><PopoverTrigger asChild><button type="button" className={pill(nFilters > 0)}><Filter />{nFilters > 0 ? `${nFilters} filter${nFilters > 1 ? "s" : ""}` : <span className="hidden sm:inline">Filter</span>}</button></PopoverTrigger><PopoverContent className="w-auto"><FilterBuilder /></PopoverContent></Popover>
      <Popover open={open === "sort"} onOpenChange={(o) => setOpen(o ? "sort" : null)}><PopoverTrigger asChild><button type="button" className={pill(nSorts > 0)}><ArrowUpDown />{nSorts > 0 ? `${nSorts} sort${nSorts > 1 ? "s" : ""}` : <span className="hidden sm:inline">Sort</span>}</button></PopoverTrigger><PopoverContent className="w-auto"><SortBuilder /></PopoverContent></Popover>
      {canGroup && <Popover open={open === "group"} onOpenChange={(o) => setOpen(o ? "group" : null)}><PopoverTrigger asChild><button type="button" className={pill(!!gb)}><Layers />{gb ? ctx.props.find((p) => p.id === gb)?.name ?? "Group" : <span className="hidden sm:inline">Group</span>}</button></PopoverTrigger><PopoverContent className="w-60"><div className="mb-1 text-[12px] font-medium text-fg-muted">Group by</div><Sel value={gb} onChange={(e) => ctx.patchView({ groupBy: e.target.value || null })} className="w-full"><option value="">None</option>{groupable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>{!groupable.length && <div className="mt-1 text-[11px] text-fg-faint">Add a select, status or checkbox property to group.</div>}</PopoverContent></Popover>}
      <Popover open={open === "props"} onOpenChange={(o) => setOpen(o ? "props" : null)}><PopoverTrigger asChild><button type="button" className={pill(false)}><SlidersHorizontal /><span className="hidden sm:inline">Properties</span></button></PopoverTrigger><PopoverContent className="w-auto"><PropertyManager onClose={() => setOpen(null)} /></PopoverContent></Popover>
      <Menu><MenuTrigger asChild><button type="button" className={pill(false)}><MoreHorizontal /></button></MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => window.open(`/api/databases/${ctx.db.id}/query?format=csv&viewId=${ctx.view.id}`, "_blank")}><Download /> Export CSV (this view)</MenuItem>
          <MenuItem onSelect={() => file.current?.click()}><Upload /> Import CSV…</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={async () => { const d = await api(`/api/databases/${ctx.db.id}/duplicate`, { method: "POST", json: { withRows: false } }); qc.invalidateQueries({ queryKey: ["tree"] }); toast("Database structure duplicated"); r.push(`/p/${d.pageId}`); }}><Copy /> Duplicate (structure)</MenuItem>
          <MenuItem onSelect={async () => { const d = await api(`/api/databases/${ctx.db.id}/duplicate`, { method: "POST", json: { withRows: true } }); qc.invalidateQueries({ queryKey: ["tree"] }); toast("Database duplicated with rows"); r.push(`/p/${d.pageId}`); }}><Copy /> Duplicate with rows</MenuItem>
          <MenuItem onSelect={async () => { await api(`/api/databases/${ctx.db.id}`, { method: "PATCH", json: { isTemplate: !ctx.db.isTemplate } }); ctx.refresh(); toast(ctx.db.isTemplate ? "No longer a template" : "Marked as template"); }}><LayoutTemplate /> {ctx.db.isTemplate ? "Unmark template" : "Mark as template"}</MenuItem>
          <MenuItem onSelect={onShowTemplates}><LayoutTemplate /> Apply a built-in template…</MenuItem>
        </MenuContent></Menu>
      <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} />
      <Button size="sm" className="ml-1 h-8" onClick={() => ctx.addRow()}><Plus /> New</Button>
    </div>
  );
}
