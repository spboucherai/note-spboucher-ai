"use client";
/**
 * File: src/components/database/FilterBuilder.tsx
 * Description: the visual filter builder of a view (saved with the view) and the sort builder. 3.0: AND / OR groups nested up to three
 *   levels; the builder edits a local draft and saves it 400 ms after the last change (audit U4: it used to send one PATCH and one row
 *   reload per keystroke, with a roll-back race); a rule is only saved when it is complete and valid (D10) — an incomplete rule is
 *   marked and kept out of the saved filter; relation rules pick their value by title; relative dates ("today").
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterGroup, FilterNode, FilterRule, FilterOp, Sort } from "@/lib/databases/types";
import { isGroup } from "@/lib/databases/types";
import { OPS, kind, NO_VALUE, describeFilter, MAX_DEPTH, ruleProblem, validFilter } from "./filter-logic";
import { useDb } from "./hooks";
import { Sel, inputCls } from "./meta";

export { describeFilter, MAX_DEPTH, ruleProblem, validFilter };

/** Shared touch sizing: 44 px targets below `md`, the dense desktop size above. */
const actionCls = "flex h-7 items-center gap-1 rounded-md px-1.5 text-fg-muted hover:bg-bg-sunk hover:text-fg max-md:h-11 max-md:px-3 max-md:text-[14px]";
const removeCls = "grid size-7 shrink-0 place-items-center rounded text-fg-faint hover:bg-bg-sunk hover:text-danger-text max-md:size-11 max-md:rounded-lg";

/** `fluid`: take the width of the container (phone "View options" sheet) instead of the popover width; the heading is then provided by the sheet. */
export function FilterBuilder({ fluid }: { fluid?: boolean } = {}) {
  const ctx = useDb(); const saved: FilterGroup = ctx.view.config.filter ?? { and: [] };
  // local draft; `sent` remembers what this builder saved last so that our own echo does not reset the draft while the user types
  const [draft, setDraft] = useState<FilterGroup>(saved); const sent = useRef(JSON.stringify(validFilter(saved, ctx.props))); const timer = useRef<ReturnType<typeof setTimeout> | null>(null); const pending = useRef<FilterGroup | null>(null);
  const patch = useRef(ctx.patchView); patch.current = ctx.patchView; const propsRef = useRef(ctx.props); propsRef.current = ctx.props;
  const savedKey = JSON.stringify(ctx.view.config.filter ?? null);
  useEffect(() => { if (!pending.current && JSON.stringify(validFilter(saved, propsRef.current)) !== sent.current) { setDraft(saved); sent.current = JSON.stringify(validFilter(saved, propsRef.current)); } }, [savedKey, ctx.view.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const flush = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; const g = pending.current; pending.current = null; if (!g) return; const v = validFilter(g, propsRef.current); const key = JSON.stringify(v); if (key === sent.current) return; sent.current = key; patch.current({ filter: v }); };
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []); // closing the popover saves what is pending
  const change = (g: FilterGroup, now = false) => { setDraft(g); pending.current = g; if (timer.current) clearTimeout(timer.current); if (now) flush(); else timer.current = setTimeout(flush, 400); };
  const active = describeFilter(draft) > 0; const invalid = useMemo(() => describeFilter(draft) - describeFilter(validFilter(draft, ctx.props)), [draft, ctx.props]);
  return (
    <div className={fluid ? "w-full min-w-0" : "w-[min(92vw,34rem)]"} data-testid="filter-builder">
      {(!fluid || active) && (
        <div className="mb-1 flex items-center justify-between text-[12px] font-medium text-fg-muted">
          {fluid ? <span className="sr-only">Filters</span> : "Filters"}
          {active && <button type="button" onClick={() => change({ and: [] }, true)} className="ml-auto rounded-md text-fg-faint hover:text-danger-text max-md:h-11 max-md:px-3 max-md:text-[14px] max-md:text-danger-text">Clear all</button>}
        </div>
      )}
      {fluid && !active && <p className="mb-1 text-[13px] leading-5 text-fg-muted">No filter: every row of the database is shown.</p>}
      <Group g={draft} onChange={change} depth={0} />
      {invalid > 0 && <p role="status" className="mt-1.5 flex items-center gap-1 text-[12px] text-fg-muted max-md:text-[13px]"><AlertCircle className="size-3.5 shrink-0" /> {invalid} incomplete rule{invalid > 1 ? "s are" : " is"} not applied yet.</p>}
    </div>
  );
}
function Group({ g, onChange, depth, onRemove }: { g: FilterGroup; onChange: (g: FilterGroup, now?: boolean) => void; depth: number; onRemove?: () => void }) {
  const ctx = useDb(); const mode: "and" | "or" = g.or ? "or" : "and"; const items = (g.or ?? g.and ?? []) as FilterNode[];
  const setItems = (n: FilterNode[], now = false) => onChange({ [mode]: n } as FilterGroup, now);
  const first = ctx.props[0];
  return (
    <div role="group" aria-label={depth === 0 ? "Filter rules" : `Group of rules combined with ${mode}`} data-depth={depth} className={cn("space-y-1.5", depth > 0 && "rounded-md border border-line bg-bg-sunk/50 p-2")}>
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-1.5 max-md:flex-col max-md:gap-1 max-md:rounded-lg max-md:border max-md:border-line max-md:p-2">
          <div className="w-14 shrink-0 pt-1.5 text-[12px] text-fg-muted max-md:w-auto max-md:pt-0 max-md:text-[13px]">{i === 0 ? "Where" : i === 1 ? <Sel aria-label="Combine filters with" value={mode} onChange={(e) => onChange({ [e.target.value]: items } as FilterGroup, true)} className="h-7 w-14 px-1 text-[12px] max-md:w-24 max-md:px-2"><option value="and">and</option><option value="or">or</option></Sel> : mode}</div>
          {isGroup(it) ? <div className="min-w-0 flex-1 max-md:w-full"><Group g={it} depth={depth + 1} onChange={(ng, now) => setItems(items.map((x, j) => (j === i ? ng : x)), now)} onRemove={() => setItems(items.filter((_, j) => j !== i), true)} /></div> : <Rule r={it} onChange={(nr, now) => setItems(items.map((x, j) => (j === i ? nr : x)), now)} onRemove={() => setItems(items.filter((_, j) => j !== i), true)} />}
        </div>))}
      <div className="flex flex-wrap items-center gap-2 pl-14 text-[12px] max-md:pl-0">
        <button type="button" onClick={() => first && setItems([...items, { property: first.id, op: kind(first) === "checkbox" ? "eq" : OPS[kind(first)][0][0], value: kind(first) === "checkbox" ? true : "" }])} className={cn(actionCls, "max-md:border max-md:border-line")}><Plus className="size-3.5" /> Add filter</button>
        {depth < MAX_DEPTH && <button type="button" onClick={() => setItems([...items, (mode === "and" ? { or: [] } : { and: [] }) as FilterGroup])} className={cn(actionCls, "max-md:border max-md:border-line")}><Plus className="size-3.5" /> Add group</button>}
        {onRemove && <button type="button" onClick={onRemove} className={cn(actionCls, "ml-auto text-fg-faint hover:bg-transparent hover:text-danger-text")}><X className="size-3.5" /> Remove group</button>}
      </div>
    </div>
  );
}
function Rule({ r, onChange, onRemove }: { r: FilterRule; onChange: (r: FilterRule, now?: boolean) => void; onRemove: () => void }) {
  const ctx = useDb(); const p = ctx.props.find((x) => x.id === r.property); const k = kind(p); const ops = OPS[k]; const noValue = NO_VALUE.has(r.op); const problem = ruleProblem(r, ctx.props);
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 max-md:w-full max-md:gap-1.5" data-rule data-invalid={problem ? "true" : undefined}>
      <Sel aria-label="Property to filter" value={p ? r.property : ""} onChange={(e) => { const np = ctx.props.find((x) => x.id === e.target.value); const nk = kind(np); onChange({ property: e.target.value, op: OPS[nk][0][0], value: nk === "checkbox" ? true : "" }, true); }} className="h-7 max-w-[9rem] text-[12px] max-md:min-w-0 max-md:max-w-none max-md:flex-1">{!p && <option value="">(deleted property)</option>}{ctx.props.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Sel>
      <Sel aria-label="Condition" value={r.op} onChange={(e) => onChange({ ...r, op: e.target.value as FilterOp }, true)} className="h-7 text-[12px] max-md:min-w-0 max-md:flex-1">{ops.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel>
      {!noValue && (k === "checkbox" ? <Sel aria-label="Value" value={String(r.value === true || r.value === "true")} onChange={(e) => onChange({ ...r, value: e.target.value === "true" }, true)} className="h-7 text-[12px] max-md:min-w-0 max-md:flex-1"><option value="true">checked</option><option value="false">unchecked</option></Sel>
        : k === "select" || (k === "multi" && p?.type === "multi_select") ? <Sel aria-label="Value" value={String(r.value ?? "")} onChange={(e) => onChange({ ...r, value: e.target.value }, true)} className="h-7 max-w-[9rem] text-[12px] max-md:min-w-0 max-md:max-w-none max-md:flex-1"><option value="">—</option>{(p?.config.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Sel>
        : k === "date" ? <span className="flex items-center gap-1 max-md:min-w-0 max-md:flex-1"><input type="date" aria-label="Date" value={r.value === "today" ? "" : String(r.value ?? "")} onChange={(e) => onChange({ ...r, value: e.target.value })} className={cn(inputCls, "h-7 w-36 text-[12px] max-md:min-w-0 max-md:flex-1")} /><button type="button" aria-pressed={r.value === "today"} onClick={() => onChange({ ...r, value: r.value === "today" ? "" : "today" }, true)} className={cn("h-7 rounded-md border border-line px-1.5 text-[11px] max-md:h-11 max-md:px-3 max-md:text-[14px]", r.value === "today" && "bg-accent-soft text-accent")}>today</button></span>
        : <input value={String(r.value ?? "")} onChange={(e) => onChange({ ...r, value: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") onChange({ ...r, value: (e.target as HTMLInputElement).value }, true); }} placeholder={p?.type === "relation" ? "title contains…" : "value"} aria-label="Value" aria-invalid={!!problem} className={cn(inputCls, "h-7 w-32 text-[12px] max-md:min-w-0 max-md:flex-1", problem && r.value !== "" && r.value != null && "border-danger/60")} inputMode={k === "number" ? "decimal" : undefined} />)}
      <button type="button" aria-label={`Remove filter on ${p?.name ?? "property"}`} onClick={onRemove} className={removeCls}><X className="size-3.5 max-md:size-5" /></button>
      {problem && <span className="basis-full text-[11px] text-fg-muted max-md:text-[12px]" data-rule-problem>{problem}</span>}
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
          {/* a property already used by another sort is not offered twice */}
          <Sel aria-label={`Sort ${i + 1}: property`} value={s.property} onChange={(e) => set(sorts.map((x, j) => (j === i ? { ...x, property: e.target.value } : x)))} className="h-7 min-w-0 flex-1 text-[12px]">{ctx.props.filter((p) => p.id === s.property || !sorts.some((x) => x.property === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
          <Sel aria-label={`Sort ${i + 1}: direction`} value={s.dir} onChange={(e) => set(sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as any } : x)))} className="h-7 text-[12px] max-md:min-w-0 max-md:shrink"><option value="asc">Ascending</option><option value="desc">Descending</option></Sel>
          <button type="button" aria-label={`Remove sort ${i + 1}`} onClick={() => set(sorts.filter((_, j) => j !== i))} className={removeCls}><X className="size-3.5 max-md:size-5" /></button>
        </div>
      ))}
      {avail.length > 0 && <button type="button" onClick={() => set([...sorts, { property: avail[0].id, dir: "asc" }])} className={cn(actionCls, "text-[12px] max-md:border max-md:border-line")}><Plus className="size-3.5" /> Add sort</button>}
      {sorts.length === 0 && avail.length === 0 && <div className="text-[12px] text-fg-faint">No properties.</div>}
    </div>
  );
}
