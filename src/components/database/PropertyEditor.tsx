"use client";
import { useMemo, useState } from "react";
import { Plus, Trash2, X, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Property, PropertyType, PropertyConfig, SelectOption, OptionColor } from "@/lib/databases/types";
import { PROPERTY_TYPES, AGGREGATES, OPTION_COLORS, isError } from "@/lib/databases/types";
import { evaluate, FORMULA_HELP, formulaCycle, formulaSyntaxError } from "@/lib/databases/formula";
import { AiConfigEditor, aiConfigOf, aiProblem } from "./SmartProperty";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { formulaValue, newId, pickColor, displayValue } from "@/lib/databases/values";
import { useDb, usePropertyMutations, useAllDatabases, useRemoteDatabase } from "./hooks";
import { TYPE_META, TypeIcon, Sel, Field, inputCls } from "./meta";
import { DOT_CLASS } from "./colors";
import { OptionChip } from "./cells/SelectCell";

const CREATABLE = PROPERTY_TYPES.filter((t) => t !== "title"); const OPT_TYPES: PropertyType[] = ["select", "multi_select", "status"];
/** Create (prop undefined) or edit a property. Renders inside a popover/dialog. */
export function PropertyEditor({ prop, onClose, onBack }: { prop?: Property; onClose: () => void; onBack?: () => void }) {
  const ctx = useDb(); const m = usePropertyMutations(ctx.db, ctx.db.pageId);
  const [name, setName] = useState(prop?.name ?? ""); const [type, setType] = useState<PropertyType>(prop?.type ?? "text"); const [config, setConfig] = useState<PropertyConfig>(prop?.config ?? {});
  const [pickType, setPickType] = useState(!prop); const [confirm, setConfirm] = useState(false);
  const set = (c: Partial<PropertyConfig>) => setConfig((x) => ({ ...x, ...c }));
  const changeType = (t: PropertyType) => { setType(t); setPickType(false); if (!prop || prop.type !== t) setConfig(OPT_TYPES.includes(type) && OPT_TYPES.includes(t) && config.options?.length ? { options: config.options } : {}); if (!name) setName(TYPE_META[t].label); };
  const qc = useQueryClient();
  // 3.0: a formula that would read itself cannot be saved — the cycle is shown here, with its path, before the server refuses it
  const cycle = type === "formula" && typeof config.expression === "string" && config.expression.trim() ? formulaCycle(ctx.props.filter((p) => p.id !== prop?.id), name.trim() || TYPE_META[type].label, config.expression) : null;
  const save = async () => {
    const n = name.trim() || TYPE_META[type].label;
    if ((type === "relation" && !config.targetDatabaseId) || cycle) return;
    try { // 3.0: failures stay in the editor (toast by the mutation) instead of rejecting unhandled
      let cfg = config;
      if (type === "ai") { const ai = aiConfigOf(config); cfg = { ...config, prompt: ai.prompt, ai }; }
      const saved = prop ? await m.update.mutateAsync({ id: prop.id, ...(n !== prop.name ? { name: n } : {}), ...(type !== prop.type ? { type } : {}), config: cfg }) : await m.create.mutateAsync({ name: n, type, config: cfg });
      // the AI part goes through the documented route, which validates and normalises it
      if (type === "ai") { await api(`/api/databases/${ctx.db.id}/ai/config`, { method: "PUT", json: { propertyId: saved.id, ai: aiConfigOf(cfg) } }); qc.invalidateQueries({ queryKey: ["db", ctx.db.pageId] }); }
      onClose();
    } catch (e: any) { if (type === "ai" && e?.message) toast("AI configuration not saved", { description: e.message, tone: "danger" }); }
  };
  if (pickType) return (
    <div className="w-64">
      <div className="mb-1.5 flex items-center gap-1 text-[12px] font-medium text-fg-muted">{prop && <button type="button" onClick={() => setPickType(false)} className="rounded p-0.5 hover:bg-bg-sunk"><ChevronLeft className="size-4" /></button>}{prop ? "Change type" : "Property type"}</div>
      <div className="max-h-72 overflow-y-auto">{CREATABLE.map((t) => <button key={t} type="button" onClick={() => changeType(t)} className={cn("flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-bg-sunk", t === type && "bg-bg-sunk")}><TypeIcon type={t} />{TYPE_META[t].label}</button>)}</div>
      {prop && prop.type !== type && <div className="mt-1 text-[11px] text-warning">Changing the type converts existing values when possible.</div>}
    </div>
  );
  return (
    <div className="w-72 space-y-2.5 md:max-h-[calc(var(--radix-popover-content-available-height,100vh)-2rem)] md:overflow-y-auto md:pr-1">{/* a long configuration (AI, options) scrolls inside the popover instead of running off the screen */}
      <div className="flex items-center gap-1 text-[12px] font-medium text-fg-muted">{onBack && <button type="button" onClick={onBack} className="rounded p-0.5 hover:bg-bg-sunk"><ChevronLeft className="size-4" /></button>}{prop ? "Edit property" : "New property"}</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Property name" autoFocus className={inputCls} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") onClose(); }} />
      <button type="button" disabled={prop?.type === "title"} onClick={() => setPickType(true)} className="flex h-8 w-full items-center gap-2 rounded-md border border-line px-2 text-[13px] hover:bg-bg-sunk disabled:opacity-60"><TypeIcon type={type} />{TYPE_META[type].label}<span className="ml-auto text-[11px] text-fg-faint">{prop?.type === "title" ? "fixed" : "change"}</span></button>
      <ConfigEditor type={type} config={config} set={set} prop={prop} />
      {cycle && <p role="alert" data-testid="formula-cycle" className="rounded-md bg-danger/10 px-2 py-1.5 text-[12px] text-danger">Circular reference: {cycle.join(" → ")}. A formula cannot read itself, directly or through other formulas.</p>}
      {type === "ai" && aiProblem(aiConfigOf(config)) && <p className="text-[11px] text-fg-muted">You can save now and complete the configuration later; cells will show the problem until then.</p>}
      <div className="flex items-center gap-1.5 pt-1">
        <Button size="sm" onClick={save} disabled={m.create.isPending || m.update.isPending || (type === "relation" && !config.targetDatabaseId) || !!cycle}>{prop ? "Save" : "Add property"}</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        {prop && prop.type !== "title" && (confirm ? <Button size="sm" variant="danger" className="ml-auto" onClick={async () => { try { await m.remove.mutateAsync(prop.id); onClose(); } catch { /* toast shown by the mutation */ } }}>Confirm delete</Button> : <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={() => setConfirm(true)}><Trash2 /></Button>)}
      </div>
    </div>
  );
}
function ConfigEditor({ type, config, set, prop }: { type: PropertyType; config: PropertyConfig; set: (c: Partial<PropertyConfig>) => void; prop?: Property }) {
  const ctx = useDb();
  switch (type) {
    case "select": case "multi_select": case "status": return <OptionsEditor options={config.options ?? []} status={type === "status"} onChange={(options) => set({ options })} />;
    case "number": return <Field label="Format"><Sel value={config.format ?? "number"} onChange={(e) => set({ format: e.target.value as any })} className="w-full"><option value="number">Number</option><option value="integer">Integer</option><option value="percent">Percent</option><option value="currency">Currency (CAD)</option></Sel></Field>;
    case "date": return <label className="flex items-center justify-between text-[13px]">Include time<Switch checked={!!config.includeTime} onCheckedChange={(v) => set({ includeTime: v })} /></label>;
    case "relation": return <RelationConfig config={config} set={set} isNew={!prop} />;
    case "rollup": return <RollupConfig config={config} set={set} prop={prop} />;
    case "formula": return <FormulaConfig config={config} set={set} />;
    case "ai": return <AiConfigEditor value={aiConfigOf(config)} onChange={(ai) => set({ ai, prompt: ai.prompt })} />;
    default: return null;
  }
}
function OptionsEditor({ options, status, onChange }: { options: SelectOption[]; status: boolean; onChange: (o: SelectOption[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const n = draft.trim(); if (!n || options.some((o) => o.name.toLowerCase() === n.toLowerCase())) return; onChange([...options, { id: newId(), name: n, color: pickColor(options.length), ...(status ? { group: "todo" as const } : {}) }]); setDraft(""); };
  const upd = (id: string, patch: Partial<SelectOption>) => onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-1">
      <div className="text-[12px] font-medium text-fg-muted">Options</div>
      <div className="max-h-48 space-y-1 overflow-y-auto">{options.map((o) => (
        <div key={o.id} className="flex items-center gap-1">
          <ColorDot color={o.color} onChange={(color) => upd(o.id, { color })} />
          <input value={o.name} onChange={(e) => upd(o.id, { name: e.target.value })} className={cn(inputCls, "h-7 min-w-0 flex-1")} />
          {status && <Sel value={o.group ?? "todo"} onChange={(e) => upd(o.id, { group: e.target.value as any })} className="h-7 w-24 px-1 text-[12px]"><option value="todo">To-do</option><option value="in_progress">In progress</option><option value="done">Done</option></Sel>}
          <button type="button" onClick={() => onChange(options.filter((x) => x.id !== o.id))} className="grid size-7 shrink-0 place-items-center rounded text-fg-faint hover:bg-bg-sunk hover:text-danger"><X className="size-3.5" /></button>
        </div>))}</div>
      <div className="flex items-center gap-1"><input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New option" className={cn(inputCls, "h-7")} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} /><Button size="iconXs" variant="outline" onClick={add}><Plus /></Button></div>
    </div>
  );
}
function ColorDot({ color, onChange }: { color: OptionColor; onChange: (c: OptionColor) => void }) {
  const [open, setOpen] = useState(false);
  return <span className="relative"><button type="button" onClick={() => setOpen((o) => !o)} className={cn("block size-4 rounded-full ring-2 ring-transparent hover:ring-line-strong", DOT_CLASS[color])} />{open && <span className="absolute left-0 top-5 z-10 grid grid-cols-5 gap-1 rounded-md border border-line bg-bg-elev p-1.5 shadow-pop">{OPTION_COLORS.map((c) => <button key={c} type="button" onClick={() => { onChange(c); setOpen(false); }} className={cn("size-4 rounded-full", DOT_CLASS[c], c === color && "ring-2 ring-fg")} />)}</span>}</span>;
}
function RelationConfig({ config, set, isNew }: { config: PropertyConfig; set: (c: Partial<PropertyConfig>) => void; isNew: boolean }) {
  const ctx = useDb(); const { data } = useAllDatabases();
  return (
    <div className="space-y-2">
      <Field label="Related to"><Sel value={config.targetDatabaseId ?? ""} onChange={(e) => set({ targetDatabaseId: e.target.value || undefined })} className="w-full"><option value="">Choose a database…</option>{(data ?? []).map((d) => <option key={d.id} value={d.id}>{d.icon ? `${d.icon} ` : ""}{d.name}{d.id === ctx.db.id ? " (this database)" : ""}</option>)}</Sel></Field>
      {isNew && <label className="flex items-center justify-between text-[13px]">Show on the other database<Switch checked={!!config.twoWay} onCheckedChange={(v) => set({ twoWay: v })} /></label>}
      {!!config.syncedPropertyId && <div className="text-[11px] text-fg-faint">Synced relation (edits propagate to the source property).</div>}
      <label className="flex items-center justify-between text-[13px]">Limit to one row<Switch checked={!!config.single} onCheckedChange={(v) => set({ single: v })} /></label>
    </div>
  );
}
const AGG_LABEL: Record<(typeof AGGREGATES)[number], string> = { count: "Count rows", count_values: "Count values", sum: "Sum", avg: "Average", min: "Min (or earliest date)", max: "Max (or latest date)", unique: "Unique values", show: "Show original values", count_unique: "Count unique values", empty: "Count empty", not_empty: "Count not empty", percent_empty: "Percent empty", percent_not_empty: "Percent not empty", checked: "Count checked", unchecked: "Count unchecked", percent_checked: "Percent checked", percent_unchecked: "Percent unchecked", median: "Median", range: "Range (max − min, days for dates)" };
function RollupConfig({ config, set, prop }: { config: PropertyConfig; set: (c: Partial<PropertyConfig>) => void; prop?: Property }) {
  const ctx = useDb(); const rels = ctx.props.filter((p) => p.type === "relation"); const rel = rels.find((p) => p.id === config.relationPropertyId);
  const { data: target } = useRemoteDatabase(rel?.config.targetDatabaseId as string | undefined);
  return (
    <div className="space-y-2">
      <Field label="Relation"><Sel value={config.relationPropertyId ?? ""} onChange={(e) => set({ relationPropertyId: e.target.value || undefined, targetPropertyId: undefined })} className="w-full"><option value="">Choose…</option>{rels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>{!rels.length && <span className="text-[11px] text-warning">Add a relation property first.</span>}</Field>
      <Field label="Property of the related rows"><Sel value={config.targetPropertyId ?? ""} onChange={(e) => set({ targetPropertyId: e.target.value || undefined })} className="w-full" disabled={!target}><option value="">Choose…</option>{(target?.properties ?? []).filter((p) => p.type !== "file" && p.id !== prop?.id).map((p) => <option key={p.id} value={p.id}>{p.name}{["relation", "rollup", "formula"].includes(p.type) ? ` (${p.type})` : ""}</option>)}</Sel></Field>
      <Field label="Calculate"><Sel value={config.aggregate ?? "count"} onChange={(e) => set({ aggregate: e.target.value as any })} className="w-full">{AGGREGATES.map((a) => <option key={a} value={a}>{AGG_LABEL[a]}</option>)}</Sel></Field>
    </div>
  );
}
function FormulaConfig({ config, set }: { config: PropertyConfig; set: (c: Partial<PropertyConfig>) => void }) {
  const ctx = useDb(); const expr = config.expression ?? ""; const row = ctx.rows[0];
  const preview = useMemo(() => { if (!expr.trim()) return null; const byName = new Map(ctx.props.map((p) => [p.name, p])); return evaluate(expr, { prop: (n) => { const p = byName.get(n); if (!p) throw new Error(`Unknown property "${n}"`); const v = row?.values[p.id]; if (isError(v)) throw new Error(v.error.startsWith("Error in ") || v.error.startsWith("Circular") ? v.error : `Error in "${n}": ${v.error}`); return row ? formulaValue(p, v) : null; } }); }, [expr, ctx.props, row]);
  const syntax = expr.trim() ? formulaSyntaxError(expr) : null;
  const err = syntax ? `Syntax: ${syntax}` : preview && typeof preview === "object" && "error" in preview ? preview.error : null;
  return (
    <div className="space-y-1.5">
      <Field label="Expression"><textarea value={expr} onChange={(e) => set({ expression: e.target.value })} rows={3} spellCheck={false} placeholder='if(prop("Done"), "✓", dateDiff(prop("Due"), today(), "days"))' className={cn(inputCls, "h-auto py-1.5 font-mono text-[12px] max-md:h-auto")} /></Field>
      {expr.trim() && <div data-testid="formula-preview" data-error={err ? "true" : undefined} className={cn("rounded-md px-2 py-1.5 text-[12px]", err ? "bg-danger/10 text-danger" : "bg-bg-sunk text-fg-muted")}>{err ? err : <>Preview{row ? ` (${row.title || "first row"})` : ""}: <span className="font-medium text-fg">{preview == null ? "—" : displayValue({ id: "", databaseId: "", name: "", type: "formula", config: {}, position: 0, width: null }, preview)}</span></>}</div>}
      <details className="text-[11px] text-fg-faint"><summary className="cursor-pointer select-none">Functions</summary><pre className="mt-1 whitespace-pre-wrap font-mono text-[10.5px] leading-4">{FORMULA_HELP}</pre><div className="mt-1">Properties: {ctx.props.filter((p) => p.type !== "formula" || p.config.expression !== expr).map((p) => `prop("${p.name}")`).join(" · ")}</div></details>
    </div>
  );
}
