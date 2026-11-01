"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as DialogP from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { X, Maximize2, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/primitives";
import { Editor } from "@/components/editor/Editor";
import { api } from "@/lib/client/api";
import { debounce } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { useDb } from "./hooks";
import { Cell } from "./cells/Cell";
import { TypeIcon } from "./meta";

/** Side peek of a row: title, all properties, and the row page body. */
export function RowPeek({ rowId, onClose }: { rowId: string | null; onClose: () => void }) {
  const ctx = useDb(); const row = ctx.rows.find((r) => r.id === rowId); const tp = ctx.props.find((p) => p.type === "title");
  const { data: page } = useQuery<any>({ queryKey: ["page", row?.pageId], enabled: !!row, queryFn: () => api(`/api/pages/${row!.pageId}`) });
  const [editing, setEditing] = useState<string | null>(null); const [title, setTitle] = useState(""); const saveTitle = useRef(debounce((v: string) => { if (row && tp) ctx.setCell(row.id, { [tp.id]: v }); }, 500)).current;
  const saveBody = useRef(debounce(async (pageId: string, content: unknown) => { try { await api(`/api/pages/${pageId}`, { method: "PATCH", json: { content } }); } catch (e: any) { toast("Save failed", { description: e?.message, tone: "danger" }); } }, 800)).current;
  useEffect(() => { if (row) setTitle(row.title === "Untitled" ? "" : row.title); }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <DialogP.Root open={!!rowId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" />
        <DialogP.Content className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-bg shadow-pop outline-none sm:w-[min(100vw,38rem)]" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogP.Title className="sr-only">Row</DialogP.Title><DialogP.Description className="sr-only">Row details</DialogP.Description>
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
            <DialogP.Close className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk"><X className="size-4" /></DialogP.Close>
            {row && <Link href={`/p/${row.pageId}`} className="flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-fg-muted hover:bg-bg-sunk hover:text-fg"><Maximize2 className="size-3.5" /> Open as page</Link>}
            {row && <button type="button" onClick={async () => { if (!confirm("Delete this row?")) return; await ctx.removeRows([row.id]); onClose(); }} className="ml-auto flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-fg-muted hover:bg-bg-sunk hover:text-danger"><Trash2 className="size-3.5" /> Delete</button>}
          </div>
          {!row ? <div className="grid flex-1 place-items-center"><Spinner /></div> : (
            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-7">
              <textarea value={title} onChange={(e) => { setTitle(e.target.value); saveTitle(e.target.value); }} placeholder="Untitled" rows={1} className="w-full resize-none bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-fg-faint" onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
              <div className="mt-3 divide-y divide-line border-y border-line">
                {ctx.props.filter((p) => p.type !== "title").map((p) => (
                  <div key={p.id} className="grid grid-cols-[7.5rem_1fr] items-start gap-2 py-0.5 sm:grid-cols-[9rem_1fr]">
                    <div className="flex h-10 items-center gap-1.5 truncate text-[12px] text-fg-muted"><TypeIcon type={p.type} /><span className="truncate">{p.name}</span></div>
                    <div className="min-w-0"><Cell p={p} row={row} mode="form" editing={editing === p.id} onEdit={(o) => setEditing(o ? p.id : null)} /></div>
                  </div>))}
              </div>
              <div className="mt-4">{page ? <Editor key={page.id} content={page.content} pageId={page.id} editable placeholder="Notes for this row…" onChange={(doc) => saveBody(page.id, doc)} /> : <Spinner />}</div>
            </div>)}
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}
