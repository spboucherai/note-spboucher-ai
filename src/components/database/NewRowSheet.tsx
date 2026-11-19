"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useOnline } from "@/lib/client/hooks";
import { READONLY_TYPES, type Property } from "@/lib/databases/types";
import { isEmpty } from "@/lib/databases/values";
import { useDb } from "./hooks";
import { TypeIcon } from "./meta";
import { ValueEditor } from "./cells/ValueEditor";

interface Draft { title: string; values: Record<string, unknown> }
const EMPTY: Draft = { title: "", values: {} };
/** localStorage key of the unsaved quick-create form, one per database. */
export const newRowDraftKey = (dbId: string) => `db-new-draft-${dbId}`;

function readDraft(dbId: string): Draft | null {
  try {
    const raw = localStorage.getItem(newRowDraftKey(dbId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object") return null;
    return { title: typeof d.title === "string" ? d.title : "", values: d.values && typeof d.values === "object" ? d.values : {} };
  } catch { return null; }
}
function writeDraft(dbId: string, d: Draft | null) {
  try {
    if (!d || (!d.title && !Object.keys(d.values).length)) localStorage.removeItem(newRowDraftKey(dbId));
    else localStorage.setItem(newRowDraftKey(dbId), JSON.stringify(d));
  } catch { /* storage full or disabled: the draft still lives in memory while the sheet is mounted */ }
}

/**
 * Quick row creation (phones): title + the view's priority properties in a bottom sheet.
 * The draft is written to localStorage on every change and survives closing the sheet, a failed save, a reload or
 * losing the connection; it is only removed once the row is created or when "Discard draft" is pressed.
 */
export function NewRowSheet({ open, preset, onClose }: { open: boolean; preset: Record<string, unknown>; onClose: () => void }) {
  const ctx = useDb();
  const online = useOnline();
  const dbId = ctx.db.id;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Opening: bring back the saved draft; the preset of the pressed "New" button (board column, calendar day…) is applied on top.
  useEffect(() => {
    if (!open) return;
    const saved = readDraft(dbId);
    setRestored(!!saved && (!!saved.title || Object.keys(saved.values).length > 0));
    setDraft({ title: saved?.title ?? "", values: { ...(saved?.values ?? {}), ...preset } });
    setError(null);
  }, [open, dbId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: Draft) => { setDraft(next); writeDraft(dbId, next); };
  const setValue = (id: string, v: unknown) => {
    const values = { ...draft.values };
    if (isEmpty(v) && v !== false) delete values[id]; else values[id] = v;
    update({ ...draft, values });
  };

  // Priority properties, plus any property the preset touches (so the pre-chosen column/date is visible and editable).
  const fields: Property[] = useMemo(() => {
    const editable = (p: Property) => p.type !== "title" && p.type !== "file" && !READONLY_TYPES.has(p.type);
    const ids = new Set([...ctx.priorityProps.map((p) => p.id), ...Object.keys(preset)]);
    return ctx.props.filter((p) => ids.has(p.id) && editable(p));
  }, [ctx.props, ctx.priorityProps, preset]);

  const dirty = !!draft.title || Object.keys(draft.values).length > 0;
  const discard = () => { writeDraft(dbId, null); setDraft(EMPTY); setRestored(false); setError(null); titleRef.current?.focus(); };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const row = await ctx.addRow(draft.values, draft.title.trim(), { open: false });
      writeDraft(dbId, null);
      setDraft(EMPTY);
      onClose();
      toast("Row created", { tone: "success", action: { label: "Open", run: () => ctx.open(row.id) } });
    } catch (e: any) {
      // Nothing is lost: the draft stays in the form and on the device.
      setError(e?.message ? `${e.message} — your draft is kept, try again.` : "The row was not created. Your draft is kept, try again.");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        title="New row"
        description={`In ${ctx.db.name || "this database"}. Your draft is kept on this device until you save or discard it.`}
        onOpenAutoFocus={(e) => { e.preventDefault(); titleRef.current?.focus(); }}
      >
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4 pb-1">
          {restored && <p role="status" className="rounded-lg bg-bg-sunk px-3 py-2 text-[13px] leading-5 text-fg-muted">Draft restored from your last visit.</p>}
          <div>
            <label htmlFor="new-row-title" className="mb-1 block text-[13px] font-medium text-fg-muted">Title</label>
            <input
              id="new-row-title"
              ref={titleRef}
              value={draft.title}
              onChange={(e) => update({ ...draft, title: e.target.value })}
              placeholder="Untitled"
              enterKeyHint="done"
              autoComplete="off"
              className="h-11 w-full rounded-lg border border-line bg-bg-elev px-3 text-[16px] font-medium outline-none placeholder:font-normal placeholder:text-fg-faint focus:border-accent/60"
            />
          </div>
          {fields.map((p) => (
            <div key={p.id}>
              <div id={`new-row-label-${p.id}`} className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-fg-muted"><TypeIcon type={p.type} />{p.name}</div>
              <ValueEditor p={p} value={draft.values[p.id]} onChange={(v) => setValue(p.id, v)} commit="change" addOption={(n) => ctx.addOption(p.id, n)} labelId={`new-row-label-${p.id}`} />
            </div>
          ))}
          {ctx.props.length - 1 > fields.length && <p className="text-[12px] leading-5 text-fg-faint">The other properties, files and notes can be filled in after creation (open the row).</p>}
          {!online && <p role="status" className="rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-[13px] leading-5">You are offline. The draft is saved on this device; create the row when the connection is back.</p>}
          {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] leading-5 text-danger-text">{error}</p>}
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" className="h-11 px-3 text-[15px] text-danger-text hover:text-danger-text" disabled={!dirty || saving} onClick={discard}>Discard draft</Button>
            <Button type="submit" className="ml-auto h-11 min-w-28 px-5 text-[15px]" disabled={saving}>{saving ? <Spinner className="border-t-white" /> : null}{saving ? "Creating…" : "Create row"}</Button>
          </div>
        </form>
      </SheetContent>
    </Dialog>
  );
}
