/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/research/ReferencesTab.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-17
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

"use client";
/** References of a page: cards on phones (table from `md`), one "Add" sheet (DOI / BibTeX / manual), detail sheet per reference. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, ChevronRight, Copy, Download, FileText, Plus, Search, TextQuote } from "lucide-react";
import { api } from "@/lib/client/api";
import { Input } from "@/components/ui/input";
import { Empty } from "@/components/ui/primitives";
import { buttonVariants } from "@/components/ui/button";
import { extractsOf } from "@/lib/research/cite";
import { ErrorBox, FIELD, IconBtn, ListSkeleton, TButton, VerifiedBadge, copy, errText, shortAuthors } from "./ui";
import { AddReferenceSheet, EditReferenceSheet } from "./AddReference";
import { ReferenceSheet, refKey } from "./ReferenceSheet";
import { cn } from "@/lib/utils";

type Ref = any;
export const refsKey = (pageId: string) => ["research-refs", pageId];
export const attKey = (pageId: string) => ["attachments", pageId];
export const matchRef = (r: Ref, q: string) => !q || `${r.citeKey} ${r.title} ${(r.authors ?? []).join(" ")} ${r.journal ?? ""} ${r.year ?? ""} ${r.doi ?? ""}`.toLowerCase().includes(q.toLowerCase());

/** One reference as a card: the whole card opens the detail sheet; the cite key is a second, explicit target. */
export function ReferenceCard({ r, onOpen, footer }: { r: Ref; onOpen: () => void; footer?: React.ReactNode }) {
  const n = extractsOf(r.fields).length;
  return (
    <li className="flex items-stretch rounded-lg border border-line bg-bg-elev">
      <button type="button" onClick={onOpen} className="flex min-h-16 min-w-0 flex-1 items-center gap-2 rounded-l-lg p-3 text-left hover:bg-bg-sunk">
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[14px] font-medium leading-snug">{r.title}</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-fg-muted">{shortAuthors(r.authors)} · {r.year ?? "n.d."}{r.journal ? ` · ${r.journal}` : ""}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5"><span className="max-w-full truncate rounded bg-bg-sunk px-1.5 py-0.5 font-mono text-[11.5px] text-accent">{r.citeKey}</span><VerifiedBadge v={r.verified} />{r.attachmentId && <span className="inline-flex items-center gap-0.5 text-[11.5px] text-fg-muted"><FileText className="size-3.5" aria-hidden /> PDF</span>}{n > 0 && <span className="inline-flex items-center gap-0.5 text-[11.5px] text-fg-muted"><TextQuote className="size-3.5" aria-hidden /> {n} extract{n > 1 ? "s" : ""}</span>}</span>
          {footer}
        </span>
        <ChevronRight className="size-4 shrink-0 text-fg-faint" aria-hidden />
      </button>
      <IconBtn label={`Copy \\cite{${r.citeKey}}`} className="my-auto mr-1" onClick={() => copy(`\\cite{${r.citeKey}}`, `\\cite{${r.citeKey}} copied`)}><Copy /></IconBtn>
    </li>
  );
}

export function ReferencesTab({ pageId }: { pageId: string }) {
  const qc = useQueryClient();
  const q = useQuery<Ref[]>({ queryKey: refsKey(pageId), queryFn: () => api(`/api/research/references?pageId=${pageId}`) });
  const refs = q.data ?? [];
  const [filter, setFilter] = useState(""); const [addOpen, setAddOpen] = useState(false); const [openId, setOpenId] = useState<string | null>(null); const [editing, setEditing] = useState<Ref | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: refsKey(pageId) }); qc.invalidateQueries({ queryKey: ["research-refs", "all"] }); qc.invalidateQueries({ queryKey: ["research-overview"] }); };
  const list = refs.filter((r) => matchRef(r, filter));
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <TButton onClick={() => setAddOpen(true)}><Plus /> Add reference</TButton>
        {refs.length > 0 && <a href={`/api/research/references/export.bib?pageId=${pageId}`} download className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 px-3.5 md:h-8 md:px-2.5")}><Download /> Export .bib</a>}
        {refs.length > 3 && <div className="relative w-full md:ml-auto md:w-56"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint md:left-2 md:size-3.5" aria-hidden /><Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter references" aria-label="Filter references" type="search" enterKeyHint="search" className={cn(FIELD, "pl-9 md:pl-7")} /></div>}
      </div>
      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorBox title="Could not load the references" message={errText(q.error)} onRetry={() => q.refetch()} /> : !refs.length ? (
        <Empty icon={<BookMarked />} title="No references yet" hint="Add one by DOI, paste BibTeX or enter it by hand. Cite it with \cite{key} in the page." action={<TButton onClick={() => setAddOpen(true)}><Plus /> Add reference</TButton>} />
      ) : (
        <>
          <ul className="mt-3 space-y-2 md:hidden">{list.map((r) => <ReferenceCard key={r.id} r={r} onOpen={() => setOpenId(r.id)} />)}</ul>
          <div className="mt-3 hidden overflow-x-auto overscroll-x-contain md:block">
            <table className="w-full border-collapse text-[13px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-fg-faint"><th className="py-1.5 pr-2 font-medium">Key</th><th className="py-1.5 pr-2 font-medium">Authors</th><th className="py-1.5 pr-2 font-medium">Year</th><th className="py-1.5 pr-2 font-medium">Title</th><th className="py-1.5 pr-2 font-medium">Journal</th><th className="py-1.5 pr-2 font-medium">Status</th><th className="py-1.5 font-medium"><span className="sr-only">Has PDF / extracts</span></th></tr></thead>
              <tbody>{list.map((r) => { const n = extractsOf(r.fields).length; return (
                <tr key={r.id} className="cursor-pointer border-t border-line align-top hover:bg-bg-sunk/60" onClick={() => setOpenId(r.id)}>
                  <td className="py-1.5 pr-2"><button type="button" className="font-mono text-[12px] text-accent hover:underline" title="Copy \cite{key}" onClick={(e) => { e.stopPropagation(); copy(`\\cite{${r.citeKey}}`, `\\cite{${r.citeKey}} copied`); }}>{r.citeKey}</button></td>
                  <td className="whitespace-nowrap py-1.5 pr-2" title={(r.authors ?? []).join(", ")}>{shortAuthors(r.authors)}</td>
                  <td className="py-1.5 pr-2">{r.year ?? "—"}</td>
                  <td className="max-w-[24rem] py-1.5 pr-2"><button type="button" className="line-clamp-2 text-left hover:text-accent" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>{r.title}</button></td>
                  <td className="max-w-[12rem] py-1.5 pr-2 text-fg-muted"><span className="line-clamp-2">{r.journal ?? "—"}</span></td>
                  <td className="py-1.5 pr-2"><VerifiedBadge v={r.verified} /></td>
                  <td className="whitespace-nowrap py-1.5 text-[12px] text-fg-muted">{r.attachmentId && <span className="mr-2 inline-flex items-center gap-0.5"><FileText className="size-3.5" aria-hidden /> PDF</span>}{n > 0 && <span className="inline-flex items-center gap-0.5"><TextQuote className="size-3.5" aria-hidden /> {n}</span>}</td>
                </tr>); })}</tbody>
            </table>
          </div>
          {!list.length && <div className="py-6 text-center text-[13px] text-fg-muted">No reference matches “{filter}”. <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => setFilter("")}>Clear the filter</button></div>}
          <div className="mt-2 text-[12px] text-fg-faint">{refs.length} reference{refs.length > 1 ? "s" : ""} · {refs.filter((r) => r.verified === "doi_verified").length} DOI-verified · {refs.filter((r) => r.attachmentId).length} with PDF</div>
        </>
      )}
      <AddReferenceSheet open={addOpen} onOpenChange={setAddOpen} pageId={pageId} onDone={refresh} onOpenRef={(id) => setOpenId(id)} />
      <ReferenceSheet refId={openId} pageId={pageId} onClose={() => setOpenId(null)} onChanged={refresh} onEdit={(r) => { setOpenId(null); setEditing(r); }} />
      <EditReferenceSheet reference={editing} onClose={() => setEditing(null)} onDone={(r) => { setEditing(null); qc.setQueryData(refKey(r.id), r); refresh(); setOpenId(r.id); }} />
    </div>
  );
}
