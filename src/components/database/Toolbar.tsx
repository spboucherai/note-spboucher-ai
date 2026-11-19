"use client";
import { useEffect, useRef, useState } from "react";
import { NewFromTemplate } from "./RowTemplates";
import { GROUPABLE } from "@/lib/databases/group";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Search, Filter, ArrowUpDown, Layers, SlidersHorizontal, Plus, MoreHorizontal, Download, Upload, Copy, LayoutTemplate, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent, Popover, PopoverTrigger, PopoverContent, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { useDb } from "./hooks";
import { FilterBuilder, SortBuilder, describeFilter } from "./FilterBuilder";
import { PropertyManager } from "./PropertyManager";
import { ViewOptions } from "./ViewOptions";
import { Sel } from "./meta";

export const GROUPABLE_VIEWS = ["board", "table", "list"];

export function Toolbar({ search: applied, setSearch: apply, onShowTemplates }: { search: string; setSearch: (s: string) => void; onShowTemplates: () => void }) {
  const ctx = useDb();
  // 3.0 (audit D5 / defect 13): the box keeps what is typed; the query runs 300 ms after the last keystroke, not once per character
  const [search, setText] = useState(applied); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setSearch = (s: string) => { setText(s); if (timer.current) clearTimeout(timer.current); if (s === "") apply(""); else timer.current = setTimeout(() => apply(s), 300); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(!!search);
  const file = useRef<HTMLInputElement>(null);

  const nFilters = describeFilter(ctx.view.config.filter);
  const nSorts = ctx.view.config.sorts?.length ?? 0;
  const groupable = ctx.props.filter((p) => GROUPABLE.has(p.type));
  const canGroup = GROUPABLE_VIEWS.includes(ctx.view.type);
  const gb = ctx.view.config.groupBy ?? "";

  const importCsv = async (f: File | undefined) => {
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch(`/api/databases/${ctx.db.id}/import`, { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json().catch(() => null); // an error page is not JSON: say what the server answered instead of a parser message
      if (!res.ok || !j) throw new Error(j?.error ?? `The server answered ${res.status}`);
      toast(`Imported ${j.created} rows`, { description: j.properties.length ? `New properties: ${j.properties.join(", ")}` : undefined, tone: "success" });
      ctx.refresh();
    } catch (e: any) { toast("Import failed", { description: e?.message, tone: "danger" }); }
    finally { if (file.current) file.current.value = ""; }
  };
  const duplicate = async (withRows: boolean) => {
    try {
      const d = await api(`/api/databases/${ctx.db.id}/duplicate`, { method: "POST", json: { withRows } });
      qc.invalidateQueries({ queryKey: ["tree"] });
      toast(withRows ? "Database duplicated with rows" : "Database structure duplicated");
      router.push(`/p/${d.pageId}`);
    } catch (e: any) { toast("Could not duplicate", { description: e?.message, tone: "danger" }); }
  };
  const toggleTemplate = async () => {
    try {
      await api(`/api/databases/${ctx.db.id}`, { method: "PATCH", json: { isTemplate: !ctx.db.isTemplate } });
      ctx.refresh();
      toast(ctx.db.isTemplate ? "No longer a template" : "Marked as template");
    } catch (e: any) { toast("Could not update the database", { description: e?.message, tone: "danger" }); }
  };
  const closeSearch = () => { setSearch(""); setShowSearch(false); };

  const menu = (trigger: React.ReactNode) => (
    <Menu>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => window.open(`/api/databases/${ctx.db.id}/query?format=csv&viewId=${ctx.view.id}${applied ? `&q=${encodeURIComponent(applied)}` : ""}`, "_blank")}><Download /> Export CSV (this view{applied ? " + search" : ""}, all {ctx.total.toLocaleString("en-CA")} rows)</MenuItem>
        <MenuItem onSelect={() => file.current?.click()}><Upload /> Import CSV…</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => duplicate(false)}><Copy /> Duplicate (structure)</MenuItem>
        <MenuItem onSelect={() => duplicate(true)}><Copy /> Duplicate with rows</MenuItem>
        <MenuItem onSelect={toggleTemplate}><LayoutTemplate /> {ctx.db.isTemplate ? "Unmark template" : "Mark as template"}</MenuItem>
        <MenuItem onSelect={onShowTemplates}><LayoutTemplate /> Apply a built-in template…</MenuItem>
      </MenuContent>
    </Menu>
  );
  const fileInput = <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} />;

  // ---------- phone: search · "View options" (one sheet for filters, sort, grouping, layout, properties) · more · New
  if (ctx.isMobile) {
    const active = nFilters + nSorts + (canGroup && gb ? 1 : 0);
    const iconBtn = "grid size-11 shrink-0 place-items-center rounded-lg text-fg-muted active:bg-bg-sunk [&_svg]:size-5";
    return (
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" aria-label="Search rows" aria-pressed={showSearch} onClick={() => (showSearch ? closeSearch() : setShowSearch(true))} className={cn(iconBtn, showSearch && "bg-accent-soft text-accent")}><Search /></button>
          <button
            type="button"
            onClick={() => setOpen("options")}
            aria-haspopup="dialog"
            aria-label={`View options${nFilters ? `, ${nFilters} active filter${nFilters > 1 ? "s" : ""}` : ""}${nSorts ? `, ${nSorts} sort${nSorts > 1 ? "s" : ""}` : ""}${canGroup && gb ? ", grouped" : ""}`}
            className={cn("flex h-11 min-w-0 items-center gap-2 rounded-lg border border-line px-3 text-[14px] font-medium active:bg-bg-sunk [&_svg]:size-4 [&_svg]:shrink-0", active > 0 && "border-accent/40 bg-accent-soft text-accent")}
          >
            <SlidersHorizontal />
            <span className="truncate">View options</span>
            {nFilters > 0 && <span className="shrink-0 rounded-full bg-accent px-1.5 text-[12px] font-semibold leading-5 text-accent-fg" aria-hidden>{nFilters}</span>}
          </button>
          {menu(<button type="button" aria-label="More database actions" className={iconBtn}><MoreHorizontal /></button>)}
          <span className="ml-auto flex shrink-0 items-center"><Button className="h-11 shrink-0 rounded-r-none px-4 text-[15px]" onClick={() => ctx.newRow()}><Plus /> New</Button><NewFromTemplate className="grid h-11 w-9 place-items-center rounded-r-md border-l border-accent-fg/25 bg-accent text-accent-fg" /></span>
        </div>
        {showSearch && (
          <div className="flex h-11 items-center gap-2 rounded-lg border border-line bg-bg-elev pl-3">
            <Search className="size-4 shrink-0 text-fg-faint" />
            <input autoFocus type="search" enterKeyHint="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rows…" aria-label="Search rows" className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none" />
            <button type="button" aria-label="Clear and close search" onClick={closeSearch} className="grid size-11 shrink-0 place-items-center text-fg-muted"><X className="size-5" /></button>
          </div>
        )}
        <Dialog open={open === "options"} onOpenChange={(o) => setOpen(o ? "options" : null)}>
          <SheetContent title="View options" description={`“${ctx.view.name}” — changes are saved with this view.`} onOpenAutoFocus={(e) => e.preventDefault()}>
            <ViewOptions onDone={() => setOpen(null)} />
          </SheetContent>
        </Dialog>
        {fileInput}
      </div>
    );
  }

  // ---------- desktop
  const pill = (active: boolean) => cn("flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-fg-muted hover:bg-bg-sunk hover:text-fg [&_svg]:size-3.5", active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent");
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {showSearch ? (
        <div className="flex h-8 items-center gap-1 rounded-md border border-line bg-bg-elev px-2">
          <Search className="size-3.5 text-fg-faint" />
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rows…" aria-label="Search rows" className="w-28 bg-transparent text-[12px] outline-none sm:w-40" onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }} />
          <button type="button" aria-label="Clear and close search" onClick={closeSearch} className="text-fg-faint hover:text-fg"><X className="size-3.5" /></button>
        </div>
      ) : (
        <button type="button" aria-label="Search rows" onClick={() => setShowSearch(true)} className={pill(false)}><Search /></button>
      )}
      <Popover open={open === "filter"} onOpenChange={(o) => setOpen(o ? "filter" : null)}>
        <PopoverTrigger asChild><button type="button" aria-label={nFilters ? `Filters, ${nFilters} active` : "Filter"} className={pill(nFilters > 0)}><Filter />{nFilters > 0 ? `${nFilters} filter${nFilters > 1 ? "s" : ""}` : <span className="hidden sm:inline">Filter</span>}</button></PopoverTrigger>
        <PopoverContent className="w-auto"><FilterBuilder /></PopoverContent>
      </Popover>
      <Popover open={open === "sort"} onOpenChange={(o) => setOpen(o ? "sort" : null)}>
        <PopoverTrigger asChild><button type="button" aria-label={nSorts ? `Sort, ${nSorts} active` : "Sort"} className={pill(nSorts > 0)}><ArrowUpDown />{nSorts > 0 ? `${nSorts} sort${nSorts > 1 ? "s" : ""}` : <span className="hidden sm:inline">Sort</span>}</button></PopoverTrigger>
        <PopoverContent className="w-auto"><SortBuilder /></PopoverContent>
      </Popover>
      {canGroup && (
        <Popover open={open === "group"} onOpenChange={(o) => setOpen(o ? "group" : null)}>
          <PopoverTrigger asChild><button type="button" aria-label="Group" className={pill(!!gb)}><Layers />{gb ? ctx.props.find((p) => p.id === gb)?.name ?? "Group" : <span className="hidden sm:inline">Group</span>}</button></PopoverTrigger>
          <PopoverContent className="w-60">
            <div className="mb-1 text-[12px] font-medium text-fg-muted">Group by</div>
            <Sel aria-label="Group by" value={gb} onChange={(e) => ctx.patchView({ groupBy: e.target.value || null })} className="w-full"><option value="">None</option>{groupable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
            {!groupable.length && <div className="mt-1 text-[11px] text-fg-faint">Add a select, status or checkbox property to group.</div>}
            {/* with thousands of rows the groups are far apart: collapsing them all shows every group with its count and sums on one screen */}
            {ctx.groupProp && <div className="mt-2 flex items-center gap-1 border-t border-line pt-2 text-[12px]"><button type="button" onClick={() => ctx.patchView({ collapsed: ctx.groups.map((g) => g.key) })} className="h-7 rounded-md px-2 text-fg-muted hover:bg-bg-sunk hover:text-fg">Collapse all</button><button type="button" onClick={() => ctx.patchView({ collapsed: [] })} className="h-7 rounded-md px-2 text-fg-muted hover:bg-bg-sunk hover:text-fg">Expand all</button></div>}
          </PopoverContent>
        </Popover>
      )}
      <Popover open={open === "props"} onOpenChange={(o) => setOpen(o ? "props" : null)}>
        <PopoverTrigger asChild><button type="button" aria-label="Properties" className={pill(false)}><SlidersHorizontal /><span className="hidden sm:inline">Properties</span></button></PopoverTrigger>
        <PopoverContent className="w-auto"><PropertyManager onClose={() => setOpen(null)} /></PopoverContent>
      </Popover>
      {menu(<button type="button" aria-label="More database actions" className={pill(false)}><MoreHorizontal /></button>)}
      {fileInput}
      <span className="ml-1 flex items-center"><Button size="sm" className="h-8 rounded-r-none" onClick={() => ctx.newRow()}><Plus /> New</Button><NewFromTemplate className="grid h-8 w-6 place-items-center rounded-r-md border-l border-accent-fg/25 bg-accent text-accent-fg hover:opacity-90" /></span>
    </div>
  );
}
