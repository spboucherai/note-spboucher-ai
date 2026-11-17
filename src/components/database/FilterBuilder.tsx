"use client";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Property, FilterGroup, FilterNode, FilterRule, FilterOp, Sort } from "@/lib/databases/types";
import { isGroup } from "@/lib/databases/types";
import { useDb } from "./hooks";
import { Sel, inputCls } from "./meta";

const OPS: Record<string, [FilterOp, string][]> = {
  text: [["contains", "contains"], ["not_contains", "does not contain"], ["eq", "is"], ["neq", "is not"], ["starts_with", "starts with"], ["ends_with", "ends with"], ["empty", "is empty"], ["not_empty", "is not empty"]],
  number: [["eq", "="], ["neq", "≠"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["empty", "is empty"], ["not_empty", "is not empty"]],
  date: [["on", "is"], ["before", "is before"], ["after", "is after"], ["empty", "is empty"], ["not_empty", "is not empty"]],
  checkbox: [["eq", "is"]], select: [["eq", "is"], ["neq", "is not"], ["empty", "is empty"], ["not_empty", "is not empty"]], multi: [["contains", "contains"], ["not_contains", "does not contain"], ["empty", "is empty"], ["not_empty", "is not empty"]], file: [["empty", "is empty"], ["not_empty", "is not empty"]],
};
const kind = (p?: Property) => !p ? "text" : ["number", "rollup"].includes(p.type) ? "number" : ["date", "created_time", "last_edited_time"].includes(p.type) ? "date" : p.type === "checkbox" ? "checkbox" : ["select", "status"].includes(p.type) ? "select" : p.type === "multi_select" ? "multi" : p.type === "relation" ? "multi" : p.type === "file" ? "file" : "text";
export const describeFilter = (f: FilterGroup | null | undefined): number => !f ? 0 : (f.and ?? f.or ?? []).reduce((n, x) => n + (isGroup(x) ? describeFilter(x) : 1), 0);

/** Shared touch sizing: 44 px targets below `md`, the dense desktop size above. */
const actionCls = "flex h-7 items-center gap-1 rounded-md px-1.5 text-fg-muted hover:bg-bg-sunk hover:text-fg max-md:h-11 max-md:px-3 max-md:text-[14px]";
const removeCls = "grid size-7 shrink-0 place-items-center rounded text-fg-faint hover:bg-bg-sunk hover:text-danger max-md:size-11 max-md:rounded-lg";

/** `fluid`: take the width of the container (phone "View options" sheet) instead of the popover width; the heading is then provided by the sheet. */
export function FilterBuilder({ fluid }: { fluid?: boolean } = {}) {
  const ctx = useDb(); const f: FilterGroup = ctx.view.config.filter ?? { and: [] };
  const setF = (g: FilterGroup) => ctx.patchView({ filter: (g.and ?? g.or ?? []).length ? g : null });
  const active = describeFilter(f) > 0;
  return (
    <div className={fluid ? "w-full min-w-0" : "w-[min(92vw,30rem)]"}>
      {(!fluid || active) && (
        <div className="mb-1 flex items-center justify-between text-[12px] font-medium text-fg-muted">
          {fluid ? <span className="sr-only">Filters</span> : "Filters"}
          {active && <button type="button" onClick={() => setF({ and: [] })} className="ml-auto rounded-md text-fg-faint hover:text-danger max-md:h-11 max-md:px-3 max-md:text-[14px] max-md:text-danger">Clear all</button>}
        </div>
      )}
      {fluid && !active && <p className="mb-1 text-[13px] leading-5 text-fg-muted">No filter: every row of the database is shown.</p>}
      <Group g={f} onChange={setF} depth={0} />
    </div>
  );
}
function Group({ g, onChange, depth, onRemove }: { g: FilterGroup; onChange: (g: FilterGroup) => void; depth: number; onRemove?: () => void }) {
  const ctx = useDb(); const mode: "and" | "or" = g.or ? "or" : "and"; const items = (g.or ?? g.and ?? []) as FilterNode[];
  const setItems = (n: FilterNode[]) => onChange({ [mode]: n } as FilterGroup);
  const first = ctx.props[0];
  return (
    <div className={cn("space-y-1.5", depth > 0 && "rounded-md border border-line bg-bg-sunk/50 p-2")}>
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-1.5 max-md:flex-col max-md:gap-1 max-md:rounded-lg max-md:border max-md:border-line max-md:p-2">
          <div className="w-14 shrink-0 pt-1.5 text-[12px] text-fg-muted max-md:w-auto max-md:pt-0 max-md:text-[13px]">{i === 0 ? "Where" : i === 1 ? <Sel aria-label="Combine filters with" value={mode} onChange={(e) => onChange({ [e.target.value]: items } as FilterGroup)} className="h-7 w-14 px-1 text-[12px] max-md:w-24 max-md:px-2"><option value="and">and</option><option value="or">or</option></Sel> : mode}</div>
          {isGroup(it) ? <div className="min-w-0 flex-1"><Group g={it} depth={depth + 1} onChange={(ng) => setItems(items.map((x, j) => (j === i ? ng : x)))} onRemove={() => setItems(items.filter((_, j) => j !== i))} /></div> : <Rule r={it} onChange={(nr) => setItems(items.map((x, j) => (j === i ? nr : x)))} onRemove={() => setItems(items.filter((_, j) => j !== i))} />}
        </div>))}
      <div className="flex flex-wrap items-center gap-2 pl-14 text-[12px] max-md:pl-0">
        <button type="button" onClick={() => first && setItems([...items, { property: first.id, op: kind(first) === "checkbox" ? "eq" : OPS[kind(first)][0][0], value: kind(first) === "checkbox" ? true : "" }])} className={cn(actionCls, "max-md:border max-md:border-line")}><Plus className="size-3.5" /> Add filter</button>
        {depth === 0 && <button type="button" onClick={() => setItems([...items, { and: [] }])} className={cn(actionCls, "max-md:border max-md:border-line")}><Plus className="size-3.5" /> Add group</button>}
        {onRemove && <button type="button" onClick={onRemove} className={cn(actionCls, "ml-auto text-fg-faint hover:bg-transparent hover:text-danger")}><X className="size-3.5" /> Remove group</button>}
      </div>
    </div>
  );
}
function Rule({ r, onChange, onRemove }: { r: FilterRule; onChange: (r: FilterRule) => void; onRemove: () => void }) {
  const ctx = useDb(); const p = ctx.props.find((x) => x.id === r.property); const k = kind(p); const ops = OPS[k]; const noValue = r.op === "empty" || r.op === "not_empty";
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 max-md:w-full max-md:gap-1.5">
      <Sel aria-label="Property to filter" value={r.property} onChange={(e) => { const np = ctx.props.find((x) => x.id === e.target.value); const nk = kind(np); onChange({ property: e.target.value, op: OPS[nk][0][0], value: nk === "checkbox" ? true : "" }); }} className="h-7 max-w-[9rem] text-[12px] max-md:min-w-0 max-md:max-w-none max-md:flex-1">{ctx.props.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Sel>
      <Sel aria-label="Condition" value={r.op} onChange={(e) => onChange({ ...r, op: e.target.value as FilterOp })} className="h-7 text-[12px] max-md:min-w-0 max-md:flex-1">{ops.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel>
      {!noValue && (k === "checkbox" ? <Sel aria-label="Value" value={String(r.value === true || r.value === "true")} onChange={(e) => onChange({ ...r, value: e.target.value === "true" })} className="h-7 text-[12px] max-md:min-w-0 max-md:flex-1"><option value="true">checked</option><option value="false">unchecked</option></Sel>
        : k === "select" || (k === "multi" && p?.type === "multi_select") ? <Sel aria-label="Value" value={String(r.value ?? "")} onChange={(e) => onChange({ ...r, value: e.target.value })} className="h-7 max-w-[9rem] text-[12px] max-md:min-w-0 max-md:max-w-none max-md:flex-1"><option value="">—</option>{(p?.config.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Sel>
        : k === "date" ? <span className="flex items-center gap-1 max-md:min-w-0 max-md:flex-1"><input type="date" aria-label="Date" value={r.value === "today" ? "" : String(r.value ?? "")} onChange={(e) => onChange({ ...r, value: e.target.value })} className={cn(inputCls, "h-7 w-36 text-[12px] max-md:min-w-0 max-md:flex-1")} /><button type="button" aria-pressed={r.value === "today"} onClick={() => onChange({ ...r, value: "today" })} className={cn("h-7 rounded-md border border-line px-1.5 text-[11px] max-md:h-11 max-md:px-3 max-md:text-[14px]", r.value === "today" && "bg-accent-soft text-accent")}>today</button></span>
        : <input value={String(r.value ?? "")} onChange={(e) => onChange({ ...r, value: k === "number" ? e.target.value : e.target.value })} placeholder="value" aria-label="Value" className={cn(inputCls, "h-7 w-32 text-[12px] max-md:min-w-0 max-md:flex-1")} inputMode={k === "number" ? "decimal" : undefined} />)}
      <button type="button" aria-label={`Remove filter on ${p?.name ?? "property"}`} onClick={onRemove} className={removeCls}><X className="size-3.5 max-md:size-5" /></button>
    </div>
  );
}
export function SortBuilder({ fluid }: { fluid?: boolean } = {}) {
  const ctx = useDb(); const sorts = ctx.view.config.sorts ?? []; const set = (s: Sort[]) => ctx.patchView({ sorts: s });
  const avail = ctx.props.filter((p) => !sorts.some((s) => s.property === p.id));
  return (
    <div className={cn("space-y-1.5", fluid ? "w-full min-w-0" : "w-72")}>
      {!fluid && <div className="text-[12px] font-medium text-fg-muted">Sort</div>}
      {fluid && !sorts.length && <p className="text-[13px] leading-5 text-fg-muted">No sort: rows keep their manual order.</p>}
      {sorts.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          <Sel aria-label={`Sort ${i + 1}: property`} value={s.property} onChange={(e) => set(sorts.map((x, j) => (j === i ? { ...x, property: e.target.value } : x)))} className="h-7 min-w-0 flex-1 text-[12px]">{ctx.props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
          <Sel aria-label={`Sort ${i + 1}: direction`} value={s.dir} onChange={(e) => set(sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as any } : x)))} className="h-7 text-[12px] max-md:min-w-0 max-md:shrink"><option value="asc">Ascending</option><option value="desc">Descending</option></Sel>
          <button type="button" aria-label={`Remove sort ${i + 1}`} onClick={() => set(sorts.filter((_, j) => j !== i))} className={removeCls}><X className="size-3.5 max-md:size-5" /></button>
        </div>
      ))}
      {avail.length > 0 && <button type="button" onClick={() => set([...sorts, { property: avail[0].id, dir: "asc" }])} className={cn(actionCls, "text-[12px] max-md:border max-md:border-line")}><Plus className="size-3.5" /> Add sort</button>}
      {sorts.length === 0 && avail.length === 0 && <div className="text-[12px] text-fg-faint">No properties.</div>}
    </div>
  );
}
