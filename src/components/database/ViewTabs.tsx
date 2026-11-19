"use client";
import { useState } from "react";
import { Plus, Settings2, Trash2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Database, View, ViewType } from "@/lib/databases/types";
import { VIEW_TYPES } from "@/lib/databases/types";
import { useViewMutations } from "./hooks";
import { VIEW_META, Sel, Field, inputCls } from "./meta";
import { ResponsivePanel } from "./Responsive";

/**
 * Saved views as horizontally scrollable chips (the strip scrolls inside itself, never the page), the selected one
 * clearly marked. View settings and "new view" open in a popover on desktop and in a bottom sheet on phones.
 */
export function ViewTabs({ db, view, onSelect, settingsOpen, onSettingsOpenChange }: {
  db: Database; view: View; onSelect: (id: string) => void; settingsOpen: boolean; onSettingsOpenChange: (open: boolean) => void;
}) {
  const m = useViewMutations(db, db.pageId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ViewType>("table");

  const create = async () => {
    try {
      const v = await m.createView.mutateAsync({ name: name.trim() || VIEW_META[type].label, type, config: defaultConfig(db, type) });
      setAdding(false);
      setName("");
      onSelect(v.id);
    } catch { /* toast shown by the mutation; the form keeps what was typed */ }
  };

  const iconBtn = "grid size-8 shrink-0 place-items-center rounded-md text-fg-faint hover:bg-bg-sunk hover:text-fg max-md:size-11 max-md:rounded-lg max-md:text-fg-muted";
  return (
    <div className="flex min-w-0 max-w-full items-center gap-0.5">
      <div role="tablist" aria-label="Views" className="flex min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] max-md:gap-1.5 max-md:py-0.5">
        {db.views.map((v) => {
          const active = v.id === view.id;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={active}
              // desktop habit kept: clicking the active tab opens its settings (the gear button does the same, visibly)
              onClick={() => (active ? onSettingsOpenChange(true) : onSelect(v.id))}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] [&_svg]:size-3.5 max-md:h-11 max-md:rounded-full max-md:border max-md:px-3.5 max-md:text-[14px] max-md:[&_svg]:size-4",
                active
                  ? "bg-bg-elev font-medium text-fg shadow-card ring-1 ring-line max-md:border-accent max-md:bg-accent-soft max-md:text-accent max-md:shadow-none max-md:ring-0"
                  : "text-fg-muted hover:bg-bg-sunk hover:text-fg max-md:border-line",
              )}
            >
              {VIEW_META[v.type].icon}
              <span className="max-w-[12rem] truncate">{v.name}</span>
            </button>
          );
        })}
      </div>

      <ResponsivePanel
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        title="View settings"
        description={`“${view.name}”`}
        className="w-72"
        trigger={<button type="button" aria-label={`Settings of the view ${view.name}`} aria-haspopup="dialog" className={iconBtn}><Settings2 className="size-4 max-md:size-5" /></button>}
      >
        <ViewSettings
          key={view.id}
          db={db}
          view={view}
          onClose={() => onSettingsOpenChange(false)}
          onDeleted={() => { onSettingsOpenChange(false); onSelect(db.views.find((x) => x.id !== view.id)?.id ?? view.id); }}
        />
      </ResponsivePanel>

      <ResponsivePanel
        open={adding}
        onOpenChange={setAdding}
        title="New view"
        description="Another way to look at the same rows."
        className="w-64"
        focusFirstInput
        trigger={<button type="button" aria-label="Add a view" aria-haspopup="dialog" className={iconBtn}><Plus className="size-4 max-md:size-5" /></button>}
      >
        <div className="space-y-2 max-md:space-y-3">
          <div className="text-[12px] font-medium text-fg-muted max-md:hidden">New view</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={VIEW_META[type].label} aria-label="View name" className={inputCls} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
          <div role="radiogroup" aria-label="Layout" className="grid grid-cols-3 gap-1 max-md:gap-2">
            {VIEW_TYPES.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={t === type} onClick={() => setType(t)} className={cn("flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-[11px] [&_svg]:size-4 max-md:h-16 max-md:rounded-xl max-md:text-[13px] max-md:[&_svg]:size-5", t === type ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted hover:bg-bg-sunk")}>
                {VIEW_META[t].icon}{VIEW_META[t].label}
              </button>
            ))}
          </div>
          {m.createView.isError && <p role="alert" className="text-[12px] text-danger max-md:text-[13px]">The view was not created: {(m.createView.error as any)?.message ?? "unknown error"}. Try again.</p>}
          <Button size="sm" className="w-full max-md:h-11 max-md:text-[15px]" onClick={create} disabled={m.createView.isPending}>{m.createView.isPending ? "Creating…" : "Create view"}</Button>
        </div>
      </ResponsivePanel>
    </div>
  );
}

function defaultConfig(db: Database, type: ViewType) {
  const first = (types: string[]) => db.properties.find((p) => types.includes(p.type))?.id ?? null;
  if (type === "board") return { groupBy: first(["status", "select"]) };
  if (type === "calendar") return { dateProperty: first(["date", "created_time"]) };
  if (type === "timeline") { const d = first(["date"]); return { startProperty: d, endProperty: d }; }
  if (type === "gallery") return { coverProperty: first(["file"]) };
  return {};
}

function ViewSettings({ db, view, onClose, onDeleted }: { db: Database; view: View; onClose: () => void; onDeleted: () => void }) {
  const m = useViewMutations(db, db.pageId);
  const [name, setName] = useState(view.name);
  const c = view.config;
  const patch = (config: Record<string, unknown>) => m.patchView.mutate({ id: view.id, config });
  const dates = db.properties.filter((p) => ["date", "created_time", "last_edited_time"].includes(p.type));
  const groups = db.properties.filter((p) => ["select", "status", "checkbox"].includes(p.type));
  const files = db.properties.filter((p) => p.type === "file");
  const opt = (ps: typeof db.properties, none = "—") => <><option value="">{none}</option>{ps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</>;

  const remove = async () => {
    if (!confirm(`Delete the view “${view.name}”? Its filters, sorts and layout are lost; the rows are not touched. This cannot be undone.`)) return;
    try { await m.deleteView.mutateAsync(view.id); onDeleted(); } catch { /* toast shown by the mutation */ }
  };
  const actionCls = "max-md:h-11 max-md:px-3 max-md:text-[14px]";
  return (
    <div className="space-y-2 max-md:space-y-3">
      <div className="text-[12px] font-medium text-fg-muted max-md:hidden">View settings</div>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== view.name && m.patchView.mutate({ id: view.id, name: name.trim() })} className={inputCls} onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); onClose(); } }} />
      </Field>
      {/* 3.0 (U7): changing the layout keeps what the view already has (group, dates, cover…) and only fills what the new layout needs */}
      <Field label="Layout"><Sel value={view.type} onChange={(e) => { const d = defaultConfig(db, e.target.value as ViewType) as Record<string, unknown>; const add: Record<string, unknown> = {}; for (const [k, v] of Object.entries(d)) if (c[k] == null && v != null) add[k] = v; m.patchView.mutate({ id: view.id, type: e.target.value, ...(Object.keys(add).length ? { config: add } : {}) }); }} className="w-full">{VIEW_TYPES.map((t) => <option key={t} value={t}>{VIEW_META[t].label}</option>)}</Sel></Field>
      {view.type === "board" && <Field label="Group by" hint={groups.length ? undefined : "Add a select, status or checkbox property first."}><Sel value={c.groupBy ?? ""} onChange={(e) => patch({ groupBy: e.target.value || null })} className="w-full">{opt(groups, "Choose…")}</Sel></Field>}
      {view.type === "calendar" && <Field label="Date property" hint={dates.length ? undefined : "Add a date property first."}><Sel value={c.dateProperty ?? ""} onChange={(e) => patch({ dateProperty: e.target.value || null })} className="w-full">{opt(dates, "Choose…")}</Sel></Field>}
      {view.type === "timeline" && (
        <>
          <Field label="Start" hint={dates.length ? undefined : "Add a date property first."}><Sel value={c.startProperty ?? ""} onChange={(e) => patch({ startProperty: e.target.value || null })} className="w-full">{opt(dates, "Choose…")}</Sel></Field>
          <Field label="End"><Sel value={c.endProperty ?? ""} onChange={(e) => patch({ endProperty: e.target.value || null })} className="w-full">{opt(dates, "Same as start")}</Sel></Field>
        </>
      )}
      {view.type === "gallery" && (
        <>
          <Field label="Cover"><Sel aria-label="Cover" value={c.cover === "page" ? "@page" : c.cover === "none" ? "@none" : c.coverProperty ?? ""} onChange={(e) => { const v = e.target.value; patch(v === "@page" ? { cover: "page" } : v === "@none" ? { cover: "none" } : { cover: "property", coverProperty: v || null }); }} className="w-full"><option value="">First image of a file property</option>{files.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="@page">Page cover</option><option value="@none">No cover</option></Sel></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Card size"><Sel aria-label="Card size" value={c.cardSize ?? "medium"} onChange={(e) => patch({ cardSize: e.target.value })} className="w-full"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></Sel></Field>
            <Field label="Image"><Sel aria-label="Image fit" value={c.coverFit ?? "cover"} onChange={(e) => patch({ coverFit: e.target.value })} className="w-full"><option value="cover">Fill</option><option value="contain">Fit</option></Sel></Field>
          </div>
          <fieldset className="space-y-0.5"><legend className="mb-1 text-[12px] font-medium text-fg-muted">Shown on cards</legend>
            <div className="max-h-40 overflow-y-auto">{db.properties.filter((p) => p.type !== "title").map((p) => { const cur = Array.isArray(c.cardProps) ? c.cardProps : null; const on = cur ? cur.includes(p.id) : false; return <label key={p.id} className="flex h-8 items-center gap-2 rounded-md px-1 text-[13px] hover:bg-bg-sunk max-md:h-11 max-md:text-[15px]"><input type="checkbox" checked={on} onChange={() => { const base = cur ?? []; const next = on ? base.filter((x) => x !== p.id) : [...base, p.id]; patch({ cardProps: db.properties.map((x) => x.id).filter((x) => next.includes(x)) }); }} className="size-3.5 accent-[var(--accent)] max-md:size-5" /><span className="truncate">{p.name}</span></label>; })}</div>
            {Array.isArray(c.cardProps) ? <button type="button" onClick={() => patch({ cardProps: null })} className="h-7 rounded-md px-1 text-[12px] text-accent hover:underline max-md:h-11 max-md:text-[14px]">Reset to the visible properties</button> : <span className="block text-[11px] text-fg-muted">Nothing ticked: the first visible properties are shown.</span>}
          </fieldset>
        </>
      )}
      <div className="flex flex-wrap items-center gap-1 pt-1">
        {view.isDefault
          ? <span className="flex items-center gap-1 text-[12px] text-fg-muted max-md:text-[13px]"><Star className="size-3.5" /> Default view</span>
          : <Button size="xs" variant="ghost" className={actionCls} onClick={() => m.patchView.mutate({ id: view.id, isDefault: true })}><Star /> Make default</Button>}
        {db.views.length > 1 && <Button size="xs" variant="ghost" className={cn("ml-auto text-danger", actionCls)} onClick={remove}><Trash2 /> Delete view</Button>}
      </div>
    </div>
  );
}
