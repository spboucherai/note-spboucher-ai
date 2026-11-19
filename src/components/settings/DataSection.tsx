"use client";
/**
 * Settings → Data.
 *  Export  — whole-workspace ZIP / JSON ask for the passkey first (`withFreshAuth` on `…&check=1`), then the browser downloads the file.
 *  Import  — choose a file → upload with real progress (cancellable) → PREVIEW of what would be created, duplicates and warnings →
 *            "skip what exists" (default) or "import again" → run with item progress, cancel, retry/resume. Nothing is created before the
 *            confirmation. Jobs are read back from the server, so a reload (or another device) still shows a running or failed import.
 *  Backups — last runs as cards, run now, verify an archive.
 * Phone rules: sections stack, one large "Choose a file" button (the drop zone only exists for mouse users), every action ≥ 44 px.
 */
import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Database, Download, FileJson, FileUp, HardDrive, Play, RefreshCw, RotateCw, ShieldCheck, Upload, X } from "lucide-react";
import { api, ApiError, newKey, toLogin } from "@/lib/client/api";
import { withFreshAuth, describePasskeyError, localUnlockName } from "@/lib/client/passkey";
import { useIsTouch, useOnline } from "@/lib/client/hooks";
import { cn, fmtDate, timeAgo } from "@/lib/utils";
import { Button, buttonVariants, type ButtonProps } from "@/components/ui/button";
import { Badge, Skeleton, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

const ACCEPT = ".md,.markdown,.txt,.zip,.docx,.pdf,.csv,.bib,.json";
const MAX_UPLOAD = 500 * 1024 * 1024;
const fmtBytes = (n: number | null | undefined) => (n == null ? "–" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
const errText = (e: unknown) => { const x = e as { status?: number; message?: string }; return x?.status === 0 ? "No connection to the server." : x?.message || "Something went wrong."; };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

type Stats = { pages: number; databases: number; rows: number; attachments: number; references: number; skipped: string[]; duplicates?: number; resumed?: number };
type Job = { jobId: string; status: "preview" | "queued" | "running" | "done" | "error" | "cancelled"; progress: number; done?: number; total?: number; message?: string; pageId?: string | null; error?: string | null; errorCode?: string | null; retryable?: boolean; attempts?: number; maxAttempts?: number; stats?: Stats; filename?: string; kind?: string; size?: number; duplicates?: "skip" | "import"; stalled?: boolean; canRetry?: boolean; createdAt: string; updatedAt: string };
type Counts = { pages: number; databases: number; rows: number; references: number; attachments: number };
type Preview = { kind: string; detected: string; filename: string; size: number; counts: Counts; countsAll: Counts; tree: { title: string; depth: number; kind: "page" | "folder" | "database" | "file"; duplicate?: boolean; note?: string }[]; treeTruncated: number; duplicates: { total: number; pages: { title: string; existingId: string }[]; databases: { title: string; existingId: string }[]; references: { citeKey: string; reason: string }[]; note?: string }; warnings: string[]; modes: { skip: string; import: string } };
type BackupJob = { id: string; kind: string; status: string; path: string | null; sizeBytes: number | null; sha256: string | null; offsite: boolean | null; error: string | null; startedAt: string; finishedAt: string | null };
type BackupsResp = { jobs: BackupJob[]; lastOk: BackupJob | null; config: { dir: string | null; offsite: string | null; keepDays: number; schedule: string; passphraseSet: boolean } };

/** 44 px on phones, compact from `md`. */
const TBtn = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, size = "sm", ...p }, ref) => <Button ref={ref} size={size} className={cn("h-11 px-3.5 md:h-8 md:px-2.5", className)} {...p} />);
TBtn.displayName = "TBtn";
function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-bg-elev p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-2.5"><span className="mt-0.5 text-fg-muted [&_svg]:size-4">{icon}</span><div className="min-w-0"><h3 className="text-sm font-semibold">{title}</h3>{hint && <p className="text-[13px] leading-snug text-fg-muted">{hint}</p>}</div></div>
      {children}
    </section>
  );
}
function Bar({ value, label }: { value: number | null; label: string }) {
  return <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-bg-sunk" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} {...(value != null ? { "aria-valuenow": Math.round(value * 100) } : {})}><div className={cn("h-full rounded-full bg-accent transition-[width]", value == null && "w-1/3 animate-pulse")} style={value != null ? { width: `${Math.max(3, Math.round(value * 100))}%` } : undefined} /></div>;
}

// ------------------------------------------------------------------ export
function ExportBlock() {
  const online = useOnline(); const [busy, setBusy] = React.useState<string | null>(null); const [versions, setVersions] = React.useState(true);
  /** Whole-workspace exports need a fresh passkey: verify on a JSON pre-check (a download navigation cannot run the ceremony), then download. */
  async function secure(id: string, href: string) {
    if (busy) return; setBusy(id);
    try { await withFreshAuth(() => api(`${href}&check=1`)); window.location.assign(href); toast("Export started", { description: "Your browser downloads the file. A large workspace takes a moment to prepare." }); }
    catch (e) { const d = describePasskeyError(e); toast(d.cancelled ? "Export cancelled" : "Export not started", { description: d.cancelled ? "Nothing was exported." : (e as ApiError)?.status === 0 ? "No connection to the server." : d.message, tone: d.cancelled ? "neutral" : "danger", ...(d.cancelled ? {} : { action: { label: "Retry", run: () => secure(id, href) } }) }); }
    finally { setBusy(null); }
  }
  const card = "flex min-h-16 w-full items-start gap-2.5 rounded-lg border border-line bg-bg p-3 text-left transition-colors hover:bg-bg-sunk disabled:opacity-60";
  const body = (icon: React.ReactNode, label: string, desc: string, spin: boolean) => <><span className="mt-0.5 text-fg-muted [&_svg]:size-4">{spin ? <Spinner className="size-4" /> : icon}</span><span className="min-w-0"><span className="block text-[14px] font-medium md:text-[13px]">{label}</span><span className="block text-[12.5px] leading-snug text-fg-muted">{desc}</span></span></>;
  return (
    <div className="space-y-2">
      <div className="grid gap-2 md:grid-cols-3">
        <button type="button" className={card} disabled={!online || busy !== null} onClick={() => secure("zip", "/api/export?format=zip")}>{body(<Archive />, "Workspace ZIP", "One Markdown file per page (folders mirror the tree), a CSV per database, attachments, references.bib, workspace.json and export-report.json.", busy === "zip")}</button>
        <button type="button" className={card} disabled={!online || busy !== null} onClick={() => secure("json", `/api/export?format=json${versions ? "" : "&versions=0"}`)}>{body(<FileJson />, "JSON backup", "Every content table with its ids; can be imported back here. Attachment files are not inside (use the ZIP or the encrypted backup).", busy === "json")}</button>
        <a href="/api/export?format=bib" download="references.bib" className={card}>{body(<Download />, "references.bib", "All references as BibTeX, every field kept.", false)}</a>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[13px] text-fg-muted md:min-h-8"><input type="checkbox" checked={versions} onChange={(e) => setVersions(e.target.checked)} className="size-5 accent-[var(--accent)] md:size-4" /> Include the version history of pages in the JSON backup</label>
      <p className="text-[12.5px] leading-snug text-fg-faint">ZIP and JSON contain the whole workspace: you confirm with {localUnlockName()} first. Each export lists what it could not include — <code className="rounded bg-bg-sunk px-1">export-report.json</code> in the ZIP, the <code className="rounded bg-bg-sunk px-1">report</code> field in the JSON. One page or one database: use its own menu → Export.</p>
      {!online && <p className="text-[12.5px] text-fg-muted" role="status">You are offline — exports need the server.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ import
/** multipart upload with real progress and cancel (fetch has no upload progress). Rejects with an ApiError (status, code, body). */
function uploadForPreview(file: File, opts: { onProgress: (f: number) => void; signal: AbortSignal }): Promise<{ jobId: string; kind: string; inline: boolean; preview: Preview }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData(); fd.append("file", file);
    const x = new XMLHttpRequest(); x.open("POST", "/api/import?preview=1"); x.responseType = "json"; x.withCredentials = true;
    x.setRequestHeader("x-request-id", newKey());
    x.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress(e.loaded / e.total); };
    x.upload.onload = () => opts.onProgress(1);
    x.onload = () => {
      if (x.status === 401) { toLogin(); return reject(new ApiError("Sign-in required", 401, "unauthenticated")); }
      if (x.status >= 200 && x.status < 300 && x.response?.jobId) resolve(x.response);
      else reject(new ApiError(x.response?.error ?? (x.status === 413 ? "The file is too large (500 MB at most)." : `The server refused the file (${x.status}).`), x.status, x.response?.code, x.response));
    };
    x.onerror = () => reject(new ApiError("The connection was lost during the upload. Nothing was imported.", 0, "network"));
    x.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    opts.signal.addEventListener("abort", () => x.abort());
    x.send(fd);
  });
}
const COUNT_LABELS: [keyof Counts, string, string][] = [["pages", "page", "pages"], ["databases", "database", "databases"], ["rows", "row", "rows"], ["references", "reference", "references"], ["attachments", "file", "files"]];
const countLine = (c: Counts) => COUNT_LABELS.filter(([k]) => c[k] > 0).map(([k, one, many]) => plural(c[k], one, many)).join(" · ") || "nothing";

function PreviewCard({ file, p, mode, setMode, busy, onConfirm, onCancel }: { file: File; p: Preview; mode: "skip" | "import"; setMode: (m: "skip" | "import") => void; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const c = mode === "skip" ? p.counts : p.countsAll; const nothing = COUNT_LABELS.every(([k]) => c[k] === 0);
  const dupItems = [...p.duplicates.pages.map((d) => ({ key: `p${d.existingId}${d.title}`, label: d.title, href: `/p/${d.existingId}`, reason: "same title and content" })), ...p.duplicates.databases.map((d) => ({ key: `d${d.existingId}`, label: d.title, href: `/p/${d.existingId}`, reason: "database with the same name and number of rows" })), ...p.duplicates.references.map((d, i) => ({ key: `r${i}${d.citeKey}`, label: d.citeKey, href: "", reason: d.reason }))];
  return (
    <div className="rounded-lg border border-accent/40 bg-bg p-3 text-[13px] sm:p-4" role="region" aria-label="Import preview">
      <div className="flex flex-wrap items-baseline gap-x-2"><span className="min-w-0 break-words text-[14px] font-semibold">{file.name}</span><span className="text-fg-muted">{fmtBytes(p.size)}</span></div>
      <div className="mt-0.5 text-fg-muted">Recognised as: {p.detected}. Nothing has been imported yet.</div>
      <div className="mt-3 rounded-md bg-bg-sunk p-2.5"><div className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">Will be created</div><div className="mt-0.5 text-[14px] font-medium">{countLine(c)}</div></div>
      {p.duplicates.total > 0 && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-2.5">
          <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden /> {plural(p.duplicates.total, "item")} already exist{p.duplicates.total === 1 ? "s" : ""} in your workspace</div>
          {p.duplicates.note && <p className="mt-1 text-fg-muted">{p.duplicates.note}</p>}
          <fieldset className="mt-2 space-y-1.5"><legend className="sr-only">What to do with what already exists</legend>
            {(["skip", "import"] as const).map((m) => <label key={m} className={cn("flex min-h-12 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2", mode === m ? "border-accent bg-accent-soft" : "border-line bg-bg-elev")}><input type="radio" name="import-duplicates" checked={mode === m} onChange={() => setMode(m)} className="size-5 shrink-0 accent-[var(--accent)] md:size-4" /><span className="min-w-0"><span className="block font-medium">{p.modes[m]}{m === "skip" ? " (recommended)" : ""}</span><span className="block text-[12.5px] text-fg-muted">{countLine(m === "skip" ? p.counts : p.countsAll)} created</span></span></label>)}
          </fieldset>
          {dupItems.length > 0 && <details className="mt-1.5"><summary className="flex min-h-11 cursor-pointer items-center text-fg-muted md:min-h-8">Show what already exists ({dupItems.length}{p.duplicates.total > dupItems.length ? ` of ${p.duplicates.total}` : ""})</summary><ul className="max-h-56 space-y-1 overflow-y-auto overscroll-contain">{dupItems.map((d) => <li key={d.key} className="break-words">{d.href ? <Link href={d.href} target="_blank" className="text-accent underline-offset-2 hover:underline">{d.label}</Link> : <span className="font-mono">{d.label}</span>} <span className="text-fg-muted">— {d.reason}</span></li>)}</ul></details>}
        </div>
      )}
      {p.warnings.length > 0 && <details className="mt-3" open={p.warnings.length <= 3}><summary className="flex min-h-11 cursor-pointer items-center font-medium md:min-h-8">{plural(p.warnings.length, "thing")} to know before importing</summary><ul className="list-disc space-y-1 pl-5 text-fg-muted">{p.warnings.map((w, i) => <li key={i} className="break-words">{w}</li>)}</ul></details>}
      {p.tree.length > 0 && <details className="mt-1"><summary className="flex min-h-11 cursor-pointer items-center font-medium md:min-h-8">Page tree ({p.tree.length + p.treeTruncated})</summary>
        <ul className="max-h-72 overflow-y-auto overscroll-contain rounded-md border border-line py-1">{p.tree.map((n, i) => <li key={i} className="flex items-baseline gap-1.5 px-2 py-1" style={{ paddingLeft: `${0.5 + Math.min(n.depth, 6) * 0.9}rem` }}><span aria-hidden className="shrink-0">{n.kind === "folder" ? "📁" : n.kind === "database" ? "🗂️" : n.kind === "file" ? "📎" : "📄"}</span><span className="min-w-0 break-words">{n.title}{n.note && <span className="text-fg-muted"> — {n.note}</span>}</span>{n.duplicate && <Badge tone="warning" className="shrink-0">already exists</Badge>}</li>)}{p.treeTruncated > 0 && <li className="px-2 py-1 text-fg-muted">… and {p.treeTruncated.toLocaleString("en")} more</li>}</ul>
      </details>}
      {nothing && <p className="mt-3 text-fg-muted" role="status">{p.duplicates.total > 0 && mode === "skip" ? "Everything in this file already exists: there is nothing to import." : "This file contains nothing that can be imported."}</p>}
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><TBtn variant="ghost" onClick={onCancel} disabled={busy}>Cancel — import nothing</TBtn><TBtn onClick={onConfirm} disabled={busy || nothing}>{busy ? <Spinner className="size-3.5 border-t-white" /> : <Upload />} {busy ? "Importing…" : `Import ${countLine(c)}`}</TBtn></div>
    </div>
  );
}

function JobCard({ j, onRetry, onCancel, onDismiss, busy }: { j: Job; onRetry: () => void; onCancel: () => void; onDismiss: () => void; busy: boolean }) {
  const active = (j.status === "queued" || j.status === "running") && !j.stalled; const s = j.stats;
  const label = j.stalled ? "stalled" : j.status === "error" ? "failed" : j.status; const tone = j.stalled ? "warning" : j.status === "done" ? "success" : j.status === "error" ? "danger" : j.status === "cancelled" ? "neutral" : "accent";
  const items = j.total ? `${(j.done ?? 0).toLocaleString("en")} of ${j.total.toLocaleString("en")} items` : null;
  return (
    <li className="rounded-lg border border-line bg-bg p-3 text-[13px]" aria-live="polite">
      <div className="flex items-start justify-between gap-2"><span className="min-w-0 break-words font-medium">{j.filename ?? "Import"}</span><Badge tone={tone as any} className="shrink-0">{label}</Badge></div>
      <div className="text-[12px] text-fg-faint">{j.kind}{j.size ? ` · ${fmtBytes(j.size)}` : ""} · {timeAgo(j.updatedAt)}{(j.attempts ?? 0) > 1 ? ` · attempt ${j.attempts}` : ""}</div>
      {active && <><Bar value={j.status === "queued" ? null : j.total ? Math.min(1, (j.done ?? 0) / j.total) : j.progress > 0.02 ? j.progress : null} label={`Importing ${j.filename ?? "file"}`} /><div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[12.5px] text-fg-muted"><span className="min-w-0 truncate">{j.status === "queued" ? j.message ?? "Waiting for the background worker" : j.message ?? "Working…"}</span>{items && <span className="shrink-0 tabular-nums">{items}</span>}</div>{j.error && <div className="mt-1 break-words text-[12.5px] text-warning-text">Last attempt: {j.error}</div>}</>}
      {j.stalled && <p className="mt-2 break-words text-fg-muted" role="alert">No progress for more than 10 minutes{items ? ` (${items} so far)` : ""} — the background worker may have stopped. Retry continues where it stopped; nothing is imported twice.</p>}
      {j.status === "error" && <p className="mt-2 break-words text-danger-text" role="alert">{j.error ?? "The import failed."}{j.canRetry && j.retryable !== false ? " Retry continues where it stopped; nothing is imported twice." : ""}{!j.canRetry ? " Choose the file again to start over." : ""}</p>}
      {j.status === "cancelled" && <p className="mt-2 text-fg-muted">Cancelled{items ? ` after ${items}` : ""}. What was already imported is kept; Resume continues without creating it twice.</p>}
      {j.status === "done" && s && <div className="mt-2"><div>{countLine({ pages: s.pages, databases: s.databases, rows: s.rows, references: s.references, attachments: s.attachments })} imported{s.duplicates ? ` · ${plural(s.duplicates, "duplicate")} skipped` : ""}{s.resumed ? ` · ${s.resumed} found from an earlier attempt` : ""}</div>{s.skipped?.length > 0 && <details className="mt-1"><summary className="flex min-h-11 cursor-pointer items-center text-fg-muted md:min-h-8">{plural(s.skipped.length, "note")} about this import</summary><ul className="max-h-56 list-disc space-y-1 overflow-y-auto overscroll-contain pl-5 text-fg-muted">{s.skipped.map((x, i) => <li key={i} className="break-words">{x}</li>)}</ul></details>}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        {j.status === "done" && j.pageId && <Link href={`/p/${j.pageId}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 px-3.5 md:h-8 md:px-2.5")}>Open the imported page</Link>}
        {j.canRetry && <TBtn onClick={onRetry} disabled={busy}>{busy ? <Spinner className="size-3.5 border-t-white" /> : <RotateCw />} {j.status === "cancelled" ? "Resume" : "Retry"}</TBtn>}
        {(active || j.stalled) && <TBtn variant="outline" onClick={onCancel} disabled={busy}><X /> Cancel</TBtn>}
        {!active && !j.stalled && <TBtn variant="ghost" onClick={onDismiss} disabled={busy}>{j.status === "done" ? "Hide" : "Dismiss"}</TBtn>}
      </div>
    </li>
  );
}

function ImportBlock() {
  const qc = useQueryClient(); const online = useOnline(); const touch = useIsTouch();
  const inputRef = React.useRef<HTMLInputElement>(null); const abort = React.useRef<AbortController | null>(null);
  const [drag, setDrag] = React.useState(false);
  const [up, setUp] = React.useState<{ file: File; progress: number; state: "uploading" | "analysing" | "failed"; error?: string; retryable?: boolean } | null>(null);
  const [pending, setPending] = React.useState<{ jobId: string; file: File; preview: Preview } | null>(null); const [mode, setMode] = React.useState<"skip" | "import">("skip");
  const [confirming, setConfirming] = React.useState(false); const [acting, setActing] = React.useState<string | null>(null);
  const jobsQ = useQuery<{ jobs: Job[] }>({ queryKey: ["import-jobs"], queryFn: () => api("/api/import"), refetchInterval: (query) => { const js = query.state.data?.jobs ?? []; return js.some((j) => (j.status === "queued" || j.status === "running") && !j.stalled) ? 1500 : js.some((j) => j.stalled) ? 15_000 : false; } });
  const jobs = jobsQ.data?.jobs ?? [];
  const refreshJobs = () => qc.invalidateQueries({ queryKey: ["import-jobs"] });
  // announce a job that finishes or fails while this screen is open
  const seen = React.useRef(new Map<string, string>());
  React.useEffect(() => {
    for (const j of jobs) {
      const before = seen.current.get(j.jobId); seen.current.set(j.jobId, j.status);
      if (!before || before === j.status) continue;
      if (j.status === "done") { qc.invalidateQueries({ queryKey: ["tree"] }); qc.invalidateQueries({ queryKey: ["research-refs"] }); toast("Import finished", { tone: "success", description: j.filename }); }
      else if (j.status === "error") toast("Import failed", { tone: "danger", description: j.error ?? j.filename });
    }
  }, [jobs, qc]);
  React.useEffect(() => () => abort.current?.abort(), []);
  const busy = up?.state === "uploading" || up?.state === "analysing" || confirming;

  async function choose(file: File) {
    if (busy) return;
    if (pending) { await api(`/api/import?jobId=${pending.jobId}`, { method: "DELETE" }).catch(() => {}); setPending(null); }
    if (file.size > MAX_UPLOAD) { setUp({ file, progress: 0, state: "failed", error: `This file is ${fmtBytes(file.size)}; the limit is 500 MB. Split the export into several archives.`, retryable: false }); return; }
    if (file.size === 0) { setUp({ file, progress: 0, state: "failed", error: "This file is empty.", retryable: false }); return; }
    abort.current = new AbortController(); setUp({ file, progress: 0, state: "uploading" }); setMode("skip");
    try {
      const r = await uploadForPreview(file, { signal: abort.current.signal, onProgress: (f) => setUp((u) => (u && u.file === file ? { ...u, progress: f, state: f >= 1 ? "analysing" : "uploading" } : u)) });
      setUp(null); setPending({ jobId: r.jobId, file, preview: r.preview });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") { setUp(null); toast("Upload cancelled", { description: "Nothing was imported." }); return; }
      const st = (e as ApiError)?.status ?? 0;
      setUp({ file, progress: 0, state: "failed", error: errText(e), retryable: st === 0 || st >= 500 });
    }
  }
  async function confirm() {
    if (!pending || confirming) return; setConfirming(true); const p = pending;
    try {
      // overwriting existing pages with a backup is the one import that asks for the passkey (server: reauth_required)
      const r = await withFreshAuth(() => api<{ done?: boolean; jobId: string }>("/api/import", { method: "POST", json: { jobId: p.jobId, duplicates: mode }, timeoutMs: 310_000 }));
      if (r?.done) { seen.current.set(p.jobId, "done"); qc.invalidateQueries({ queryKey: ["research-refs"] }); toast("Import finished", { tone: "success", description: p.file.name }); }
      else toast("Import started", { description: "It continues in the background; progress is shown below." });
      setPending(null); refreshJobs(); qc.invalidateQueries({ queryKey: ["tree"] });
    } catch (e) {
      const pk = describePasskeyError(e);
      if (pk.cancelled || (e as ApiError)?.code === "reauth_required") { toast("Not imported", { description: "The passkey confirmation was cancelled. The preview is still here." }); return; }
      // the job record holds the error and can be retried from the list below; the preview is no longer valid
      if ((e as ApiError)?.status === 0) toast("The connection was lost", { description: "The import may still be running on the server — the list below shows its real state.", tone: "danger" });
      else toast("Import failed", { description: errText(e), tone: "danger" });
      setPending(null); refreshJobs();
    } finally { setConfirming(false); }
  }
  async function cancelPreview() { const p = pending; setPending(null); if (p) await api(`/api/import?jobId=${p.jobId}`, { method: "DELETE" }).catch(() => {}); }
  async function act(j: Job, what: "retry" | "cancel" | "dismiss") {
    if (acting) return; setActing(j.jobId);
    try { if (what === "retry") await withFreshAuth(() => api(`/api/import?retry=${j.jobId}`, { method: "POST", timeoutMs: 310_000 })); else await api(`/api/import?jobId=${j.jobId}`, { method: "DELETE" }); if (what === "cancel") toast("Import cancelled", { description: "What was already imported is kept." }); }
    catch (e) { if (what !== "retry" || (e as ApiError)?.status === 0 || (e as ApiError)?.code === "missing_upload") toast(what === "retry" ? "Could not retry" : what === "cancel" ? "Could not cancel" : "Could not dismiss", { description: errText(e), tone: "danger" }); }
    finally { setActing(null); refreshJobs(); if (what === "retry") qc.invalidateQueries({ queryKey: ["tree"] }); }
  }
  const pick = () => inputRef.current?.click();
  const onFiles = (list: FileList | null) => { const files = Array.from(list ?? []); if (!files.length) return; if (files.length > 1) toast("One file at a time", { description: `Importing “${files[0].name}”. To import many files together, put them in a ZIP.` }); void choose(files[0]); };
  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      {!pending && (
        <div onDragOver={touch ? undefined : (e) => { e.preventDefault(); setDrag(true); }} onDragLeave={touch ? undefined : () => setDrag(false)} onDrop={touch ? undefined : (e) => { e.preventDefault(); setDrag(false); if (!busy) onFiles(e.dataTransfer.files); }}
          className={cn("rounded-lg", !touch && "border border-dashed p-4 text-center", !touch && (drag ? "border-accent bg-accent-soft" : "border-line bg-bg"))}>
          <TBtn onClick={pick} disabled={busy || !online} className="h-12 w-full text-[15px] md:h-9 md:w-auto md:text-[13px]"><FileUp /> Choose a file to import</TBtn>
          <p className="mt-2 text-[12.5px] leading-snug text-fg-muted">{touch ? "" : "…or drop it here. "}Markdown · Notion or Obsidian ZIP · DOCX · PDF · CSV → database · BibTeX → references · JSON backup. Up to 500 MB. You see a preview before anything is created.</p>
          {!online && <p className="mt-1 text-[12.5px] text-fg-muted" role="status">You are offline — importing needs the server.</p>}
        </div>
      )}
      {up && (
        <div className="rounded-lg border border-line bg-bg p-3 text-[13px]" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate font-medium">{up.file.name}</span><span className="shrink-0 tabular-nums text-fg-muted">{up.state === "uploading" ? `${Math.round(up.progress * 100)} %` : up.state === "analysing" ? "analysing…" : "not imported"}</span></div>
          {up.state !== "failed" ? <><Bar value={up.state === "uploading" ? up.progress : null} label={`Uploading ${up.file.name}`} /><div className="mt-1 text-[12.5px] text-fg-muted">{up.state === "uploading" ? `Uploading ${fmtBytes(up.file.size)} — nothing is imported yet.` : "Checking the file and looking for duplicates — nothing is imported yet."}</div><TBtn variant="outline" className="mt-2" onClick={() => abort.current?.abort()}><X /> Cancel</TBtn></>
            : <><p className="mt-1 break-words text-danger-text" role="alert">{up.error}</p><div className="mt-2 flex flex-wrap gap-2">{up.retryable && <TBtn onClick={() => choose(up.file)}><RotateCw /> Retry</TBtn>}<TBtn variant="outline" onClick={pick}>Choose another file</TBtn><TBtn variant="ghost" onClick={() => setUp(null)}>Dismiss</TBtn></div></>}
        </div>
      )}
      {pending && <PreviewCard file={pending.file} p={pending.preview} mode={mode} setMode={setMode} busy={confirming} onConfirm={confirm} onCancel={cancelPreview} />}
      {jobsQ.isError && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-[13px]" role="alert"><span className="min-w-0 flex-1">Could not load the state of your imports. {errText(jobsQ.error)}</span><TBtn variant="outline" onClick={() => jobsQ.refetch()}><RotateCw /> Retry</TBtn></div>}
      {jobs.length > 0 && <div><h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint">Imports</h4><ul className="space-y-2">{jobs.map((j) => <JobCard key={j.jobId} j={j} busy={acting === j.jobId} onRetry={() => act(j, "retry")} onCancel={() => act(j, "cancel")} onDismiss={() => act(j, "dismiss")} />)}</ul></div>}
    </div>
  );
}

// ------------------------------------------------------------------ backups
function BackupsBlock() {
  const qc = useQueryClient(); const online = useOnline();
  const q = useQuery<BackupsResp>({ queryKey: ["backups"], queryFn: () => api("/api/backups"), retry: false, refetchInterval: (query) => (query.state.data?.jobs?.some((j) => j.status === "running" || j.status === "queued") ? 4000 : false) });
  const [running, setRunning] = React.useState(false); const [verifying, setVerifying] = React.useState<string | null>(null);
  const run = async () => { setRunning(true); try { await withFreshAuth(() => api("/api/backups", { method: "POST", json: { action: "run" } })); toast("Backup queued", { description: "The worker runs the backup; this list refreshes by itself." }); qc.invalidateQueries({ queryKey: ["backups"] }); } catch (e) { const d = describePasskeyError(e); toast(d.cancelled ? "Backup not started" : "Could not start the backup", { tone: d.cancelled ? "neutral" : "danger", description: d.cancelled ? d.message : errText(e), ...(d.cancelled ? {} : { action: { label: "Retry", run } }) }); } finally { setRunning(false); } };
  const verify = async (id: string) => { setVerifying(id); try { const r = await api<any>("/api/backups", { method: "POST", json: { action: "verify", id } }); toast(r.ok ? "Archive verified" : "Verification failed", { tone: r.ok ? "success" : "danger", description: r.ok ? `${fmtBytes(r.size)} · sha256 matches` : r.reason ?? (r.exists ? "sha256 or size mismatch" : "the archive is missing") }); } catch (e) { toast("Could not verify", { tone: "danger", description: errText(e), action: { label: "Retry", run: () => verify(id) } }); } finally { setVerifying(null); } };
  const d = q.data; const jobs = d?.jobs ?? [];
  const tone = (s: string) => (s === "ok" ? "success" : s === "failed" ? "danger" : s === "running" || s === "queued" ? "accent" : "neutral") as "success" | "danger" | "accent" | "neutral";
  const stat = "rounded-lg border border-line bg-bg p-3 text-[13px]";
  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-3">
        <div className={stat}><div className="text-[12px] text-fg-faint">Last successful backup</div><div className="font-medium">{d?.lastOk ? `${timeAgo(d.lastOk.finishedAt ?? d.lastOk.startedAt)} · ${fmtBytes(d.lastOk.sizeBytes)}` : q.isLoading ? <Skeleton className="mt-1 h-4 w-24" /> : "never"}</div></div>
        <div className={stat}><div className="text-[12px] text-fg-faint">Schedule</div><div className="font-medium">{d?.config.schedule ?? (q.isLoading ? <Skeleton className="mt-1 h-4 w-24" /> : "–")}</div>{d && <div className="text-fg-muted">kept {d.config.keepDays ?? 30} days</div>}</div>
        <div className={stat}><div className="text-[12px] text-fg-faint">Off-site copy</div><div className="break-words font-medium">{d ? d.config.offsite ?? "not configured" : q.isLoading ? <Skeleton className="mt-1 h-4 w-24" /> : "–"}</div>{d && !d.config.passphraseSet && <div className="text-danger-text">BACKUP_PASSPHRASE is missing: backups cannot be encrypted</div>}</div>
      </div>
      {q.isError ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-[13px]" role="alert"><span className="min-w-0 flex-1">Could not load the backups. {errText(q.error)}</span><TBtn variant="outline" onClick={() => q.refetch()}><RotateCw /> Retry</TBtn></div>
        : q.isLoading ? <div className="space-y-2" role="status" aria-label="Loading backups"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        : jobs.length === 0 ? <div className="rounded-lg border border-dashed border-line p-4 text-center text-[13px] text-fg-muted">No backup yet. Run one now — it takes a few minutes.</div> : (
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li key={j.id} className="rounded-lg border border-line bg-bg p-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium tabular-nums">{fmtDate(j.startedAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                <Badge tone={tone(j.status)}>{j.status}</Badge>
                <span className="tabular-nums text-fg-muted">{fmtBytes(j.sizeBytes)}</span>
                <span className={cn("inline-flex items-center gap-1 text-[12.5px]", j.offsite ? "text-success-text" : "text-fg-muted")}><HardDrive className="size-3.5" aria-hidden />{j.offsite ? "copied off-site and verified" : "local copy only"}</span>
              </div>
              {j.error ? <p className="mt-1 break-words text-danger-text">{j.error}</p> : j.path && <p className="mt-1 break-all font-mono text-[11.5px] text-fg-faint">{j.path.split("/").pop()}</p>}
              {j.status === "ok" && j.path && <TBtn variant="outline" className="mt-2" disabled={verifying === j.id || !online} onClick={() => verify(j.id)}>{verifying === j.id ? <Spinner className="size-3.5" /> : <ShieldCheck />} Verify the archive</TBtn>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <TBtn onClick={run} disabled={running || !online || q.isError || jobs.some((j) => j.status === "running" || j.status === "queued")}>{running ? <Spinner className="size-3.5 border-t-white" /> : <Play />} Run a backup now</TBtn>
        <TBtn variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={cn(q.isFetching && "animate-spin")} /> Refresh</TBtn>
      </div>
      <p className="text-[12.5px] leading-snug text-fg-faint">Database dump + uploads → AES-256 → sha256 → off-site copy. Restore test: <code className="break-all rounded bg-bg-sunk px-1">scripts/restore.sh --latest --verify-only</code> (docs/operations.md).</p>
    </div>
  );
}

export function DataSection() {
  return (
    <div className="min-w-0 space-y-4">
      <Section icon={<Download />} title="Export" hint="Your data in open formats — Markdown, CSV, BibTeX, JSON.">
        <ExportBlock />
      </Section>
      <Section icon={<Upload />} title="Import" hint="A preview shows what would be created before anything is. Large files continue in the background; you can leave this screen.">
        <ImportBlock />
      </Section>
      <Section icon={<Database />} title="Backups" hint="Nightly encrypted backup of the database and uploads, with an off-site copy.">
        <BackupsBlock />
      </Section>
    </div>
  );
}
