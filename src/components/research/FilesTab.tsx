"use client";
/** Files of a page: uploads with real progress and cancel, cards with Open / Download / Share, delete with confirmation. */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Trash2, Upload, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useIsTouch, useOnline } from "@/lib/client/hooks";
import { uploadFile } from "@/lib/client/upload";
import { Badge, Empty } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { Confirm, ErrorBox, IconBtn, ListSkeleton, TButton, errText, fmtBytes } from "./ui";
import { FileActions } from "./FileActions";
import { refsKey, attKey } from "./ReferencesTab";
import { cn, timeAgo } from "@/lib/utils";

const MAX = 200 * 1024 * 1024;
interface Job { id: string; file: File; progress: number; state: "uploading" | "failed"; error?: string; abort: AbortController }
export function FilesTab({ pageId }: { pageId: string }) {
  const qc = useQueryClient(); const input = useRef<HTMLInputElement>(null); const online = useOnline(); const touch = useIsTouch();
  const [jobs, setJobs] = useState<Job[]>([]); const [drag, setDrag] = useState(false); const [toDelete, setToDelete] = useState<any | null>(null); const [deleting, setDeleting] = useState(false);
  const q = useQuery<any[]>({ queryKey: attKey(pageId), queryFn: () => api(`/api/attachments?pageId=${pageId}`) });
  const { data: refs = [] } = useQuery<any[]>({ queryKey: refsKey(pageId), queryFn: () => api(`/api/research/references?pageId=${pageId}`) });
  const files = q.data ?? [];
  const jobsRef = useRef<Job[]>([]); jobsRef.current = jobs;
  useEffect(() => () => jobsRef.current.forEach((j) => j.abort.abort()), []);
  const refresh = () => { qc.invalidateQueries({ queryKey: attKey(pageId) }); qc.invalidateQueries({ queryKey: ["research-overview"] }); };
  const patch = (id: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));
  async function run(job: Job) {
    if (job.file.size > MAX) { patch(job.id, { state: "failed", error: `${fmtBytes(job.file.size)} — the limit is 200 MB.` }); return; }
    try {
      const r = await uploadFile(job.file, pageId, { signal: job.abort.signal, onProgress: (f) => patch(job.id, { progress: f }) });
      setJobs((js) => js.filter((j) => j.id !== job.id)); refresh();
      toast(`Uploaded ${r.name}`, { tone: "success", description: /pdf$/i.test(r.mime) || /\.pdf$/i.test(r.name) ? "Text is extracted and indexed for search and AI synthesis." : undefined });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") { setJobs((js) => js.filter((j) => j.id !== job.id)); return; }
      patch(job.id, { state: "failed", error: errText(e), progress: 0 });
    }
  }
  function add(list: FileList | File[] | null) {
    const arr = Array.from(list ?? []); if (!arr.length) return;
    const next = arr.map((file) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, progress: 0, state: "uploading" as const, abort: new AbortController() }));
    setJobs((js) => [...js, ...next]); next.forEach((j) => void run(j));
  }
  const retry = (j: Job) => { const n: Job = { ...j, state: "uploading", progress: 0, error: undefined, abort: new AbortController() }; setJobs((js) => js.map((x) => (x.id === j.id ? n : x))); void run(n); };
  async function del() {
    const f = toDelete; if (!f) return; setDeleting(true);
    try { await api(`/api/attachments?id=${f.id}`, { method: "DELETE" }); setToDelete(null); toast(`Deleted ${f.filename}`); refresh(); qc.invalidateQueries({ queryKey: refsKey(pageId) }); }
    catch (e) { toast("Could not delete the file", { description: errText(e), tone: "danger" }); } finally { setDeleting(false); }
  }
  const linked = (id: string) => refs.filter((r) => r.attachmentId === id);
  return (
    <div className={cn("min-w-0 rounded-lg", drag && "outline outline-2 outline-accent")} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
      <div className="flex flex-wrap items-center gap-2">
        <TButton onClick={() => input.current?.click()} disabled={!online}><Upload /> Upload files</TButton>
        <input ref={input} type="file" multiple className="hidden" accept=".pdf,.docx,.txt,.md,.csv,.tex,.bib,application/pdf" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <span className="text-[12.5px] text-fg-muted">{online ? `PDF, DOCX, text — up to 200 MB each.${touch ? "" : " You can also drop files here."}` : "You are offline — uploads need a connection."}</span>
      </div>
      {jobs.length > 0 && <ul className="mt-3 space-y-2" aria-label="Uploads">{jobs.map((j) => (
        <li key={j.id} className="rounded-lg border border-line bg-bg-elev p-3 text-[13px]" role="status" aria-live="polite">
          <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{j.file.name}</span><span className="shrink-0 tabular-nums text-fg-muted">{j.state === "failed" ? "failed" : j.progress >= 1 ? "processing…" : `${Math.round(j.progress * 100)} %`}</span>{j.state === "uploading" && <IconBtn label={`Cancel the upload of ${j.file.name}`} onClick={() => j.abort.abort()}><X /></IconBtn>}</div>
          {j.state === "uploading" ? <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-sunk" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.progress * 100)} aria-label={`Uploading ${j.file.name}`}><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(2, Math.round(j.progress * 100))}%` }} /></div>
            : <><div className="mt-1 break-words text-danger-text">{j.error}</div><div className="mt-2 flex gap-2"><TButton onClick={() => retry(j)}>Retry</TButton><TButton variant="ghost" onClick={() => setJobs((js) => js.filter((x) => x.id !== j.id))}>Dismiss</TButton></div></>}
        </li>))}</ul>}
      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorBox title="Could not load the files" message={errText(q.error)} onRetry={() => q.refetch()} /> : !files.length && !jobs.length ? (
        <Empty icon={<FileText />} title="No files on this page" hint="Upload the PDFs of the papers you cite, then attach each one to its reference from the References tab." action={<TButton onClick={() => input.current?.click()} disabled={!online}><Upload /> Upload files</TButton>} />
      ) : (
        <ul className="mt-3 grid gap-2 lg:grid-cols-2">{files.map((f) => { const l = linked(f.id); return (
          <li key={f.id} className="min-w-0 rounded-lg border border-line bg-bg-elev p-3">
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="break-words text-[13.5px] font-medium leading-snug">{f.filename}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-fg-muted"><span>{fmtBytes(f.size)}</span>{f.pageCount != null && <span>· {f.pageCount} p.</span>}<span>· {timeAgo(f.createdAt)}</span>{f.hasText ? <Badge tone="success">searchable</Badge> : <Badge tone="warning">no text</Badge>}</div>
                {l.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{l.map((r) => <span key={r.id} className="inline-flex max-w-full items-center gap-1 rounded bg-bg-sunk px-1.5 py-0.5 font-mono text-[11.5px] text-fg-muted"><Paperclip className="size-3 shrink-0" aria-hidden /><span className="truncate">{r.citeKey}</span></span>)}</div>}
              </div>
              <IconBtn label={`Delete ${f.filename}`} danger onClick={() => setToDelete(f)}><Trash2 /></IconBtn>
            </div>
            <FileActions id={f.id} filename={f.filename} mime={f.mime} size={f.size} className="mt-2.5" />
          </li>); })}</ul>
      )}
      <Confirm open={toDelete !== null} onOpenChange={(o) => { if (!o) setToDelete(null); }} title="Delete this file?" description={toDelete ? <>“{toDelete.filename}” is removed from this page and from search.{linked(toDelete.id).length ? ` It is the PDF of ${linked(toDelete.id).map((r) => r.citeKey).join(", ")}: that link is lost too.` : ""} This cannot be undone from here.</> : ""} confirmLabel="Delete file" danger busy={deleting} onConfirm={del} />
    </div>
  );
}
