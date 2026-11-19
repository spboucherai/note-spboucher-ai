"use client";
/**
 * Detail of one reference in a sheet: citation actions, PDF (attach with real progress + cancel; open / download / share),
 * extracts (quote, page, personal note → "Insert as citation"), and its links to pages and experiments.
 */
import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, ChevronRight, Copy, ExternalLink, FileText, FlaskConical, Paperclip, Pencil, Plus, Quote, ShieldCheck, TextQuote, Trash2, Unlink, X, Highlighter } from "lucide-react";
import { api } from "@/lib/client/api";
import { useOnline } from "@/lib/client/hooks";
import { uploadFile } from "@/lib/client/upload";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Dialog, SheetContent, Skeleton, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { extractMarkdown, extractsOf, formatCitation, shortLabel, EXTRACT_LIMITS, type Extract } from "@/lib/research/cite";
import { AREA, Confirm, ErrorBox, FIELD, Field, IconBtn, Select, TButton, VerifiedBadge, copy, errText, fmtBytes, insertMarkdown, useDraft, EXP_TONE } from "./ui";
import { FileActions } from "./FileActions";
import { cn } from "@/lib/utils";

type Ref = any;
type Links = { attached: { id: string; title: string; icon: string | null; type: string } | null; citing: { id: string; title: string; icon: string | null; type: string }[]; experiments: { id: string; name: string; status: string; pageId: string | null; pageTitle: string | null }[]; pdf: { id: string; filename: string; size: number; pageCount: number | null; mime: string; available: boolean } | null };
export const refKey = (id: string) => ["research-ref", id];
const linksKey = (id: string) => ["research-ref-links", id];
const Section = ({ icon, title, count, children }: { icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }) => (
  <section className="border-t border-line py-3"><h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-muted [&_svg]:size-3.5">{icon}{title}{count != null && <span className="font-normal text-fg-faint">{count}</span>}</h3>{children}</section>
);

export function ReferenceSheet({ refId, pageId, onClose, onEdit, onChanged }: { refId: string | null; /** page whose editor receives "Insert as citation" (null outside a page) */ pageId: string | null; onClose: () => void; onEdit: (r: Ref) => void; onChanged: () => void }) {
  return <Dialog open={refId !== null} onOpenChange={(o) => { if (!o) onClose(); }}><SheetContent title="Reference" className="sm:w-[min(40rem,calc(100vw-2rem))]">{refId && <Body key={refId} refId={refId} pageId={pageId} onClose={onClose} onEdit={onEdit} onChanged={onChanged} />}</SheetContent></Dialog>;
}

function Body({ refId, pageId, onClose, onEdit, onChanged }: { refId: string; pageId: string | null; onClose: () => void; onEdit: (r: Ref) => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const q = useQuery<Ref>({ queryKey: refKey(refId), queryFn: () => api(`/api/research/references/${refId}`) });
  const links = useQuery<Links>({ queryKey: linksKey(refId), queryFn: () => api(`/api/research/references/${refId}/links`) });
  const [verifying, setVerifying] = React.useState(false); const [confirmDelete, setConfirmDelete] = React.useState(false);
  const r = q.data;
  const changed = (next?: Ref) => { if (next) qc.setQueryData(refKey(refId), next); else qc.invalidateQueries({ queryKey: refKey(refId) }); qc.invalidateQueries({ queryKey: linksKey(refId) }); onChanged(); };
  if (q.isLoading) return <div className="space-y-3 py-2" role="status" aria-label="Loading reference"><Skeleton className="h-5 w-4/5" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-11 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (q.isError || !r) return <ErrorBox title="Could not load this reference" message={errText(q.error)} onRetry={() => q.refetch()} />;
  async function verify() { setVerifying(true); try { changed(await api(`/api/research/references/${refId}?action=verify`, { method: "POST" })); toast("Verified with Crossref", { tone: "success", description: "Missing fields were filled; nothing you entered was changed." }); } catch (e: any) { toast(e.code === "doi_not_found" ? "Crossref does not know this DOI" : "Verification did not go through", { description: errText(e), tone: "danger", ...(e.code === "doi_not_found" ? {} : { action: { label: "Retry", run: verify } }) }); } finally { setVerifying(false); } }
  async function del() {
    try { await api(`/api/research/references/${refId}`, { method: "DELETE" }); setConfirmDelete(false); onChanged(); onClose(); toast(`Reference ${r.citeKey} deleted`, { action: { label: "Undo", run: async () => { try { await api(`/api/research/references/${refId}?action=restore`, { method: "POST" }); onChanged(); toast("Reference restored", { tone: "success" }); } catch (e) { toast("Could not restore", { description: errText(e), tone: "danger" }); } } } }); }
    catch (e) { toast("Could not delete", { description: errText(e), tone: "danger" }); }
  }
  const known = new Set(["author", "editor", "title", "year", "journal", "journaltitle", "booktitle", "publisher", "institution", "school", "doi", "url", "volume", "number", "pages", "abstract", "extracts"]);
  const extra = Object.keys(r.fields ?? {}).filter((k) => !known.has(k));
  const abstract = typeof r.fields?.abstract === "string" ? r.fields.abstract : "";
  return (
    <div className="min-w-0">
      <div className="pb-3">
        <div className="text-[15px] font-semibold leading-snug">{r.title}</div>
        <div className="mt-1 text-[13px] text-fg-muted">{(r.authors ?? []).join(", ") || "No author"} · {r.year ?? "n.d."}{r.journal ? ` · ${r.journal}` : ""}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="rounded bg-bg-sunk px-1.5 py-0.5 font-mono text-[12px] text-accent">{r.citeKey}</span><VerifiedBadge v={r.verified} /><Badge tone="neutral">{r.entryType}</Badge>{extra.length > 0 && <span className="text-[11px] text-fg-faint" title={extra.join(", ")}>+ {extra.length} more BibTeX field{extra.length > 1 ? "s" : ""} kept</span>}</div>
        {abstract && <details className="mt-2 text-[13px]"><summary className={cn("flex cursor-pointer items-center text-fg-muted", TAP_ROW)}>Abstract</summary><p className="leading-relaxed text-fg-muted">{abstract}</p></details>}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <TButton variant="outline" onClick={() => copy(formatCitation(r), "Citation copied")}><Quote /> Copy citation</TButton>
          <TButton variant="outline" onClick={() => copy(`\\cite{${r.citeKey}}`, `\\cite{${r.citeKey}} copied`)}><Copy /> {"\\cite{…}"}</TButton>
          <TButton variant="outline" onClick={() => copy(r.bibtex ?? "", "BibTeX copied")} disabled={!r.bibtex}><Copy /> BibTeX</TButton>
          {r.doi && <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-line bg-bg-elev px-3 text-[13px] font-medium hover:bg-bg-sunk md:h-8 [&_svg]:size-4"><ExternalLink /> Open DOI</a>}
          {r.doi && r.verified !== "doi_verified" && <TButton variant="outline" onClick={verify} disabled={verifying}>{verifying ? <Spinner className="size-3.5" /> : <ShieldCheck />} Verify</TButton>}
          <TButton variant="outline" onClick={() => onEdit(r)}><Pencil /> Edit</TButton>
        </div>
        <p className="mt-2 break-words text-[12px] leading-snug text-fg-faint">{formatCitation(r)}</p>
      </div>
      <PdfSection r={r} pdf={links.data?.pdf ?? null} loading={links.isLoading} pageId={pageId} onChanged={changed} />
      <ExtractsSection r={r} canInsert={Boolean(pageId)} onChanged={changed} />
      <Section icon={<BookMarked />} title="Linked pages and experiments">
        {links.isLoading ? <div className="space-y-2" role="status" aria-label="Loading links"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /></div> : links.isError ? <ErrorBox className="mt-0" title="Could not load the links" message={errText(links.error)} onRetry={() => links.refetch()} /> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {links.data!.attached && <LinkRow href={`/p/${links.data!.attached.id}`} icon={links.data!.attached.icon ?? "🔬"} title={links.data!.attached.title} hint="This reference belongs to this page" onNavigate={onClose} />}
            {links.data!.citing.map((p) => <LinkRow key={p.id} href={`/p/${p.id}`} icon={p.icon ?? "📄"} title={p.title} hint={`Cites ${r.citeKey}`} onNavigate={onClose} />)}
            {links.data!.experiments.map((e) => <LinkRow key={e.id} href={e.pageId ? `/p/${e.pageId}` : "/research"} icon={<FlaskConical className="size-4 text-fg-muted" />} title={e.name} hint={`Experiment${e.pageTitle ? ` of ${e.pageTitle}` : ""}`} badge={<Badge tone={EXP_TONE[e.status] ?? "neutral"}>{e.status}</Badge>} onNavigate={() => { if (e.pageId) { try { localStorage.setItem(`research-tab-${e.pageId}`, "experiments"); localStorage.setItem("research-panel-open", "1"); } catch {} } onClose(); }} />)}
            {!links.data!.attached && !links.data!.citing.length && !links.data!.experiments.length && <li className="p-3 text-[13px] text-fg-muted">Not linked to a page yet. Write <code className="font-mono">\cite{"{"}{r.citeKey}{"}"}</code> in a page, or add the reference from a working paper, and it appears here.</li>}
          </ul>
        )}
      </Section>
      <div className="border-t border-line pt-3"><TButton variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirmDelete(true)}><Trash2 /> Delete reference</TButton></div>
      <Confirm open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${r.citeKey}?`} description={<>The reference and its {extractsOf(r.fields).length} extract(s) leave your library. Its PDF stays in the page files. You can undo right after.</>} confirmLabel="Delete" danger onConfirm={del} />
    </div>
  );
}
const TAP_ROW = "min-h-11";
function LinkRow({ href, icon, title, hint, badge, onNavigate }: { href: string; icon: React.ReactNode; title: string; hint: string; badge?: React.ReactNode; onNavigate: () => void }) {
  return <li><Link href={href} onClick={onNavigate} className="flex min-h-12 items-center gap-2.5 px-3 py-1.5 hover:bg-bg-sunk"><span className="grid w-5 shrink-0 place-items-center text-[15px] leading-none">{icon}</span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{title}</span><span className="block truncate text-[12px] text-fg-muted">{hint}</span></span>{badge}<ChevronRight className="size-4 shrink-0 text-fg-faint" /></Link></li>;
}

/** PDF of a reference: attach (upload with progress + cancel, or pick a file of the page), open / download / share, detach. */
function PdfSection({ r, pdf, loading, pageId, onChanged }: { r: Ref; pdf: Links["pdf"]; loading: boolean; pageId: string | null; onChanged: (next?: Ref) => void }) {
  const qc = useQueryClient(); const online = useOnline();
  const input = React.useRef<HTMLInputElement>(null); const abort = React.useRef<AbortController | null>(null);
  const [up, setUp] = React.useState<{ file: File; progress: number; state: "uploading" | "saving" | "failed"; error?: string } | null>(null);
  const filesPage = r.pageId ?? pageId;
  const pageFiles = useQuery<any[]>({ queryKey: ["attachments", filesPage], queryFn: () => api(`/api/attachments?pageId=${filesPage}`), enabled: Boolean(filesPage) });
  const pdfs = (pageFiles.data ?? []).filter((f) => (f.mime === "application/pdf" || /\.pdf$/i.test(f.filename)) && f.id !== r.attachmentId);
  React.useEffect(() => () => abort.current?.abort(), []);
  async function link(attachmentId: string | null) { const next = await api(`/api/research/references/${r.id}?action=attach`, { method: "POST", json: { attachmentId } }); if (filesPage) qc.invalidateQueries({ queryKey: ["attachments", filesPage] }); onChanged(next); }
  async function start(file: File) {
    // cheap checks before spending the upload: the server checks again
    if (file.size > 200 * 1024 * 1024) { setUp({ file, progress: 0, state: "failed", error: `This file is ${fmtBytes(file.size)}; the limit is 200 MB.` }); return; }
    const head = await file.slice(0, 1024).text().catch(() => ""); if (!head.includes("%PDF-")) { setUp({ file, progress: 0, state: "failed", error: "This file is not a PDF (its content does not start like one). Choose the PDF of the paper." }); return; }
    abort.current = new AbortController(); setUp({ file, progress: 0, state: "uploading" });
    try {
      const a = await uploadFile(file, filesPage, { signal: abort.current.signal, onProgress: (f) => setUp((u) => (u && u.file === file ? { ...u, progress: f } : u)) });
      setUp((u) => (u ? { ...u, progress: 1, state: "saving" } : u));
      await link(a.id); setUp(null); toast("PDF attached", { tone: "success", description: file.name });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") { setUp(null); toast("Upload cancelled", { description: "Nothing was attached." }); return; }
      setUp({ file, progress: 0, state: "failed", error: errText(e) });
    }
  }
  async function detach() { try { await link(null); toast("PDF detached", { description: "The file stays in the page files.", action: pdf ? { label: "Undo", run: async () => { try { await link(pdf.id); } catch (e) { toast("Could not re-attach", { description: errText(e), tone: "danger" }); } } } : undefined }); } catch (e) { toast("Could not detach", { description: errText(e), tone: "danger" }); } }
  return (
    <Section icon={<FileText />} title="PDF">
      <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void start(f); }} />
      {loading && r.attachmentId ? <Skeleton className="h-16 w-full" /> : pdf ? (
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-start gap-2"><FileText className="mt-0.5 size-5 shrink-0 text-fg-muted" /><div className="min-w-0 flex-1"><div className="break-words text-[13px] font-medium">{pdf.filename}</div><div className="text-[12px] text-fg-muted">{fmtBytes(pdf.size)}{pdf.pageCount != null ? ` · ${pdf.pageCount} page${pdf.pageCount === 1 ? "" : "s"}` : " · page count unknown"}</div></div></div>
          {pdf.available ? <FileActions id={pdf.id} filename={pdf.filename} mime={pdf.mime} size={pdf.size} primaryOpen className="mt-3" /> : <ErrorBox title="The file is missing on the server" message="The reference still points to it, but it cannot be opened. Attach the PDF again." className="mt-3"><TButton variant="outline" onClick={() => input.current?.click()}><Paperclip /> Replace</TButton></ErrorBox>}
          {pageId && pdf.available && <TButton variant="outline" className="mt-2 justify-start" onClick={() => { window.dispatchEvent(new CustomEvent("note:insert-markdown", { detail: { markdown: " ", plain: true, nodes: [{ type: "pdf", attrs: { attachmentId: pdf.id, name: pdf.filename, page: 1, annotations: [] } }] } })); }}><Highlighter /> Annotate in this page</TButton>}
          {pageId && pdf.available && <p className="mt-1 text-[12px] text-fg-faint">Adds the PDF as a block at the end of the page; what you highlight there is saved as extracts of this reference.</p>}
          <div className="mt-2 flex flex-wrap gap-2"><TButton variant="ghost" onClick={() => input.current?.click()} disabled={!!up}><Paperclip /> Replace</TButton><TButton variant="ghost" onClick={detach}><Unlink /> Detach</TButton></div>
        </div>
      ) : r.attachmentId && !loading ? <ErrorBox className="mt-0" title="The attached file no longer exists" message="It was deleted from the page files."><TButton variant="outline" onClick={() => input.current?.click()}><Paperclip /> Attach again</TButton></ErrorBox> : !up && (
        <div className="flex flex-col gap-2">
          <TButton variant="outline" className="justify-start" onClick={() => input.current?.click()} disabled={!online}><Paperclip /> Attach a PDF</TButton>
          {!online && <p className="text-[12px] text-fg-muted">You are offline. A PDF can be attached when the connection is back.</p>}
          {pdfs.length > 0 && <Field label="Or use a PDF already on this page"><Select value="" onChange={async (e) => { if (!e.target.value) return; try { await link(e.target.value); toast("PDF attached", { tone: "success" }); } catch (err) { toast("Could not attach", { description: errText(err), tone: "danger" }); } }}><option value="">Choose a file…</option>{pdfs.map((f) => <option key={f.id} value={f.id}>{f.filename}</option>)}</Select></Field>}
        </div>
      )}
      {up && (
        <div className="mt-2 rounded-lg border border-line p-3 text-[13px]" role="status" aria-live="polite">
          <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{up.file.name}</span><span className="shrink-0 tabular-nums text-fg-muted">{up.state === "failed" ? "failed" : up.state === "saving" ? "saving…" : `${Math.round(up.progress * 100)} %`}</span></div>
          {up.state !== "failed" && <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-sunk" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(up.progress * 100)} aria-label={`Uploading ${up.file.name}`}><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(2, Math.round(up.progress * 100))}%` }} /></div>}
          {up.state === "failed" && <div className="mt-1 break-words text-danger-text">{up.error}</div>}
          <div className="mt-2 flex flex-wrap gap-2">{up.state === "uploading" && <TButton variant="outline" onClick={() => abort.current?.abort()}><X /> Cancel upload</TButton>}{up.state === "failed" && <><TButton onClick={() => start(up.file)}>Retry</TButton><TButton variant="outline" onClick={() => input.current?.click()}>Choose another file</TButton><TButton variant="ghost" onClick={() => setUp(null)}>Dismiss</TButton></>}</div>
        </div>
      )}
    </Section>
  );
}

/** Quoted extracts with page number and personal note. The form keeps its draft while the sheet is closed and after an error. */
function ExtractsSection({ r, canInsert, onChanged }: { r: Ref; canInsert: boolean; onChanged: (next?: Ref) => void }) {
  const online = useOnline(); const list = extractsOf(r.fields);
  const empty = { open: false, id: "", quote: "", page: "", note: "" };
  const [d, setD, clear] = useDraft(`extract:${r.id}`, empty); const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState<string | null>(null);
  const url = `/api/research/references/${r.id}/extracts`;
  const apply = (extracts: Extract[]) => onChanged({ ...r, fields: { ...(r.fields ?? {}), extracts } });
  async function save() {
    if (!d.quote.trim() || busy) return; setBusy(true); setError(null);
    try {
      const body = { quote: d.quote.trim(), page: d.page.trim() || null, note: d.note.trim() || null };
      // the id is chosen here once: a retry after a timeout updates the same extract instead of adding a second one
      const id = d.id || (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : ""); if (id && !d.id) setD({ ...d, id });
      const res = d.id && list.some((e) => e.id === d.id) ? await api(url, { method: "PATCH", json: { id: d.id, ...body } }) : await api(url, { method: "POST", json: { ...(id ? { id } : {}), ...body } });
      apply(res.extracts); clear(); toast("Extract saved", { tone: "success" });
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  async function del(e: Extract) {
    try { const res = await api(`${url}?extractId=${e.id}`, { method: "DELETE" }); apply(res.extracts); toast("Extract deleted", { action: { label: "Undo", run: async () => { try { const back = await api(`${url}?restore=1`, { method: "POST", json: { extract: e } }); apply(back.extracts); } catch (err) { toast("Could not restore the extract", { description: errText(err), tone: "danger" }); } } } }); }
    catch (err) { toast("Could not delete the extract", { description: errText(err), tone: "danger" }); }
  }
  const editing = Boolean(d.id && list.some((e) => e.id === d.id));
  return (
    <Section icon={<TextQuote />} title="Extracts" count={list.length}>
      {!list.length && !d.open && <p className="mb-2 text-[13px] text-fg-muted">Save the passages you want to quote, with their page number and your own note.</p>}
      <ul className="space-y-2">{list.map((e) => (
        <li key={e.id} className={cn("rounded-lg border border-line p-3", d.id === e.id && d.open && "border-accent/50")}>
          <blockquote className="whitespace-pre-wrap break-words border-l-2 border-line-strong pl-2.5 text-[13.5px] leading-relaxed">{e.quote}</blockquote>
          <div className="mt-1.5 text-[12px] text-fg-muted">{shortLabel(r)}{e.page ? `, p. ${e.page}` : ""}</div>
          {e.note && <p className="mt-1.5 whitespace-pre-wrap break-words rounded-md bg-bg-sunk px-2 py-1.5 text-[13px]"><span className="text-fg-faint">Note — </span>{e.note}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {canInsert ? <TButton variant="outline" onClick={() => insertMarkdown(extractMarkdown(r, e))}><Quote /> Insert as citation</TButton> : <TButton variant="outline" onClick={() => copy(extractMarkdown(r, e), "Quote copied as Markdown")}><Copy /> Copy quote</TButton>}
            {canInsert && <IconBtn label="Copy quote as Markdown" onClick={() => copy(extractMarkdown(r, e), "Quote copied as Markdown")}><Copy /></IconBtn>}
            <IconBtn label="Edit extract" onClick={() => { setError(null); setD({ open: true, id: e.id, quote: e.quote, page: e.page ?? "", note: e.note ?? "" }); }}><Pencil /></IconBtn>
            <IconBtn label="Delete extract" danger onClick={() => del(e)}><Trash2 /></IconBtn>
          </div>
        </li>))}</ul>
      {d.open ? (
        <div className="mt-2 space-y-2 rounded-lg border border-line bg-bg p-3">
          <Field label={editing ? "Edit quote" : "Quote"} hint={`${d.quote.length} / ${EXTRACT_LIMITS.quote}`}><Textarea value={d.quote} maxLength={EXTRACT_LIMITS.quote} onChange={(e) => setD({ ...d, quote: e.target.value })} placeholder="Paste or type the passage, exactly as printed" className={cn(AREA, "min-h-[96px]")} /></Field>
          <div className="grid grid-cols-[7rem_1fr] gap-2"><Field label="Page"><Input value={d.page} maxLength={EXTRACT_LIMITS.page} onChange={(e) => setD({ ...d, page: e.target.value })} placeholder="12–13" autoCapitalize="none" className={FIELD} /></Field><Field label="Your note"><Input value={d.note} maxLength={EXTRACT_LIMITS.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="Why it matters" className={FIELD} /></Field></div>
          {error && <ErrorBox className="mt-0" title="Not saved — your text is still here" message={error} onRetry={save} />}
          {!online && <p className="text-[12px] text-fg-muted">You are offline. The text stays in this form on this device; save it when the connection is back.</p>}
          <div className="flex flex-wrap justify-end gap-2"><TButton variant="ghost" onClick={() => { setError(null); clear(); }}>Discard</TButton><TButton onClick={save} disabled={busy || !d.quote.trim() || !online}>{busy ? <Spinner className="size-3.5 border-t-white" /> : null} {editing ? "Save changes" : "Save extract"}</TButton></div>
        </div>
      ) : <TButton variant="outline" className="mt-2" onClick={() => setD({ ...d, open: true })}><Plus /> {d.quote ? "Continue the draft" : "Add an extract"}</TButton>}
      {canInsert && list.length > 0 && <p className="mt-2 text-[12px] text-fg-faint">“Insert as citation” adds the quote and <span className="font-mono">({r.citeKey}, p. N)</span> at the end of this page.</p>}
    </Section>
  );
}
