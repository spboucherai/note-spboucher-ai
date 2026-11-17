"use client";
/**
 * "Add reference" sheet — by DOI (Crossref), by pasting/choosing BibTeX, or by hand — and the edit form.
 * Every step says what is happening; duplicates are explained before anything is created; errors keep the draft and say whether a retry
 * can help (Crossref unreachable) or not (unknown DOI, unreadable BibTeX).
 */
import * as React from "react";
import { ClipboardPaste, FileUp, Search, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useOnline } from "@/lib/client/hooks";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Dialog, SheetContent, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { AREA, ErrorBox, FIELD, Field, Select, TButton, errText, useDraft } from "./ui";
import { cn } from "@/lib/utils";

const ENTRY_TYPES = ["article", "book", "incollection", "inproceedings", "techreport", "phdthesis", "mastersthesis", "unpublished", "misc"];
type Ref = any;
type Mode = "doi" | "bibtex" | "manual";
export interface ManualDraft { citeKey: string; entryType: string; title: string; authors: string; year: string; journal: string; doi: string; url: string; volume: string; number: string; pages: string; abstract: string }
const emptyManual: ManualDraft = { citeKey: "", entryType: "article", title: "", authors: "", year: "", journal: "", doi: "", url: "", volume: "", number: "", pages: "", abstract: "" };
const fromRef = (r: Ref): ManualDraft => { const f = r.fields ?? {}; const s = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : ""); return { citeKey: r.citeKey ?? "", entryType: r.entryType ?? "article", title: r.title ?? "", authors: (r.authors ?? []).join("\n"), year: r.year ? String(r.year) : "", journal: r.journal ?? "", doi: r.doi ?? "", url: r.url ?? "", volume: s(f.volume), number: s(f.number), pages: s(f.pages), abstract: s(f.abstract) }; };

export function AddReferenceSheet({ open, onOpenChange, pageId, onDone, onOpenRef }: { open: boolean; onOpenChange: (o: boolean) => void; pageId: string | null; onDone: () => void; onOpenRef: (id: string) => void }) {
  const [mode, setMode] = useDraft<{ m: Mode }>(`addref-mode:${pageId ?? "library"}`, { m: "doi" });
  const [manual, setManual, clearManual] = useDraft<ManualDraft>(`addref-manual:${pageId ?? "library"}`, emptyManual);
  const tabs: { id: Mode; label: string }[] = [{ id: "doi", label: "DOI" }, { id: "bibtex", label: "BibTeX" }, { id: "manual", label: "Manual" }];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><SheetContent title="Add a reference" description="Nothing is duplicated: a DOI or cite key already in your library is recognised first.">
      <div role="tablist" aria-label="How to add" className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-bg-sunk p-1">{tabs.map((t) => <button key={t.id} role="tab" type="button" aria-selected={mode.m === t.id} onClick={() => setMode({ m: t.id })} className={cn("h-11 rounded-md text-[14px] font-medium md:h-8 md:text-[13px]", mode.m === t.id ? "bg-bg-elev text-fg shadow-card" : "text-fg-muted")}>{t.label}</button>)}</div>
      {mode.m === "doi" && <DoiPane pageId={pageId} onDone={() => { onDone(); onOpenChange(false); }} onOpenRef={(id) => { onOpenChange(false); onOpenRef(id); }} toManual={(doi) => { setManual({ ...manual, doi }); setMode({ m: "manual" }); }} toBibtex={() => setMode({ m: "bibtex" })} />}
      {mode.m === "bibtex" && <BibtexPane pageId={pageId} onDone={onDone} onClose={() => onOpenChange(false)} />}
      {mode.m === "manual" && <RefForm pageId={pageId} initial={null} v={manual} setV={setManual} onCancel={() => onOpenChange(false)} onDone={() => { clearManual(); onDone(); onOpenChange(false); }} />}
    </SheetContent></Dialog>
  );
}
export function EditReferenceSheet({ reference, onClose, onDone }: { reference: Ref | null; onClose: () => void; onDone: (r: Ref) => void }) {
  return <Dialog open={reference !== null} onOpenChange={(o) => { if (!o) onClose(); }}><SheetContent title="Edit reference" description="Only what you change is rewritten; every other BibTeX field is kept as imported.">{reference && <EditBody key={reference.id} reference={reference} onClose={onClose} onDone={onDone} />}</SheetContent></Dialog>;
}
function EditBody({ reference, onClose, onDone }: { reference: Ref; onClose: () => void; onDone: (r: Ref) => void }) {
  const [v, setV, clear] = useDraft<ManualDraft>(`editref:${reference.id}`, fromRef(reference));
  return <RefForm pageId={reference.pageId ?? null} initial={reference} v={v} setV={setV} onCancel={() => { clear(); onClose(); }} onDone={(r) => { clear(); onDone(r); }} />;
}

type DoiPreview = { doi: string; title: string; authors: string[]; year: number | null; journal: string | null; entryType: string; citeKey: string; duplicate: { id: string; citeKey: string; title: string; pageId: string | null } | null };
function DoiPane({ pageId, onDone, onOpenRef, toManual, toBibtex }: { pageId: string | null; onDone: () => void; onOpenRef: (id: string) => void; toManual: (doi: string) => void; toBibtex: () => void }) {
  const online = useOnline();
  const [d, setD, clear] = useDraft(`addref-doi:${pageId ?? "library"}`, { doi: "" });
  const [phase, setPhase] = React.useState<"idle" | "looking" | "adding">("idle"); const [preview, setPreview] = React.useState<DoiPreview | null>(null);
  const [err, setErr] = React.useState<{ code?: string; message: string; retry: "lookup" | "add" } | null>(null);
  const doi = d.doi.trim(); const canPaste = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);
  const fail = (e: any, retry: "lookup" | "add") => setErr({ code: e?.status === 0 ? "network" : e?.code, message: errText(e), retry });
  async function lookup() { if (!doi || phase !== "idle") return; setErr(null); setPreview(null); setPhase("looking"); try { setPreview(await api<DoiPreview>(`/api/research/references/doi?doi=${encodeURIComponent(doi)}`, { timeoutMs: 25_000 })); } catch (e) { fail(e, "lookup"); } finally { setPhase("idle"); } }
  async function add() {
    if (!doi || phase !== "idle") return; setErr(null); setPhase("adding");
    try { const r = await api("/api/research/references/doi", { method: "POST", json: { doi, pageId }, timeoutMs: 30_000 }); if (r.duplicate) toast(`Already in your library as ${r.citeKey}`, { description: r.linked ? "It is now attached to this page." : "Nothing was added twice." }); else toast(`Added ${r.citeKey}`, { description: r.title, tone: "success" }); clear(); setPreview(null); onDone(); }
    catch (e) { fail(e, "add"); } finally { setPhase("idle"); }
  }
  const retryable = err && (err.code === "crossref_unreachable" || err.code === "network" || !err.code);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void (preview && !preview.duplicate ? add() : lookup()); }}>
      <Field label="DOI" hint="Paste the DOI or its https://doi.org/… link.">
        <div className="flex gap-1.5"><Input value={d.doi} onChange={(e) => { setD({ doi: e.target.value }); setPreview(null); setErr(null); }} placeholder="10.1016/j.jfineco.2019.09.005" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" aria-invalid={err?.code === "invalid_doi"} className={cn(FIELD, "min-w-0 flex-1 font-mono")} />
          {canPaste && <TButton type="button" variant="outline" aria-label="Paste from the clipboard" onClick={async () => { try { const t = (await navigator.clipboard.readText()).trim(); if (t) { setD({ doi: t }); setPreview(null); setErr(null); } } catch { toast("Could not read the clipboard", { description: "Paste into the field instead." }); } }}><ClipboardPaste /><span className="hidden sm:inline">Paste</span></TButton>}</div>
      </Field>
      {!online && <p className="rounded-md bg-bg-sunk p-2.5 text-[13px] text-fg-muted" role="status">You are offline. The DOI stays in this field; look it up when the connection is back.</p>}
      {phase === "looking" && <div className="flex items-center gap-2 rounded-lg border border-line p-3 text-[13px]" role="status"><Spinner className="size-4" /> Asking Crossref for this DOI…</div>}
      {phase === "adding" && <div className="flex items-center gap-2 rounded-lg border border-line p-3 text-[13px]" role="status"><Spinner className="size-4" /> Saving the reference…</div>}
      {preview && phase !== "adding" && (
        <div className="rounded-lg border border-line p-3">
          <div className="text-[14px] font-medium leading-snug">{preview.title}</div>
          <div className="mt-0.5 text-[13px] text-fg-muted">{preview.authors.slice(0, 6).join(", ") || "No author"}{preview.authors.length > 6 ? " et al." : ""} · {preview.year ?? "n.d."}{preview.journal ? ` · ${preview.journal}` : ""}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><Badge tone="neutral">{preview.entryType}</Badge><span className="font-mono text-[12px] text-fg-muted">{preview.citeKey}</span></div>
          {preview.duplicate && <div className="mt-2 rounded-md bg-warning/10 p-2.5 text-[13px]" role="status"><b>Already in your library</b> as <span className="font-mono">{preview.duplicate.citeKey}</span> (same DOI){preview.duplicate.pageId && preview.duplicate.pageId !== pageId ? ", on another page" : ""}. Nothing will be added twice.{pageId && !preview.duplicate.pageId ? " “Use it here” attaches it to this page." : ""}</div>}
        </div>
      )}
      {err && (err.code === "invalid_doi" ? <p role="alert" className="text-[13px] text-danger">{err.message}</p> : err.code === "doi_not_found" ? (
        <ErrorBox className="mt-0" title="Crossref does not know this DOI" message={err.message}><TButton type="button" variant="outline" onClick={() => toManual(doi)}>Enter it manually</TButton><TButton type="button" variant="outline" onClick={toBibtex}>Paste BibTeX</TButton></ErrorBox>
      ) : <ErrorBox className="mt-0" title={retryable ? "Crossref could not be reached" : "The reference was not added"} message={`${err.message} Your DOI is still in the field.`} onRetry={err.retry === "add" ? add : lookup} />)}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {preview?.duplicate ? <><TButton type="button" variant="outline" onClick={() => onOpenRef(preview.duplicate!.id)}>Open the stored reference</TButton>{pageId && !preview.duplicate.pageId && <TButton type="button" onClick={add} disabled={phase !== "idle"}>Use it here</TButton>}</>
          : preview ? <TButton type="submit" disabled={phase !== "idle" || !online}>Add to references</TButton>
          : <TButton type="submit" disabled={!doi || phase !== "idle" || !online}><Search /> Look up</TButton>}
      </div>
      <p className="text-[12px] text-fg-faint">Metadata comes from api.crossref.org; the entry is marked “DOI verified”.</p>
    </form>
  );
}

type BibReport = { dryRun: boolean; parsed: number; created: { id: string; citeKey: string; title: string }[]; wouldCreate: { citeKey: string; title: string; year: number | null }[]; skipped: { citeKey: string; reason: string }[]; failed: { citeKey: string; reason: string }[]; counts: { created: number; wouldCreate: number; skipped: number; failed: number } };
function BibtexPane({ pageId, onDone, onClose }: { pageId: string | null; onDone: () => void; onClose: () => void }) {
  const online = useOnline();
  const [d, setD, clear] = useDraft(`addref-bib:${pageId ?? "library"}`, { text: "" });
  const [file, setFile] = React.useState<File | null>(null); const [phase, setPhase] = React.useState<"idle" | "checking" | "importing">("idle");
  const [check, setCheck] = React.useState<BibReport | null>(null); const [result, setResult] = React.useState<BibReport | null>(null); const [err, setErr] = React.useState<{ message: string; retryable: boolean; run: "check" | "import" } | null>(null);
  const has = Boolean(file) || d.text.trim().length > 0;
  const reset = () => { setCheck(null); setResult(null); setErr(null); };
  async function send(dryRun: boolean) {
    if (!has || phase !== "idle") return; setErr(null); setPhase(dryRun ? "checking" : "importing");
    try {
      const fd = new FormData(); if (pageId) fd.append("pageId", pageId); if (file) fd.append("file", file); else fd.append("text", d.text); if (dryRun) fd.append("dryRun", "1");
      const r = await api<BibReport>("/api/research/references/import-bibtex", { method: "POST", body: fd, timeoutMs: 120_000 });
      if (dryRun) setCheck(r); else { setResult(r); setCheck(null); clear(); setFile(null); onDone(); toast(`${r.counts.created} reference${r.counts.created === 1 ? "" : "s"} imported`, { tone: "success", description: r.counts.skipped || r.counts.failed ? `${r.counts.skipped} already stored · ${r.counts.failed} unreadable` : undefined }); }
    } catch (e: any) { setErr({ message: errText(e), retryable: e?.status === 0 || e?.status >= 500, run: dryRun ? "check" : "import" }); } finally { setPhase("idle"); }
  }
  const report = result ?? check;
  return (
    <div className="space-y-3">
      {!result && <>
        <label className={cn("flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-[14px] hover:bg-bg-sunk", file && "border-accent/50 bg-accent-soft")}><FileUp className="size-4 shrink-0 text-fg-muted" /><span className="min-w-0 flex-1 truncate">{file ? file.name : "Choose a .bib file"}</span><input type="file" accept=".bib,.bibtex,.txt,text/plain,application/x-bibtex" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; reset(); }} /></label>
        {file ? <TButton variant="ghost" onClick={() => { setFile(null); reset(); }}><X /> Remove the file</TButton> : <Field label="Or paste BibTeX"><Textarea value={d.text} onChange={(e) => { setD({ text: e.target.value }); reset(); }} placeholder={"@article{key,\n  title = {…},\n  author = {Last, First and …},\n  year = {2024}\n}"} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={cn(AREA, "min-h-[140px] font-mono")} /></Field>}
      </>}
      {phase !== "idle" && <div className="flex items-center gap-2 rounded-lg border border-line p-3 text-[13px]" role="status"><Spinner className="size-4" /> {phase === "checking" ? "Reading the entries and looking for duplicates…" : `Importing ${check?.counts.wouldCreate ?? ""} reference(s)…`}</div>}
      {report && phase === "idle" && (
        <div className="rounded-lg border border-line p-3 text-[13px]" role="status">
          <div className="font-medium">{report.parsed} entr{report.parsed === 1 ? "y" : "ies"} found</div>
          <ul className="mt-1 space-y-0.5 text-fg-muted">
            <li><b className="text-fg">{result ? report.counts.created : report.counts.wouldCreate}</b> {result ? "imported" : "new — will be imported"}</li>
            <li><b className="text-fg">{report.counts.skipped}</b> already in your library or repeated — skipped, never overwritten</li>
            {report.counts.failed > 0 && <li className="text-danger"><b>{report.counts.failed}</b> could not be read — not imported</li>}
          </ul>
          {report.skipped.length > 0 && <details className="mt-2"><summary className="flex min-h-11 cursor-pointer items-center text-fg-muted md:min-h-8">Why {report.counts.skipped} were skipped</summary><ul className="max-h-48 space-y-1 overflow-y-auto">{report.skipped.slice(0, 100).map((s, i) => <li key={`${s.citeKey}-${i}`} className="break-words"><span className="font-mono">{s.citeKey}</span> — {s.reason}</li>)}</ul></details>}
          {report.failed.length > 0 && <details className="mt-1" open><summary className="flex min-h-11 cursor-pointer items-center text-danger md:min-h-8">Entries to fix</summary><ul className="max-h-48 space-y-1 overflow-y-auto">{report.failed.slice(0, 100).map((s, i) => <li key={`${s.citeKey}-${i}`} className="break-words"><span className="font-mono">{s.citeKey}</span> — {s.reason}</li>)}</ul></details>}
          {!result && report.counts.wouldCreate === 0 && <p className="mt-2 text-fg-muted">Nothing new to import.</p>}
        </div>
      )}
      {err && <ErrorBox className="mt-0" title={err.retryable ? "The server could not be reached" : "This BibTeX could not be imported"} message={`${err.message}${has ? " Your text is still here." : ""}`} onRetry={err.retryable ? () => send(err.run === "check") : undefined} />}
      {!online && <p className="rounded-md bg-bg-sunk p-2.5 text-[13px] text-fg-muted" role="status">You are offline. Your BibTeX stays in this form; import it when the connection is back.</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <TButton variant="ghost" onClick={onClose}>{result ? "Done" : "Close"}</TButton>
        {result ? <TButton variant="outline" onClick={() => setResult(null)}>Import more</TButton> : check && check.counts.wouldCreate > 0 ? <TButton onClick={() => send(false)} disabled={phase !== "idle" || !online}>Import {check.counts.wouldCreate} new</TButton> : <TButton onClick={() => send(true)} disabled={!has || phase !== "idle" || !online}>Check</TButton>}
      </div>
    </div>
  );
}

/** Manual entry / edit. The draft lives in the parent (kept when the sheet closes and after an error). */
function RefForm({ pageId, initial, v, setV, onCancel, onDone }: { pageId: string | null; initial: Ref | null; v: ManualDraft; setV: (v: ManualDraft) => void; onCancel: () => void; onDone: (r: Ref) => void }) {
  const online = useOnline(); const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState<string | null>(null);
  const set = (k: keyof ManualDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const yearOk = !v.year.trim() || /^\d{4}$/.test(v.year.trim());
  const managed = new Set(["author", "editor", "title", "year", "journal", "journaltitle", "booktitle", "publisher", "institution", "school", "doi", "url", "volume", "number", "pages", "abstract", "extracts"]);
  const kept = Object.keys(initial?.fields ?? {}).filter((k) => !managed.has(k));
  async function save() {
    if (busy) return; if (!v.title.trim()) { setError("A title is required."); return; } if (!yearOk) { setError("The year must have four digits."); return; }
    setBusy(true); setError(null);
    const authors = v.authors.split(/\n|;/).map((a) => a.trim()).filter(Boolean);
    // only the tags of this form are sent; the server keeps every other BibTeX field of the reference untouched
    const body = { pageId: initial ? undefined : pageId, entryType: v.entryType, title: v.title.trim(), authors, year: v.year.trim() ? Number(v.year.trim()) : null, journal: v.journal.trim() || null, doi: v.doi.trim() || null, url: v.url.trim() || null, fields: { volume: v.volume.trim(), number: v.number.trim(), pages: v.pages.trim(), abstract: v.abstract.trim() } };
    try {
      const r = initial ? await api(`/api/research/references/${initial.id}`, { method: "PATCH", json: { ...body, ...(v.citeKey.trim() ? { citeKey: v.citeKey.trim() } : {}) } }) : await api("/api/research/references", { method: "POST", json: { ...body, citeKey: v.citeKey.trim() || null, verified: "user" } });
      toast(initial ? "Reference updated" : `Added ${r.citeKey}`, { tone: "success" }); onDone(r);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Field label="Title" className="sm:col-span-2"><Input value={v.title} onChange={set("title")} className={FIELD} required /></Field>
      <Field label="Authors" hint="One per line: First Last. Wrap an institution in {braces}." className="sm:col-span-2"><Textarea value={v.authors} onChange={set("authors")} autoCapitalize="words" className={cn(AREA, "min-h-[88px]")} /></Field>
      <Field label="Year"><Input value={v.year} onChange={set("year")} className={FIELD} inputMode="numeric" maxLength={4} aria-invalid={!yearOk} /></Field>
      <Field label="Type"><Select value={v.entryType} onChange={set("entryType")}>{[...new Set([...ENTRY_TYPES, v.entryType])].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
      <Field label="Journal / book / publisher" className="sm:col-span-2"><Input value={v.journal} onChange={set("journal")} className={FIELD} /></Field>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2"><Field label="Volume"><Input value={v.volume} onChange={set("volume")} className={FIELD} /></Field><Field label="Number"><Input value={v.number} onChange={set("number")} className={FIELD} /></Field><Field label="Pages"><Input value={v.pages} onChange={set("pages")} className={FIELD} placeholder="45--67" /></Field></div>
      <Field label="DOI"><Input value={v.doi} onChange={set("doi")} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={cn(FIELD, "font-mono")} /></Field>
      <Field label="URL"><Input value={v.url} onChange={set("url")} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={FIELD} /></Field>
      <Field label="Cite key" hint={initial ? "Changing it changes \\cite{…} in your LaTeX." : "Generated from author, year and title when empty."} className="sm:col-span-2"><Input value={v.citeKey} onChange={set("citeKey")} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={cn(FIELD, "font-mono")} placeholder="gorton2019does" /></Field>
      <Field label="Abstract" className="sm:col-span-2"><Textarea value={v.abstract} onChange={set("abstract")} className={cn(AREA, "min-h-[80px]")} /></Field>
      {kept.length > 0 && <div className="rounded-md bg-bg-sunk p-2.5 text-[12px] text-fg-muted sm:col-span-2">Kept as imported, not edited here: {kept.map((k) => <span key={k} className="mr-1 inline-block rounded bg-bg-elev px-1.5 py-0.5 font-mono">{k}</span>)}</div>}
      {error && <div className="sm:col-span-2"><ErrorBox className="mt-0" title="Not saved — your entries are still here" message={error} onRetry={save} /></div>}
      {!online && <p className="text-[12px] text-fg-muted sm:col-span-2">You are offline. This form keeps your entries; save when the connection is back.</p>}
      <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end"><TButton type="button" variant="ghost" onClick={onCancel}>{initial ? "Discard changes" : "Close"}</TButton><TButton type="submit" disabled={busy || !online}>{busy ? <Spinner className="size-3.5 border-t-white" /> : null} {initial ? "Save" : "Add reference"}</TButton></div>
    </form>
  );
}
