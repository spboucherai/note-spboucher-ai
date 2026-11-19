"use client";
/**
 * file: src/components/editor/nodes/CitationView.tsx
 * description: `citation` (inline atom bound to a research reference: refId, locator, cached "Author Year" label) and `bibliography`
 *   (block listing, in APA style, the references cited in the page — computed from the document, never stored). References are resolved
 *   through `GET /api/research/references?ids=` (SPEC §4.14); a server that ignores `ids` answers the whole library, which is filtered here.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { NodeViewWrapper, useEditorState } from "@tiptap/react";
import { useQuery } from "@tanstack/react-query";
import { BookMarked, Library, Search } from "lucide-react";
import type { CitationAttrs, BibliographyAttrs } from "@/lib/editor/next-nodes";
import { formatCitation, shortLabel, type CiteRef } from "@/lib/research/cite";
import { fuzzyRank } from "@/lib/client/commands";
import { api } from "@/lib/client/api";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/primitives";
import { NodeFrame, NodeState, useDebounced, type LeafViewProps } from "./frame";

export interface RefRow extends CiteRef { id: string }
/** "Gorton & Metrick (2019)" → "Gorton & Metrick 2019" — the cached label of SPEC §2 ("Author Year"). */
export const citationLabel = (r: CiteRef) => shortLabel(r).replace(/\s*\((.+)\)$/, " $1");
export const citationText = (a: Pick<CitationAttrs, "label" | "locator" | "refId">) => `(${a.label || (a.refId ? "reference" : "citation")}${a.locator ? `, ${a.locator}` : ""})`;
const useLibrary = (enabled: boolean) => useQuery({ queryKey: ["references-library"], enabled, staleTime: 60_000, queryFn: () => api<RefRow[]>("/api/research/references") });
export function useReferencesById(ids: string[]) {
  const key = [...new Set(ids)].sort();
  return useQuery({ queryKey: ["references-by-id", key], enabled: key.length > 0, staleTime: 60_000, queryFn: async () => { const all = await api<RefRow[]>(`/api/research/references?ids=${key.join(",")}`); const want = new Set(key); return all.filter((r) => want.has(r.id)); } });
}

/** The "/cite" command asks the next citation that mounts (the one it is about to insert) to open its reference picker. */
let openNext = false;
export const requestOpenCitation = () => { openNext = true; setTimeout(() => { openNext = false; }, 1500); };
export function CitationView({ attrs, update, editable, selected }: LeafViewProps<CitationAttrs>) {
  const [open, setOpen] = React.useState(false); const [q, setQ] = React.useState("");
  React.useEffect(() => { if (openNext && editable && !attrs.refId) { openNext = false; setOpen(true); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const lib = useLibrary(open && editable); const setLocator = useDebounced((v: string) => update({ locator: v }), 400);
  const hits = React.useMemo(() => fuzzyRank(q, lib.data ?? [], (r) => ({ title: `${citationLabel(r)} — ${r.title}`, keywords: `${r.citeKey} ${(r.authors ?? []).join(" ")} ${r.journal ?? ""}` }), undefined, 8), [q, lib.data]);
  const current = (lib.data ?? []).find((r) => r.id === attrs.refId);
  const chip = <span className="cite-inline" data-selected={selected ? "true" : undefined} data-missing={!attrs.refId ? "true" : undefined} role={editable ? "button" : undefined} tabIndex={editable ? 0 : undefined}>{citationText(attrs)}</span>;
  if (!editable) return <NodeViewWrapper as="span" className="nv-inline" data-node="citation">{attrs.refId ? <a className="cite-inline" href={`/research?ref=${attrs.refId}`}>{citationText(attrs)}</a> : chip}</NodeViewWrapper>;
  return (
    <NodeViewWrapper as="span" className="nv-inline" data-node="citation">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setLocator.flush(); }}>
        <PopoverTrigger asChild>{chip}</PopoverTrigger>
        <PopoverContent className="w-[min(22rem,calc(100vw-1.5rem))] p-2" onOpenAutoFocus={(e) => { if (attrs.refId) e.preventDefault(); }}>
          {attrs.refId && <div className="mb-2 border-b border-line pb-2"><div className="text-ui font-medium">{current ? formatCitation(current) : attrs.label || "Reference"}</div>
            <label className="mt-2 flex items-center gap-2 text-ui text-fg-muted">Locator<input className="nb-field flex-1" defaultValue={attrs.locator} placeholder="p. 12, chap. 3…" aria-label="Locator" onChange={(e) => setLocator(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setLocator.flush(); setOpen(false); } }} /></label></div>}
          <label className="flex items-center gap-2 rounded-control border border-line bg-bg px-2"><Search className="size-4 text-fg-faint" aria-hidden /><input autoFocus={!attrs.refId} value={q} onChange={(e) => setQ(e.target.value)} placeholder={attrs.refId ? "Change reference…" : "Search your references…"} aria-label="Search references" className="h-8 min-w-0 flex-1 bg-transparent text-ui outline-none" style={{ outline: "none" }} /></label>
          <div className="mt-1 max-h-56 overflow-y-auto" role="listbox" aria-label="References">
            {lib.isLoading ? <div className="p-2 text-ui text-fg-muted">Loading…</div> : (lib.data ?? []).length === 0 ? <div className="p-2 text-ui text-fg-muted">No reference in your library yet. Add some in Research → References.</div>
              : hits.length === 0 ? <div className="p-2 text-ui text-fg-muted">No reference matches.</div>
              : hits.map(({ item: r }) => <button key={r.id} type="button" role="option" aria-selected={r.id === attrs.refId} className="block w-full rounded-control px-2 py-1.5 text-left hover:bg-bg-hover" onClick={() => { update({ refId: r.id, label: citationLabel(r) }); setQ(""); setOpen(false); }}><span className="block text-ui font-medium">{citationLabel(r)}</span><span className="block truncate text-micro text-fg-muted">{r.title}</span></button>)}
          </div>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}

/** Reference ids cited in the document, in order of first appearance. */
export function citedIds(doc: { descendants: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void }): string[] {
  const ids: string[] = []; doc.descendants((n) => { if (n.type.name === "citation" && typeof n.attrs.refId === "string" && !ids.includes(n.attrs.refId)) ids.push(n.attrs.refId); }); return ids;
}
export function BibliographyView({ attrs, update, editable, selected, editor }: LeafViewProps<BibliographyAttrs>) {
  // re-computed only when the set of cited ids changes (the selector returns a string, compared by value)
  const idKey = useEditorState({ editor, selector: ({ editor: e }) => citedIds(e.state.doc).join(",") }) ?? "";
  const ids = React.useMemo(() => (idKey ? idKey.split(",") : []), [idKey]);
  const refs = useReferencesById(ids); const setTitle = useDebounced((v: string) => update({ title: v }), 400);
  const found = refs.data ?? []; const missing = ids.filter((id) => !found.some((r) => r.id === id));
  const lines = React.useMemo(() => found.map((r) => ({ id: r.id, text: formatCitation(r) })).sort((a, b) => a.text.localeCompare(b.text)), [found]);
  return (
    <NodeFrame kind="bibliography" icon={<Library />} label="Bibliography" selected={selected} title={<span className="nb-meta">{attrs.style.toUpperCase()} · {ids.length} cited</span>}>
      <div className="bib">
        {editable ? <input className="bib-title" defaultValue={attrs.title} aria-label="Bibliography title" onChange={(e) => setTitle(e.target.value)} onBlur={() => setTitle.flush()} /> : <div className="bib-title">{attrs.title}</div>}
        {ids.length === 0 ? <NodeState icon={<BookMarked />} title="No citation in this page yet" hint="Insert a citation with “/cite”: the references you cite are listed here automatically." />
          : refs.isLoading ? <div className="skeleton h-5 w-2/3" />
          : <ol className="bib-list" data-testid="bibliography-list">{lines.map((l) => <li key={l.id}>{l.text}</li>)}{missing.map((id) => <li key={id} className="text-fg-faint">Reference not found ({id.slice(0, 8)}…) — it may have been deleted.</li>)}</ol>}
      </div>
    </NodeFrame>
  );
}
