"use client";
import { useRef, useState } from "react";
import { Paperclip, Upload, X } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { FileRef } from "@/lib/databases/types";

export const isImage = (f: FileRef) => (f.mime ? f.mime.startsWith("image/") : /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(f.name));
export function FileChip({ f, onRemove, className }: { f: FileRef; onRemove?: () => void; className?: string }) {
  return <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-bg-elev px-1.5 py-0.5 text-[12px] leading-4", className)}><Paperclip className="size-3 shrink-0 text-fg-faint" /><a href={f.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="truncate hover:text-accent">{f.name}</a>{onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="-mr-0.5 rounded p-0.5 text-fg-faint hover:text-fg"><X className="size-3" /></button>}</span>;
}
export async function uploadFiles(files: File[], pageId: string): Promise<FileRef[]> {
  const out: FileRef[] = [];
  for (const file of files) { const fd = new FormData(); fd.append("file", file); fd.append("pageId", pageId); const res = await fetch("/api/attachments", { method: "POST", body: fd, credentials: "same-origin" }); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`); const j = await res.json(); out.push({ id: j.id, url: j.url, name: j.name, mime: j.mime }); }
  return out;
}
export function FilePopover({ value, pageId, onChange, open, onOpenChange, children }: { value: unknown; pageId: string; onChange: (v: FileRef[]) => void; open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode }) {
  const files = (Array.isArray(value) ? value : []) as FileRef[]; const input = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false);
  const add = async (list: FileList | null) => { if (!list?.length) return; setBusy(true); try { onChange([...files, ...(await uploadFiles([...list], pageId))]); } catch (e: any) { toast("Upload failed", { description: e?.message, tone: "danger" }); } finally { setBusy(false); if (input.current) input.current.value = ""; } };
  return (
    <Popover open={open} onOpenChange={onOpenChange}><PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        <div className="flex flex-wrap gap-1">{files.map((f) => <FileChip key={f.id} f={f} onRemove={() => onChange(files.filter((x) => x.id !== f.id))} />)}{!files.length && <span className="px-1 text-[12px] text-fg-faint">No files.</span>}</div>
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-dashed border-line text-[13px] text-fg-muted hover:bg-bg-sunk">{busy ? <Spinner /> : <Upload className="size-4" />} Upload files</button>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
      </PopoverContent>
    </Popover>
  );
}
