"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as DialogP from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { X, Maximize2, Trash2, ArrowRightLeft, Check } from "lucide-react";
import { Dialog, SheetContent, Skeleton, Spinner } from "@/components/ui/primitives";
import { Editor } from "@/components/editor/Editor";
import { api } from "@/lib/client/api";
import { cn, debounce } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import type { Property, RowOut } from "@/lib/databases/types";
import { useDb } from "./hooks";
import { Cell } from "./cells/Cell";
import { TypeIcon } from "./meta";
import { groupRows } from "./group";
import { OPTION_CLASS } from "./colors";
import { ResponsivePanel } from "./Responsive";

/**
 * Details of a row: title, every property, relations, files and the row page body.
 * Desktop: side peek. Phone: bottom sheet with touch-sized controls (see cells/ValueEditor).
 */
export function RowPeek({ rowId, onClose }: { rowId: string | null; onClose: () => void }) {
  const ctx = useDb();
  const row = ctx.rows.find((r) => r.id === rowId);
  const open = !!rowId;

  // The row left the loaded set (deleted, filtered out after an edit…): do not leave an endless spinner behind.
  const gone = open && !row && !ctx.loading && !ctx.fetching;

  if (ctx.isMobile) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent title={row ? (row.title || "Untitled") : "Row"} description={`Row of ${ctx.db.name || "this database"}`} onOpenAutoFocus={(e) => e.preventDefault()}>
          {row ? <RowBody row={row} onClose={onClose} touch /> : gone ? <RowGone onClose={onClose} /> : <RowSkeleton />}
        </SheetContent>
      </Dialog>
    );
  }
  return (
    <DialogP.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" />
        <DialogP.Content className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-bg shadow-pop outline-none sm:w-[min(100vw,38rem)]" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogP.Title className="sr-only">{row ? (row.title || "Untitled") : "Row"}</DialogP.Title>
          <DialogP.Description className="sr-only">Row details</DialogP.Description>
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
            <DialogP.Close aria-label="Close" className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk"><X className="size-4" /></DialogP.Close>
            {row && <RowActions row={row} onClose={onClose} />}
          </div>
          {row
            ? <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-7"><RowBody row={row} onClose={onClose} /></div>
            : gone ? <RowGone onClose={onClose} /> : <div className="grid flex-1 place-items-center" role="status" aria-label="Loading row"><Spinner /></div>}
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}

function RowSkeleton() {
  return <div role="status" aria-label="Loading row" className="space-y-3 py-2"><Skeleton className="h-11" /><Skeleton className="h-11" /><Skeleton className="h-11" /><Skeleton className="h-24" /></div>;
}
function RowGone({ onClose }: { onClose: () => void }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-[14px] font-semibold">This row is no longer in this view</p>
      <p className="mt-1 text-[13px] leading-5 text-fg-muted">It was deleted, or it no longer matches the filters or the search.</p>
      <button type="button" onClick={onClose} className="mt-4 h-11 rounded-lg border border-line px-4 text-[14px] font-medium hover:bg-bg-sunk">Close</button>
    </div>
  );
}

/** Open as page · Move to… · Delete. */
function RowActions({ row, onClose, touch }: { row: RowOut; onClose: () => void; touch?: boolean }) {
  const ctx = useDb();
  const btn = cn("flex shrink-0 items-center gap-1.5 rounded-md text-fg-muted hover:bg-bg-sunk hover:text-fg", touch ? "h-11 rounded-lg border border-line px-3 text-[14px]" : "h-8 px-2 text-[12px]");
  const remove = async () => {
    if (!confirm(`Move “${row.title || "Untitled"}” to the trash? You can undo this right after, or restore it later from the trash.`)) return;
    onClose();
    await ctx.removeRows([row.id]);
  };
  return (
    <>
      <Link href={`/p/${row.pageId}`} className={btn}><Maximize2 className="size-3.5" /> Open as page</Link>
      <MoveTo row={row} className={btn} />
      <button type="button" onClick={remove} className={cn(btn, "ml-auto hover:text-danger", touch && "text-danger")}><Trash2 className="size-3.5" /> Delete</button>
    </>
  );
}

/**
 * "Move to…": changes the value of the property the view is grouped by (the board column) from a plain list —
 * the non-drag way to move a card, usable with a finger, a keyboard or a screen reader.
 */
export function MoveTo({ row, className }: { row: RowOut; className?: string }) {
  const ctx = useDb();
  const [open, setOpen] = useState(false);
  const gb: Property | undefined = ctx.props.find((p) => p.id === ctx.view.config.groupBy);
  const groups = useMemo(() => (gb ? groupRows([], gb) : []), [gb]);
  if (!gb) return null;
  const currentValue = row.values[gb.id] ?? (gb.type === "checkbox" ? false : null);
  const isCurrent = (v: unknown) => (gb.type === "checkbox" ? !!currentValue === !!v : (currentValue ?? null) === (v ?? null));

  const move = (value: unknown, label: string) => {
    setOpen(false);
    if (isCurrent(value)) return;
    const previous = row.values[gb.id] ?? null;
    ctx.setCell(row.id, { [gb.id]: value ?? null });
    toast(`Moved to ${label}`, { action: { label: "Undo", run: () => ctx.setCell(row.id, { [gb.id]: previous }) } });
  };

  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      title="Move to…"
      description={`Sets “${gb.name}” for this row.`}
      className="w-60 p-1.5"
      trigger={<button type="button" aria-haspopup="dialog" className={className}><ArrowRightLeft className="size-3.5" /> Move to…</button>}
    >
      <div className="mb-1 px-2 text-[12px] font-medium text-fg-muted max-md:hidden">Move to… ({gb.name})</div>
      <ul className="space-y-0.5">
        {groups.map((g) => {
          const current = isCurrent(g.value);
          return (
            <li key={g.key}>
              <button type="button" aria-pressed={current} onClick={() => move(g.value, g.label)} className={cn("flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-bg-sunk max-md:h-12 max-md:px-3", current && "bg-bg-sunk")}>
                <span className={cn("truncate rounded-md px-1.5 py-0.5 text-[12px] font-medium max-md:px-2 max-md:py-1 max-md:text-[14px]", OPTION_CLASS[g.color])}>{g.label}</span>
                {current && <span className="ml-auto flex shrink-0 items-center gap-1 text-[12px] text-fg-muted"><Check className="size-4 text-accent" /> Current</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </ResponsivePanel>
  );
}

function RowBody({ row, onClose, touch }: { row: RowOut; onClose: () => void; touch?: boolean }) {
  const ctx = useDb();
  const tp = ctx.props.find((p) => p.type === "title");
  const pageQ = useQuery<any>({ queryKey: ["page", row.pageId], queryFn: () => api(`/api/pages/${row.pageId}`) });
  const page = pageQ.data;
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState(row.title === "Untitled" ? "" : row.title);

  // Debounced saves receive their target explicitly: a closure over `row` would keep pointing at the first render.
  const setCell = useRef(ctx.setCell);
  setCell.current = ctx.setCell;
  const saveTitle = useRef(debounce((rowId: string, propId: string, v: string) => setCell.current(rowId, { [propId]: v }), 500)).current;
  const saveBody = useRef(debounce(async (pageId: string, content: unknown) => {
    try { await api(`/api/pages/${pageId}`, { method: "PATCH", json: { content } }); }
    catch (e: any) { toast("Notes not saved", { description: e?.message ?? "Check your connection; keep this panel open and edit again to retry.", tone: "danger" }); }
  }, 800)).current;
  useEffect(() => { setTitle(row.title === "Untitled" ? "" : row.title); setEditing(null); }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = ctx.props.filter((p) => p.type !== "title");
  return (
    <div className={cn(touch && "pb-2")}>
      {touch && <label htmlFor="row-title" className="mb-1 block text-[13px] font-medium text-fg-muted">Title</label>}
      <textarea
        id="row-title"
        aria-label="Title"
        value={title}
        onChange={(e) => { setTitle(e.target.value); if (tp) saveTitle(row.id, tp.id, e.target.value); }}
        placeholder="Untitled"
        rows={1}
        className={cn("w-full resize-none outline-none placeholder:text-fg-faint", touch ? "min-h-11 rounded-lg border border-line bg-bg-elev px-3 py-2.5 text-[17px] font-semibold leading-6 focus:border-accent/60" : "bg-transparent text-2xl font-semibold tracking-tight")}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
      />
      {touch && <div className="mt-3 flex flex-wrap items-center gap-2"><RowActions row={row} onClose={onClose} touch /></div>}

      {touch ? (
        <div className="mt-4 space-y-4">
          {fields.map((p) => (
            <div key={p.id} className="min-w-0">
              <div id={`prop-label-${p.id}`} className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-fg-muted"><TypeIcon type={p.type} /><span className="truncate">{p.name}</span></div>
              <div className="min-w-0"><Cell p={p} row={row} mode="form" editing={editing === p.id} onEdit={(o) => setEditing(o ? p.id : null)} /></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 divide-y divide-line border-y border-line">
          {fields.map((p) => (
            <div key={p.id} className="grid grid-cols-[7.5rem_1fr] items-start gap-2 py-0.5 sm:grid-cols-[9rem_1fr]">
              <div id={`prop-label-${p.id}`} className="flex h-10 items-center gap-1.5 truncate text-[12px] text-fg-muted"><TypeIcon type={p.type} /><span className="truncate">{p.name}</span></div>
              <div className="min-w-0"><Cell p={p} row={row} mode="form" editing={editing === p.id} onEdit={(o) => setEditing(o ? p.id : null)} /></div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 min-w-0">
        {touch && <div className="mb-1 text-[13px] font-medium text-fg-muted">Notes</div>}
        {page ? (
          <Editor key={page.id} content={page.content} pageId={page.id} editable placeholder="Notes for this row…" onChange={(doc) => saveBody(page.id, doc)} />
        ) : pageQ.isError ? (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1">The notes of this row could not be loaded.</span>
            <button type="button" onClick={() => pageQ.refetch()} className="h-8 shrink-0 rounded-md px-2 font-medium underline-offset-2 hover:underline max-md:h-11 max-md:px-3">Retry</button>
          </div>
        ) : (
          <div role="status" aria-label="Loading notes" className="space-y-2"><Skeleton /><Skeleton className="w-2/3" /></div>
        )}
      </div>
    </div>
  );
}
