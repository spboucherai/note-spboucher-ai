"use client";
import { useRef, useState } from "react";
import { ExternalLink, Paperclip, Upload, X } from "lucide-react";
import { Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { FileRef } from "@/lib/databases/types";
import { ResponsivePanel } from "../Responsive";

export const isImage = (f: FileRef) => (f.mime ? f.mime.startsWith("image/") : /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(f.name));

export function FileChip({ f, onRemove, className }: { f: FileRef; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-bg-elev px-1.5 py-0.5 text-[12px] leading-4", className)}>
      <Paperclip className="size-3 shrink-0 text-fg-faint" />
      <a href={f.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="truncate hover:text-accent">{f.name}</a>
      {onRemove && <button type="button" aria-label={`Remove ${f.name}`} onClick={(e) => { e.stopPropagation(); onRemove(); }} className="-mr-0.5 rounded p-0.5 text-fg-faint hover:text-fg"><X className="size-3" /></button>}
    </span>
  );
}

export async function uploadFiles(files: File[], pageId: string): Promise<FileRef[]> {
  const out: FileRef[] = [];
  for (const file of files) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("pageId", pageId);
    const res = await fetch("/api/attachments", { method: "POST", body: fd, credentials: "same-origin" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`);
    const j = await res.json();
    out.push({ id: j.id, url: j.url, name: j.name, mime: j.mime });
  }
  return out;
}

/** Files of a row: each one can be opened (image thumbnail when it is a picture), removed, and new ones uploaded. */
export function FilePopover({ value, pageId, onChange, open, onOpenChange, children }: {
  value: unknown; pageId: string; onChange: (v: FileRef[]) => void; open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode;
}) {
  const files = (Array.isArray(value) ? value : []) as FileRef[];
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try { onChange([...files, ...(await uploadFiles([...list], pageId))]); }
    catch (e: any) { toast("Upload failed", { description: e?.message ?? "Nothing was attached. Try again.", tone: "danger" }); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };

  return (
    <ResponsivePanel open={open} onOpenChange={onOpenChange} trigger={children} title="Files" description="Tap a file to open it." className="w-72 p-2">
      <ul className="space-y-1">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-1 rounded-md border border-line bg-bg-elev">
            <a href={f.url} target="_blank" rel="noreferrer" className="flex min-h-9 min-w-0 flex-1 items-center gap-2 px-2 py-1 text-[13px] hover:text-accent max-md:min-h-12 max-md:text-[15px]">
              {isImage(f)
                ? <img src={f.url} alt="" loading="lazy" className="size-7 shrink-0 rounded object-cover max-md:size-9" />
                : <Paperclip className="size-4 shrink-0 text-fg-faint" />}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <ExternalLink className="size-3.5 shrink-0 text-fg-faint" />
            </a>
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((x) => x.id !== f.id))} className="grid size-9 shrink-0 place-items-center rounded-md text-fg-faint hover:bg-bg-sunk hover:text-danger-text max-md:size-11">
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      {!files.length && <p className="px-1 text-[12px] text-fg-faint max-md:py-2 max-md:text-[14px]">No files attached yet.</p>}
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-dashed border-line text-[13px] text-fg-muted hover:bg-bg-sunk disabled:opacity-60 max-md:h-11 max-md:text-[15px]">
        {busy ? <Spinner /> : <Upload className="size-4" />} {busy ? "Uploading…" : "Upload files"}
      </button>
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
    </ResponsivePanel>
  );
}
