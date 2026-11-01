"use client";
import { useState } from "react";
import { Plus, Settings2, Trash2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Database, View, ViewType } from "@/lib/databases/types";
import { VIEW_TYPES } from "@/lib/databases/types";
import { useViewMutations } from "./hooks";
import { VIEW_META, Sel, Field, inputCls } from "./meta";

export function ViewTabs({ db, view, onSelect }: { db: Database; view: View; onSelect: (id: string) => void }) {
  const m = useViewMutations(db, db.pageId); const [adding, setAdding] = useState(false); const [settings, setSettings] = useState(false); const [name, setName] = useState(""); const [type, setType] = useState<ViewType>("table");
  const create = async () => { const v = await m.createView.mutateAsync({ name: name.trim() || VIEW_META[type].label, type, config: defaultConfig(db, type) }); setAdding(false); setName(""); onSelect(v.id); };
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {db.views.map((v) => {
          const active = v.id === view.id;
          const btn = <button key={v.id} type="button" onClick={() => (active ? setSettings(true) : onSelect(v.id))} className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] [&_svg]:size-3.5", active ? "bg-bg-sunk font-medium text-fg" : "text-fg-muted hover:bg-bg-sunk hover:text-fg")}>{VIEW_META[v.type].icon}{v.name}{active && <Settings2 className="ml-0.5 !size-3 text-fg-faint" />}</button>;
          return active ? <Popover key={v.id} open={settings} onOpenChange={setSettings}><PopoverTrigger asChild>{btn}</PopoverTrigger><PopoverContent className="w-72"><ViewSettings db={db} view={v} onClose={() => setSettings(false)} onDeleted={() => { setSettings(false); onSelect(db.views.find((x) => x.id !== v.id)?.id ?? v.id); }} /></PopoverContent></Popover> : btn;
        })}
      </div>
      <Popover open={adding} onOpenChange={setAdding}><PopoverTrigger asChild><button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-fg-faint hover:bg-bg-sunk hover:text-fg"><Plus className="size-4" /></button></PopoverTrigger>
        <PopoverContent className="w-64 space-y-2">
          <div className="text-[12px] font-medium text-fg-muted">New view</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={VIEW_META[type].label} autoFocus className={inputCls} onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
          <div className="grid grid-cols-3 gap-1">{VIEW_TYPES.map((t) => <button key={t} type="button" onClick={() => setType(t)} className={cn("flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-[11px] [&_svg]:size-4", t === type ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted hover:bg-bg-sunk")}>{VIEW_META[t].icon}{VIEW_META[t].label}</button>)}</div>
          <Button size="sm" className="w-full" onClick={create} disabled={m.createView.isPending}>Create view</Button>
        </PopoverContent></Popover>
    </div>
  );
}
function defaultConfig(db: Database, type: ViewType) {
  const first = (types: string[]) => db.properties.find((p) => types.includes(p.type))?.id ?? null;
  if (type === "board") return { groupBy: first(["status", "select"]) }; if (type === "calendar") return { dateProperty: first(["date", "created_time"]) }; if (type === "timeline") { const d = first(["date"]); return { startProperty: d, endProperty: d }; } if (type === "gallery") return { coverProperty: first(["file"]) }; return {};
}
function ViewSettings({ db, view, onClose, onDeleted }: { db: Database; view: View; onClose: () => void; onDeleted: () => void }) {
  const m = useViewMutations(db, db.pageId); const [name, setName] = useState(view.name); const c = view.config; const patch = (config: Record<string, unknown>) => m.patchView.mutate({ id: view.id, config });
  const dates = db.properties.filter((p) => ["date", "created_time", "last_edited_time"].includes(p.type)); const groups = db.properties.filter((p) => ["select", "status", "checkbox"].includes(p.type)); const files = db.properties.filter((p) => p.type === "file");
  const opt = (ps: typeof db.properties, none = "—") => <><option value="">{none}</option>{ps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</>;
  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-fg-muted">View settings</div>
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== view.name && m.patchView.mutate({ id: view.id, name })} className={inputCls} onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); onClose(); } }} />
      <Field label="Layout"><Sel value={view.type} onChange={(e) => m.patchView.mutate({ id: view.id, type: e.target.value, config: defaultConfig(db, e.target.value as ViewType) })} className="w-full">{VIEW_TYPES.map((t) => <option key={t} value={t}>{VIEW_META[t].label}</option>)}</Sel></Field>
      {view.type === "board" && <Field label="Group by"><Sel value={c.groupBy ?? ""} onChange={(e) => patch({ groupBy: e.target.value || null })} className="w-full">{opt(groups, "Choose…")}</Sel></Field>}
      {view.type === "calendar" && <Field label="Date property"><Sel value={c.dateProperty ?? ""} onChange={(e) => patch({ dateProperty: e.target.value || null })} className="w-full">{opt(dates, "Choose…")}</Sel></Field>}
      {view.type === "timeline" && <><Field label="Start"><Sel value={c.startProperty ?? ""} onChange={(e) => patch({ startProperty: e.target.value || null })} className="w-full">{opt(dates, "Choose…")}</Sel></Field><Field label="End"><Sel value={c.endProperty ?? ""} onChange={(e) => patch({ endProperty: e.target.value || null })} className="w-full">{opt(dates, "Same as start")}</Sel></Field></>}
      {view.type === "gallery" && <Field label="Cover"><Sel value={c.coverProperty ?? ""} onChange={(e) => patch({ coverProperty: e.target.value || null })} className="w-full">{opt(files, "Page icon")}</Sel></Field>}
      <div className="flex items-center gap-1 pt-1">
        {!view.isDefault && <Button size="xs" variant="ghost" onClick={() => m.patchView.mutate({ id: view.id, isDefault: true })}><Star /> Make default</Button>}
        {db.views.length > 1 && <Button size="xs" variant="ghost" className="ml-auto text-danger" onClick={async () => { if (!confirm(`Delete view "${view.name}"?`)) return; await m.deleteView.mutateAsync(view.id); onDeleted(); }}><Trash2 /> Delete view</Button>}
      </div>
    </div>
  );
}
