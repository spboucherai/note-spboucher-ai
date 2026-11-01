"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload, ExternalLink, Trash2, Paperclip } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge, Spinner, Empty } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { fmtBytes } from "./ui";
import { refsKey, attKey } from "./ReferencesTab";
import { timeAgo } from "@/lib/utils";

export function FilesTab({ pageId }: { pageId: string }) {
  const qc = useQueryClient(); const input = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(0);
  const { data: files = [], isLoading } = useQuery<any[]>({ queryKey: attKey(pageId), queryFn: () => api(`/api/attachments?pageId=${pageId}`) });
  const { data: refs = [] } = useQuery<any[]>({ queryKey: refsKey(pageId), queryFn: () => api(`/api/research/references?pageId=${pageId}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: attKey(pageId) }); qc.invalidateQueries({ queryKey: ["research-overview"] }); };
  async function upload(list: FileList | null) {
    const arr = Array.from(list ?? []); if (!arr.length) return; setBusy(arr.length);
    for (const f of arr) { try { const fd = new FormData(); fd.append("file", f); fd.append("pageId", pageId); const r = await api("/api/attachments", { method: "POST", body: fd }); toast(`Uploaded ${r.name}`, { description: r.hasText ? `${r.pages ?? "?"} pages · text extracted, indexing…` : "No text extracted", tone: "success" }); } catch (e: any) { toast(`Upload failed: ${f.name}`, { description: e.message, tone: "danger" }); } finally { setBusy((b) => b - 1); } }
    refresh();
  }
  async function del(f: any) { if (!confirm(`Delete ${f.filename}?`)) return; await api(`/api/attachments?id=${f.id}`, { method: "DELETE" }); toast("File deleted"); refresh(); qc.invalidateQueries({ queryKey: refsKey(pageId) }); }
  const linked = (id: string) => refs.filter((r) => r.attachmentId === id);
  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => input.current?.click()} disabled={busy > 0}>{busy > 0 ? <Spinner className="size-3.5" /> : <Upload />} Upload PDF / files</Button>
        <input ref={input} type="file" multiple className="hidden" accept=".pdf,.docx,.txt,.md,.csv,.tex,.bib,application/pdf" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        <span className="text-[12px] text-fg-faint">PDF text is extracted and indexed for search and AI synthesis. Drop files here.</span>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Spinner /></div> : !files.length ? <Empty icon={<FileText />} title="No files on this page" hint="Upload the PDFs of the papers you cite; attach them to references from the References tab." /> : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{files.map((f) => { const l = linked(f.id); return (
          <div key={f.id} className="flex items-start gap-2 rounded-lg border border-line bg-bg-elev p-3">
            <FileText className="mt-0.5 size-5 shrink-0 text-fg-muted" />
            <div className="min-w-0 flex-1">
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium hover:text-accent">{f.filename}</a>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-faint"><span>{fmtBytes(f.size)}</span>{f.pageCount != null && <span>· {f.pageCount} p.</span>}<span>· {timeAgo(f.createdAt)}</span>{f.hasText ? <Badge tone="success">text</Badge> : <Badge tone="warning">no text</Badge>}</div>
              {l.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{l.map((r) => <span key={r.id} className="inline-flex items-center gap-1 rounded bg-bg-sunk px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"><Paperclip className="size-3" />{r.citeKey}</span>)}</div>}
            </div>
            <div className="flex shrink-0 flex-col gap-0.5"><button className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk" title="Open" onClick={() => window.open(f.url, "_blank")}><ExternalLink className="size-4" /></button><button className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk hover:text-danger" title="Delete" onClick={() => del(f)}><Trash2 className="size-4" /></button></div>
          </div>); })}</div>
      )}
    </div>
  );
}
