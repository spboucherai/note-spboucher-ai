"use client";
/**
 * Touch-first editors for one property value, used wherever a row is edited on a phone (row sheet, quick-create sheet).
 * Every control is at least 44 px tall and always visible (no tap-to-reveal): selects and relations open a sheet with
 * large rows, dates use the native picker, checkboxes are a full-width switch row.
 */
import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { Switch } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Property, RelationRef, FileRef, SelectOption } from "@/lib/databases/types";
import { numberOf, optionOf } from "@/lib/databases/values";
import { OptionChip, SelectPopover } from "./SelectCell";
import { RelationPopover } from "./RelationCell";
import { FilePopover } from "./FileCell";

const fieldCls = "w-full rounded-lg border border-line bg-bg-elev px-3 text-[16px] outline-none placeholder:text-fg-faint focus:border-accent/60";
const pickerCls = "flex min-h-11 w-full items-center gap-2 rounded-lg border border-line bg-bg-elev px-3 py-1.5 text-left text-[15px] active:bg-bg-sunk";

/** ISO value → value of a native date / datetime-local input (local time). */
export function toDateInput(v: unknown, time: boolean): string {
  if (typeof v !== "string" || !v) return "";
  if (!time) return v.slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}
/** Native input value → stored value (date: YYYY-MM-DD, date+time: ISO string, empty: null). */
export function fromDateInput(v: string, time: boolean): string | null {
  if (!v) return null;
  if (!time) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface ValueEditorProps {
  p: Property;
  value: unknown;
  onChange: (v: unknown) => void;
  /** "blur": text is sent when the field loses focus (saved rows). "change": every keystroke (local drafts). */
  commit?: "blur" | "change";
  /** Page that owns uploaded files; without it the file picker is not offered. */
  pageId?: string;
  addOption: (name: string) => Promise<SelectOption>;
  /** id of the visible label, for aria-labelledby. */
  labelId?: string;
}

export function ValueEditor({ p, value, onChange, commit = "blur", pageId, addOption, labelId }: ValueEditorProps) {
  const [open, setOpen] = useState(false);

  switch (p.type) {
    case "checkbox":
      return (
        <label className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-bg-elev px-3">
          <span className="text-[15px] text-fg-muted">{value ? "Yes" : "No"}</span>
          <Switch checked={!!value} onCheckedChange={(v) => onChange(v)} aria-labelledby={labelId} />
        </label>
      );

    case "date": {
      const time = !!p.config.includeTime;
      return (
        <div className="flex items-center gap-1">
          <input
            type={time ? "datetime-local" : "date"}
            aria-labelledby={labelId}
            value={toDateInput(value, time)}
            onChange={(e) => onChange(fromDateInput(e.target.value, time))}
            className={cn(fieldCls, "h-11 min-w-0 flex-1")}
          />
          {!!value && (
            <button type="button" aria-label={`Clear ${p.name}`} onClick={() => onChange(null)} className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-muted active:bg-bg-sunk">
              <X className="size-5" />
            </button>
          )}
        </div>
      );
    }

    case "select":
    case "status":
    case "multi_select": {
      const multi = p.type === "multi_select";
      const ids = multi ? (Array.isArray(value) ? (value as unknown[]) : []) : value ? [value] : [];
      return (
        <SelectPopover p={p} value={value} multi={multi} onChange={onChange} addOption={addOption} open={open} onOpenChange={setOpen}>
          <button type="button" aria-labelledby={labelId} aria-haspopup="dialog" className={pickerCls}>
            <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {ids.length
                ? ids.map((id) => <OptionChip key={String(id)} opt={optionOf(p, id) ?? { name: String(id), color: "gray" }} className="px-2 py-1 text-[14px] leading-5" />)
                : <span className="text-fg-faint">Choose…</span>}
            </span>
            <ChevronRight className="size-4 shrink-0 text-fg-faint" />
          </button>
        </SelectPopover>
      );
    }

    case "relation": {
      const refs = (Array.isArray(value) ? value : []) as RelationRef[];
      return (
        <RelationPopover p={p} value={value} onChange={onChange} open={open} onOpenChange={setOpen}>
          <button type="button" aria-labelledby={labelId} aria-haspopup="dialog" className={pickerCls}>
            <span className="min-w-0 flex-1 truncate">
              {refs.length ? refs.map((r) => `${r.icon ? `${r.icon} ` : ""}${r.title || "Untitled"}`).join(", ") : <span className="text-fg-faint">Link rows…</span>}
            </span>
            {refs.length > 0 && <span className="shrink-0 text-[13px] tabular-nums text-fg-muted">{refs.length}</span>}
            <ChevronRight className="size-4 shrink-0 text-fg-faint" />
          </button>
        </RelationPopover>
      );
    }

    case "file": {
      const files = (Array.isArray(value) ? value : []) as FileRef[];
      if (!pageId) return <p className="py-2 text-[13px] text-fg-muted">Files can be attached once the row exists.</p>;
      return (
        <FilePopover value={value} pageId={pageId} onChange={onChange} open={open} onOpenChange={setOpen}>
          <button type="button" aria-labelledby={labelId} aria-haspopup="dialog" className={pickerCls}>
            <span className="min-w-0 flex-1 truncate">
              {files.length ? files.map((f) => f.name).join(", ") : <span className="text-fg-faint">Attach or view files…</span>}
            </span>
            {files.length > 0 && <span className="shrink-0 text-[13px] tabular-nums text-fg-muted">{files.length}</span>}
            <ChevronRight className="size-4 shrink-0 text-fg-faint" />
          </button>
        </FilePopover>
      );
    }

    default:
      return <TextField p={p} value={value} onChange={onChange} commit={commit} labelId={labelId} />;
  }
}

/** Text / number / URL / title. Keeps what is typed locally and never overwrites it while the field has focus. */
function TextField({ p, value, onChange, commit, labelId }: { p: Property; value: unknown; onChange: (v: unknown) => void; commit: "blur" | "change"; labelId?: string }) {
  const external = value == null ? "" : String(value);
  const [draft, setDraft] = useState(external);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(external); }, [external, focused]);

  const parse = (s: string): unknown => (p.type === "number" ? (s.trim() === "" ? null : numberOf(s)) : s);
  const invalidNumber = p.type === "number" && draft.trim() !== "" && numberOf(draft) === null;
  const send = (s: string) => {
    if (p.type === "number" && s.trim() !== "" && numberOf(s) === null) return; // keep the draft visible, flagged below
    const next = parse(s);
    if (next !== (value ?? (p.type === "number" ? null : ""))) onChange(next);
  };

  const common = {
    value: draft,
    "aria-labelledby": labelId,
    "aria-invalid": invalidNumber || undefined,
    onFocus: () => setFocused(true),
    onBlur: () => { setFocused(false); if (commit === "blur") send(draft); },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setDraft(e.target.value); if (commit === "change") send(e.target.value); },
  };
  return (
    <div>
      {p.type === "text"
        ? <textarea rows={2} {...common} className={cn(fieldCls, "min-h-11 py-2.5 leading-6")} />
        : <input
            {...common}
            type={p.type === "url" ? "url" : "text"}
            inputMode={p.type === "number" ? "decimal" : p.type === "url" ? "url" : undefined}
            autoCapitalize={p.type === "url" ? "none" : undefined}
            enterKeyHint="done"
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className={cn(fieldCls, "h-11", invalidNumber && "border-danger")}
          />}
      {invalidNumber && <p role="alert" className="mt-1 text-[12px] text-danger-text">Enter a number — this value has not been saved.</p>}
    </div>
  );
}
