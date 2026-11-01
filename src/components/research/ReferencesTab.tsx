"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Plus, Upload, Download, MoreHorizontal, Copy, ExternalLink, Pencil, Paperclip, ShieldCheck, Trash2, Search } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, Popover, PopoverTrigger, PopoverContent, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, Spinner, Empty } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { Field, Select, VerifiedBadge, copy, shortAuthors } from "./ui";
import { cn } from "@/lib/utils";

const ENTRY_TYPES = ["article", "book", "incollection", "inproceedings", "techreport", "phdthesis", "mastersthesis", "unpublished", "misc"];
type Ref = any;
export const refsKey = (pageId: string) => ["research-refs", pageId];
export const attKey = (pageId: string) => ["attachments", pageId];

export function ReferencesTab({ pageId }: { pageId: string }) {
  const qc = useQueryClient();
  const { data: refs = [], isLoading } = useQuery<Ref[]>({ queryKey: refsKey(pageId), queryFn: () => api(`/api/research/references?pageId=${pageId}`) });
  const { data: files = [] } = useQuery<any[]>({ queryKey: attKey(pageId), queryFn: () => api(`/api/attachments?pageId=${pageId}`) });
  const [q, setQ] = useState(""); const [editing, setEditing] = useState<Ref | "new" | null>(null); const [importOpen, setImportOpen] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: refsKey(pageId) }); qc.invalidateQueries({ queryKey: ["research-overview"] }); };
  const list = refs.filter((r) => !q || `${r.citeKey} ${r.title} ${(r.authors ?? []).join(" ")} ${r.journal ?? ""} ${r.year ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  async function del(r: Ref) { if (!confirm(`Delete reference ${r.citeKey}?`)) return; await api(`/api/research/references/${r.id}`, { method: "DELETE" }); toast("Reference deleted"); refresh(); }
  async function verify(r: Ref) { try { await api(`/api/research/references/${r.id}?action=verify`, { method: "POST" }); toast("Verified with Crossref", { tone: "success" }); refresh(); } catch (e: any) { toast("Verification failed", { description: e.message, tone: "danger" }); } }
  async function attach(r: Ref, attachmentId: string | null) { await api(`/api/research/references/${r.id}?action=attach`, { method: "POST", json: { attachmentId } }); toast(attachmentId ? "PDF attached" : "PDF detached"); refresh(); }
  const fileOf = (id: string | null) => files.find((f) => f.id === id);
  const Actions = ({ r }: { r: Ref }) => (
    <Menu><MenuTrigger asChild><button className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk" aria-label="Actions"><MoreHorizontal className="size-4" /></button></MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => copy(`\\cite{${r.citeKey}}`, `\\cite{${r.citeKey}} copied`)}><Copy /> Copy \cite{"{"}{r.citeKey}{"}"}</MenuItem>
        <MenuItem onSelect={() => copy(r.bibtex ?? "", "BibTeX copied")}><Copy /> Copy BibTeX</MenuItem>
        {r.doi && <MenuItem onSelect={() => window.open(`https://doi.org/${r.doi}`, "_blank")}><ExternalLink /> Open DOI</MenuItem>}
        {r.attachmentId && <MenuItem onSelect={() => window.open(`/api/files/${r.attachmentId}`, "_blank")}><Paperclip /> Open PDF</MenuItem>}
        <MenuSeparator />
        <MenuItem onSelect={() => setEditing(r)}><Pencil /> Edit</MenuItem>
        {r.doi && r.verified !== "doi_verified" && <MenuItem onSelect={() => verify(r)}><ShieldCheck /> Verify via Crossref</MenuItem>}
        {files.length > 0 && <MenuSeparator />}
        {files.filter((f) => f.id !== r.attachmentId).slice(0, 8).map((f) => <MenuItem key={f.id} onSelect={() => attach(r, f.id)}><Paperclip /> <span className="truncate">Attach {f.filename}</span></MenuItem>)}
        {r.attachmentId && <MenuItem onSelect={() => attach(r, null)}><Paperclip /> Detach PDF</MenuItem>}
        <MenuSeparator />
        <MenuItem danger onSelect={() => del(r)}><Trash2 /> Delete</MenuItem>
      </MenuContent></Menu>
  );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <DoiAdd pageId={pageId} onDone={refresh} />
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}><Plus /> Manual</Button>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload /> Import .bib</Button>
        <Button size="sm" variant="outline" onClick={() => window.open(`/api/research/references/export.bib?pageId=${pageId}`, "_blank")} disabled={!refs.length}><Download /> Export .bib</Button>
        <div className="relative ml-auto w-full sm:w-56"><Search className="absolute left-2 top-2 size-3.5 text-fg-faint" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter references" className="h-8 pl-7 text-[13px]" /></div>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Spinner /></div> : !refs.length ? <Empty icon={<BookMarked />} title="No references yet" hint="Add by DOI, enter one manually or import a .bib file. Cite with \cite{key} in the page." /> : (
        <>
          <table className="mt-3 hidden w-full border-collapse text-[13px] sm:table">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-fg-faint"><th className="py-1.5 pr-2 font-medium">Key</th><th className="py-1.5 pr-2 font-medium">Authors</th><th className="py-1.5 pr-2 font-medium">Year</th><th className="py-1.5 pr-2 font-medium">Title</th><th className="py-1.5 pr-2 font-medium">Journal</th><th className="py-1.5 pr-2 font-medium">DOI</th><th className="py-1.5 pr-2 font-medium">Status</th><th /></tr></thead>
            <tbody>{list.map((r) => <tr key={r.id} className="border-t border-line align-top hover:bg-bg-sunk/60">
              <td className="py-1.5 pr-2"><button className="font-mono text-[12px] text-accent hover:underline" title="Copy \cite{key}" onClick={() => copy(`\\cite{${r.citeKey}}`, `\\cite{${r.citeKey}} copied`)}>{r.citeKey}</button>{r.attachmentId && <Paperclip className="ml-1 inline size-3 text-fg-faint" />}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap" title={(r.authors ?? []).join(", ")}>{shortAuthors(r.authors)}</td>
              <td className="py-1.5 pr-2">{r.year ?? "—"}</td>
              <td className="py-1.5 pr-2 max-w-[22rem]"><span className="line-clamp-2">{r.title}</span></td>
              <td className="py-1.5 pr-2 max-w-[12rem] text-fg-muted"><span className="line-clamp-2">{r.journal ?? "—"}</span></td>
              <td className="py-1.5 pr-2">{r.doi ? <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-fg-muted hover:text-accent">{r.doi.length > 24 ? r.doi.slice(0, 22) + "…" : r.doi}</a> : "—"}</td>
              <td className="py-1.5 pr-2"><VerifiedBadge v={r.verified} /></td>
              <td className="py-0.5"><Actions r={r} /></td>
            </tr>)}</tbody>
          </table>
          <div className="mt-3 space-y-2 sm:hidden">{list.map((r) => <div key={r.id} className="rounded-lg border border-line bg-bg-elev p-3">
            <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><button className="font-mono text-[12px] text-accent" onClick={() => copy(`\\cite{${r.citeKey}}`, `\\cite{${r.citeKey}} copied`)}>{r.citeKey}</button><VerifiedBadge v={r.verified} />{r.attachmentId && <Paperclip className="size-3 text-fg-faint" />}</div><div className="mt-1 text-[13px] font-medium leading-snug">{r.title}</div><div className="mt-0.5 text-[12px] text-fg-muted">{shortAuthors(r.authors)} · {r.year ?? "n.d."}{r.journal ? ` · ${r.journal}` : ""}</div>{r.doi && <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate font-mono text-[11px] text-fg-faint">{r.doi}</a>}</div><Actions r={r} /></div>
          </div>)}</div>
          {!list.length && <div className="py-6 text-center text-[13px] text-fg-muted">No reference matches “{q}”.</div>}
          <div className="mt-2 text-[11px] text-fg-faint">{refs.length} reference{refs.length > 1 ? "s" : ""} · {refs.filter((r) => r.verified === "doi_verified").length} DOI-verified · {refs.filter((r) => r.attachmentId).length} with PDF</div>
        </>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}><DialogContent title={editing === "new" ? "New reference" : "Edit reference"} wide>{editing !== null && <RefForm pageId={pageId} initial={editing === "new" ? null : editing} files={files} onDone={() => { setEditing(null); refresh(); }} />}</DialogContent></Dialog>
      <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent title="Import BibTeX" description="Entries already stored (same DOI or cite key) are skipped, never overwritten."><ImportBib pageId={pageId} onDone={() => { setImportOpen(false); refresh(); }} /></DialogContent></Dialog>
    </div>
  );
}

function DoiAdd({ pageId, onDone }: { pageId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false); const [doi, setDoi] = useState(""); const [busy, setBusy] = useState(false);
  async function add() { const d = doi.trim(); if (!d || busy) return; setBusy(true); try { const r = await api("/api/research/references/doi", { method: "POST", json: { doi: d, pageId } }); toast(`Added ${r.citeKey}`, { description: r.title, tone: "success" }); setDoi(""); setOpen(false); onDone(); } catch (e: any) { toast("DOI lookup failed", { description: e.message, tone: "danger" }); } finally { setBusy(false); } }
  return (
    <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button size="sm"><Plus /> By DOI</Button></PopoverTrigger>
      <PopoverContent className="w-80"><div className="text-[12px] font-medium">Add from Crossref</div><div className="mt-2 flex gap-1"><Input autoFocus value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.1016/j.jfineco.2019.09.005" className="h-8 font-mono text-[12px]" onKeyDown={(e) => { if (e.key === "Enter") add(); }} /><Button size="sm" onClick={add} disabled={busy || !doi.trim()}>{busy ? <Spinner className="size-3.5" /> : "Add"}</Button></div><div className="mt-1.5 text-[11px] text-fg-faint">Metadata is fetched from api.crossref.org and the entry is marked “DOI verified”.</div></PopoverContent></Popover>
  );
}

function RefForm({ pageId, initial, files, onDone }: { pageId: string; initial: Ref | null; files: any[]; onDone: () => void }) {
  const f = initial?.fields ?? {};
  const [v, setV] = useState({ citeKey: initial?.citeKey ?? "", entryType: initial?.entryType ?? "article", title: initial?.title ?? "", authors: (initial?.authors ?? []).join("\n"), year: initial?.year ? String(initial.year) : "", journal: initial?.journal ?? "", doi: initial?.doi ?? "", url: initial?.url ?? "", volume: f.volume ?? "", number: f.number ?? "", pages: f.pages ?? "", abstract: f.abstract ?? "", attachmentId: initial?.attachmentId ?? "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  async function save() {
    if (!v.title.trim()) { toast("Title is required", { tone: "danger" }); return; } setBusy(true);
    const body = { pageId, citeKey: v.citeKey.trim() || null, entryType: v.entryType, title: v.title.trim(), authors: v.authors.split(/\n|;| and /).map((a: string) => a.trim()).filter(Boolean), year: v.year ? Number(v.year) : null, journal: v.journal.trim() || null, doi: v.doi.trim() || null, url: v.url.trim() || null, fields: { volume: v.volume, number: v.number, pages: v.pages, abstract: v.abstract }, attachmentId: v.attachmentId || null };
    try { if (initial) await api(`/api/research/references/${initial.id}`, { method: "PATCH", json: { ...body, citeKey: body.citeKey ?? undefined } }); else await api("/api/research/references", { method: "POST", json: { ...body, verified: "user" } }); toast(initial ? "Reference updated" : "Reference added", { tone: "success" }); onDone(); }
    catch (e: any) { toast("Save failed", { description: e.message, tone: "danger" }); } finally { setBusy(false); }
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }}>
      <Field label="Cite key" hint={initial ? undefined : "Generated from author/year/title when empty"}><Input value={v.citeKey} onChange={set("citeKey")} className="h-8 font-mono text-[12px]" placeholder="gorton2019does" /></Field>
      <Field label="Type"><Select value={v.entryType} onChange={set("entryType")}>{ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
      <Field label="Title" className="sm:col-span-2"><Input value={v.title} onChange={set("title")} className="h-8" autoFocus /></Field>
      <Field label="Authors" hint="One per line (First Last)" className="sm:row-span-2"><Textarea value={v.authors} onChange={set("authors")} className="min-h-[96px] text-[13px]" /></Field>
      <Field label="Year"><Input value={v.year} onChange={set("year")} className="h-8" inputMode="numeric" /></Field>
      <Field label="Journal / book / publisher"><Input value={v.journal} onChange={set("journal")} className="h-8" /></Field>
      <Field label="DOI"><Input value={v.doi} onChange={set("doi")} className="h-8 font-mono text-[12px]" /></Field>
      <Field label="URL"><Input value={v.url} onChange={set("url")} className="h-8 text-[12px]" /></Field>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2"><Field label="Volume"><Input value={v.volume} onChange={set("volume")} className="h-8" /></Field><Field label="Number"><Input value={v.number} onChange={set("number")} className="h-8" /></Field><Field label="Pages"><Input value={v.pages} onChange={set("pages")} className="h-8" /></Field></div>
      <Field label="Abstract" className="sm:col-span-2"><Textarea value={v.abstract} onChange={set("abstract")} className="min-h-[70px] text-[13px]" /></Field>
      <Field label="PDF (page file)" className="sm:col-span-2"><Select value={v.attachmentId} onChange={set("attachmentId")}><option value="">— none —</option>{files.map((x) => <option key={x.id} value={x.id}>{x.filename}</option>)}</Select></Field>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" size="sm" onClick={onDone}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? <Spinner className="size-3.5" /> : initial ? "Save" : "Add reference"}</Button></div>
    </div>
  );
}

function ImportBib({ pageId, onDone }: { pageId: string; onDone: () => void }) {
  const [text, setText] = useState(""); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [res, setRes] = useState<any | null>(null);
  async function run() {
    setBusy(true); try {
      const fd = new FormData(); fd.append("pageId", pageId); if (file) fd.append("file", file); else fd.append("text", text);
      const r = await api("/api/research/references/import-bibtex", { method: "POST", body: fd }); setRes(r); toast(`${r.created.length} imported, ${r.skipped.length} skipped`, { tone: "success" }); if (!r.skipped.length) onDone();
    } catch (e: any) { toast("Import failed", { description: e.message, tone: "danger" }); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <label className={cn("flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-dashed border-line px-3 py-2 text-[13px] hover:bg-bg-sunk", file && "border-accent/50")}><Upload className="size-4 text-fg-muted" />{file ? file.name : "Choose a .bib file"}<input type="file" accept=".bib,text/x-bibtex,text/plain" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <div className="text-center text-[11px] text-fg-faint">or paste BibTeX</div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"@article{key,\n  title = {…},\n  author = {Last, First and …},\n  year = {2024}\n}"} className="min-h-[140px] font-mono text-[12px]" disabled={!!file} />
      {res && <div className="rounded-md bg-bg-sunk p-2 text-[12px]"><div>{res.parsed} entries parsed · <b>{res.created.length}</b> imported · {res.skipped.length} skipped</div>{res.skipped.slice(0, 10).map((s: any) => <div key={s.citeKey} className="text-fg-muted">· {s.citeKey}: {s.reason}</div>)}</div>}
      <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={onDone}>{res ? "Close" : "Cancel"}</Button><Button size="sm" onClick={run} disabled={busy || (!file && !text.trim())}>{busy ? <Spinner className="size-3.5" /> : "Import"}</Button></div>
    </div>
  );
}
