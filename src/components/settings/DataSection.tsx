"use client";
/** Settings → Data: export (ZIP / JSON), import dropzone with progress polling, encrypted backups list + run/verify. */
import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Database, Download, FileJson, FileUp, HardDrive, Play, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, fmtDate, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Spinner, Tip } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

const ACCEPT = ".md,.markdown,.txt,.zip,.docx,.pdf,.csv,.bib,.json";
const fmtBytes = (n: number | null | undefined) => (n == null ? "–" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
type Progress = { jobId?: string; status: "queued" | "running" | "done" | "error"; progress: number; message?: string; pageId?: string | null; error?: string; stats?: { pages: number; databases: number; rows: number; attachments: number; references: number; skipped: string[] }; filename?: string; kind?: string };
type BackupJob = { id: string; kind: string; status: string; path: string | null; sizeBytes: number | null; sha256: string | null; offsite: boolean | null; error: string | null; startedAt: string; finishedAt: string | null };
type BackupsResp = { jobs: BackupJob[]; lastOk: BackupJob | null; config: { dir: string | null; offsite: string | null; keepDays: number; schedule: string; passphraseSet: boolean } };

function Section({ icon, title, hint, children, action }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-bg-elev p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5"><span className="mt-0.5 text-fg-muted [&_svg]:size-4">{icon}</span><div><h3 className="text-sm font-semibold">{title}</h3>{hint && <p className="text-[12.5px] text-fg-muted">{hint}</p>}</div></div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ExportBlock() {
  const items = [
    { href: "/api/export?format=zip", icon: <Archive />, label: "Workspace ZIP", desc: "Markdown per page (folders mirror the tree), CSV per database, attachments/, references.bib, workspace.json" },
    { href: "/api/export?format=json", icon: <FileJson />, label: "JSON backup", desc: "Every content table, re-importable here (merge by id)" },
    { href: "/api/export?format=bib", icon: <Download />, label: "references.bib", desc: "All references as BibTeX" },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {items.map((it) => (
        <a key={it.href} href={it.href} className="group flex min-h-[44px] items-start gap-2.5 rounded-lg border border-line bg-bg p-3 transition-colors hover:bg-bg-sunk">
          <span className="mt-0.5 text-fg-muted group-hover:text-fg [&_svg]:size-4">{it.icon}</span>
          <span className="min-w-0"><span className="block text-[13px] font-medium">{it.label}</span><span className="block text-[12px] leading-snug text-fg-muted">{it.desc}</span></span>
        </a>
      ))}
      <p className="text-[12px] text-fg-faint sm:col-span-3">Per page: use the page menu → Export (Markdown, PDF print view) or <code className="rounded bg-bg-sunk px-1">/api/export?format=md|pdf|zip|csv&amp;pageId=…</code>.</p>
    </div>
  );
}

function ImportBlock() {
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [prog, setProg] = React.useState<Progress | null>(null);
  const pollRef = React.useRef<number | null>(null);
  React.useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);
  const finish = (p: Progress) => { setProg(p); setBusy(null); qc.invalidateQueries({ queryKey: ["tree"] }); if (p.status === "done") toast("Import finished", { tone: "success", description: p.stats ? `${p.stats.pages} pages, ${p.stats.databases} databases, ${p.stats.rows} rows, ${p.stats.attachments} files, ${p.stats.references} refs` : undefined }); else toast("Import failed", { tone: "danger", description: p.error }); };
  const poll = (jobId: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => { try { const p = await api<Progress>(`/api/import?jobId=${jobId}`); setProg(p); if (p.status === "done" || p.status === "error") { window.clearInterval(pollRef.current!); pollRef.current = null; finish(p); } } catch (e) { window.clearInterval(pollRef.current!); pollRef.current = null; finish({ status: "error", progress: 0, error: (e as Error).message }); } }, 1500);
  };
  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files); if (!list.length) return;
    for (const file of list) {
      setBusy(file.name); setProg({ status: "queued", progress: 0, message: "Uploading…", filename: file.name });
      const fd = new FormData(); fd.append("file", file);
      try {
        const r = await api<any>("/api/import", { method: "POST", body: fd });
        if (r.jobId) { setProg({ jobId: r.jobId, status: "queued", progress: 0.01, message: "Queued for the worker", filename: file.name, kind: r.kind }); poll(r.jobId); await new Promise<void>((res) => { const t = window.setInterval(() => { if (!pollRef.current) { window.clearInterval(t); res(); } }, 500); }); }
        else finish({ status: "done", progress: 1, pageId: r.pageId, stats: r.stats, filename: file.name, kind: r.kind });
      } catch (e) { finish({ status: "error", progress: 0, error: (e as Error).message, filename: file.name }); }
    }
  };
  return (
    <div className="space-y-3">
      <div role="button" tabIndex={0} aria-label="Import files" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }} onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) void upload(e.dataTransfer.files); }}
        className={cn("flex min-h-[112px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-4 text-center transition-colors", drag ? "border-accent bg-accent-soft" : "border-line bg-bg hover:bg-bg-sunk", busy && "pointer-events-none opacity-70")}>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
        {busy ? <Spinner /> : <FileUp className="size-5 text-fg-faint" />}
        <div className="text-[13px] font-medium">{busy ? `Importing ${busy}…` : "Drop files here or click to choose"}</div>
        <div className="text-[12px] text-fg-muted">Markdown · Notion export ZIP · Markdown ZIP · DOCX · PDF · CSV → database · BibTeX → references · JSON backup</div>
      </div>
      {prog && (
        <div className="rounded-lg border border-line bg-bg p-3 text-[13px]">
          <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{prog.filename ?? "Import"}</span><Badge tone={prog.status === "done" ? "success" : prog.status === "error" ? "danger" : "accent"}>{prog.status}</Badge></div>
          {(prog.status === "queued" || prog.status === "running") && <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-sunk"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(3, Math.round((prog.progress ?? 0) * 100))}%` }} /></div>}
          {prog.message && prog.status !== "done" && <div className="mt-1 text-[12px] text-fg-muted">{prog.message}</div>}
          {prog.status === "error" && <div className="mt-1 text-[12px] text-danger">{prog.error}</div>}
          {prog.status === "done" && <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-muted">{prog.stats && <span>{prog.stats.pages} pages · {prog.stats.databases} databases · {prog.stats.rows} rows · {prog.stats.attachments} files · {prog.stats.references} refs</span>}{prog.pageId && <Link href={`/p/${prog.pageId}`} className="text-accent hover:underline">Open imported page →</Link>}{prog.stats?.skipped?.length ? <span className="text-warning">{prog.stats.skipped.length} note(s): {prog.stats.skipped.slice(0, 2).join("; ")}</span> : null}</div>}
        </div>
      )}
    </div>
  );
}

function BackupsBlock() {
  const qc = useQueryClient();
  const q = useQuery<BackupsResp>({ queryKey: ["backups"], queryFn: () => api("/api/backups"), refetchInterval: (query) => (query.state.data?.jobs.some((j) => j.status === "running" || j.status === "queued") ? 4000 : false) });
  const [running, setRunning] = React.useState(false); const [verifying, setVerifying] = React.useState<string | null>(null);
  const run = async () => { setRunning(true); try { await api("/api/backups", { method: "POST", json: { action: "run" } }); toast("Backup queued", { description: "The worker runs scripts/backup.sh; this list refreshes automatically." }); qc.invalidateQueries({ queryKey: ["backups"] }); } catch (e) { toast("Could not start backup", { tone: "danger", description: (e as Error).message }); } finally { setRunning(false); } };
  const verify = async (id: string) => { setVerifying(id); try { const r = await api<any>("/api/backups", { method: "POST", json: { action: "verify", id } }); toast(r.ok ? "Archive verified" : "Verification failed", { tone: r.ok ? "success" : "danger", description: r.ok ? `${r.path} · ${fmtBytes(r.size)} · sha256 matches` : r.reason ?? (r.exists ? "sha256 or size mismatch" : "archive missing") }); } catch (e) { toast("Verify failed", { tone: "danger", description: (e as Error).message }); } finally { setVerifying(null); } };
  const d = q.data; const jobs = d?.jobs ?? [];
  const tone = (s: string) => (s === "ok" ? "success" : s === "failed" ? "danger" : s === "running" || s === "queued" ? "accent" : "neutral") as "success" | "danger" | "accent" | "neutral";
  return (
    <div className="space-y-3">
      <div className="grid gap-2 text-[12.5px] sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-bg p-2.5"><div className="text-fg-faint">Last successful</div><div className="font-medium">{d?.lastOk ? `${timeAgo(d.lastOk.finishedAt ?? d.lastOk.startedAt)} · ${fmtBytes(d.lastOk.sizeBytes)}` : q.isLoading ? "…" : "never"}</div></div>
        <div className="rounded-lg border border-line bg-bg p-2.5"><div className="text-fg-faint">Schedule</div><div className="font-medium">{d?.config.schedule ?? "…"}</div><div className="text-fg-muted">keep {d?.config.keepDays ?? 30} days</div></div>
        <div className="rounded-lg border border-line bg-bg p-2.5"><div className="text-fg-faint">Off-site copy</div><div className="truncate font-medium" title={d?.config.offsite ?? ""}>{d?.config.offsite ?? "not configured"}</div>{d && !d.config.passphraseSet && <div className="text-danger">BACKUP_PASSPHRASE missing</div>}</div>
      </div>
      {q.isError ? <div className="text-[13px] text-danger">{(q.error as Error).message}</div> : jobs.length === 0 ? <div className="rounded-lg border border-dashed border-line p-4 text-center text-[13px] text-fg-muted">{q.isLoading ? <Spinner /> : "No backup yet — run one now."}</div> : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-bg">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
              <span className="w-[150px] shrink-0 tabular-nums">{fmtDate(j.startedAt, { dateStyle: "medium", timeStyle: "short" })}</span>
              <Badge tone={tone(j.status)}>{j.status}</Badge>
              <span className="w-[70px] tabular-nums text-fg-muted">{fmtBytes(j.sizeBytes)}</span>
              <Tip label={j.offsite ? "Copied and verified on the off-site host" : "No off-site copy"}><span className={cn("inline-flex items-center gap-1 text-[12px]", j.offsite ? "text-success" : "text-fg-faint")}><HardDrive className="size-3.5" />{j.offsite ? "off-site" : "local only"}</span></Tip>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-faint" title={j.error ?? j.path ?? ""}>{j.error ? <span className="text-danger">{j.error}</span> : j.path?.split("/").pop()}</span>
              {j.status === "ok" && j.path && <Button variant="ghost" size="xs" disabled={verifying === j.id} onClick={() => verify(j.id)}>{verifying === j.id ? <Spinner className="size-3" /> : <ShieldCheck />} Verify</Button>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={run} disabled={running || jobs.some((j) => j.status === "running" || j.status === "queued")}>{running ? <Spinner className="size-3.5 border-t-white" /> : <Play />} Run backup now</Button>
        <Button size="sm" variant="ghost" onClick={() => q.refetch()}><RefreshCw /> Refresh</Button>
        <span className="text-[12px] text-fg-faint">pg_dump + uploads → AES-256 (pbkdf2) → sha256 → rsync. Restore test: <code className="rounded bg-bg-sunk px-1">scripts/restore.sh --latest --verify-only</code> (see docs/operations.md).</span>
      </div>
    </div>
  );
}

export function DataSection() {
  return (
    <div className="space-y-4">
      <Section icon={<Download />} title="Export" hint="Your data in open formats — Markdown, CSV, BibTeX, JSON.">
        <ExportBlock />
      </Section>
      <Section icon={<Upload />} title="Import" hint="Small files are imported immediately; large ones run in the background worker with progress.">
        <ImportBlock />
      </Section>
      <Section icon={<Database />} title="Backups" hint="Nightly encrypted backup of the database and uploads, with an off-site copy.">
        <BackupsBlock />
      </Section>
    </div>
  );
}
