"use client";
/**
 * file: src/components/editor/nodes/CitationView.tsx
 * description: `citation` (inline atom bound to a research reference: refId, locator, cached "Author Year" label) and `bibliography`
 *   (block listing, in APA style, the references cited in the page — computed from the document, never stored). Both resolve their
 *   references through the page-wide resolver (src/lib/editor/citations.ts): all the ids cited in a page go out as one
 *   `GET /api/research/references?ids=` (SPEC §4.14) and are cached per id; the chip shows the reference's current author–year (the
 *   `label` attr is the offline fallback) and a deleted reference is shown as such. The library is only loaded by the picker.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { NodeViewWrapper, useEditorState } from "@tiptap/react";
import { createReferenceResolver, referencesUrl, isRefId, type ResolvedRef, type RefState } from "@/lib/editor/citations";
import { useQuery } from "@tanstack/react-query";
import { BookMarked, Library, Search } from "lucide-react";
import type { CitationAttrs, BibliographyAttrs } from "@/lib/editor/next-node-defs";
import { formatCitation, shortLabel, type CiteRef } from "@/lib/research/cite";
import { fuzzyRank } from "@/lib/client/commands";
import { api } from "@/lib/client/api";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/primitives";
import { NodeFrame, NodeButton, NodeState, useDebounced, type LeafViewProps } from "./frame";

export interface RefRow extends CiteRef { id: string }
/** "Gorton & Metrick (2019)" → "Gorton & Metrick 2019" — the cached label of SPEC §2 ("Author Year"). */
export const citationLabel = (r: CiteRef) => shortLabel(r).replace(/\s*\((.+)\)$/, " $1");
export const citationText = (a: Pick<CitationAttrs, "label" | "locator" | "refId">) => `(${a.label || (a.refId ? "reference" : "citation")}${a.locator ? `, ${a.locator}` : ""})`;
const useLibrary = (enabled: boolean) => useQuery({ queryKey: ["references-library"], enabled, staleTime: 60_000, queryFn: () => api<RefRow[]>("/api/research/references") });
/** The app's resolver: one batched `?ids=` request for all the citations of a page, cached per id (see src/lib/editor/citations.ts). */
export const referenceResolver = createReferenceResolver((ids) => api<ResolvedRef[]>(referencesUrl(ids)));
/** State of one cited reference: the reference, `null` when the server does not have it (deleted), `undefined` while unknown. */
export function useReference(id: string | null | undefined): RefState {
  const state = React.useSyncExternalStore(referenceResolver.subscribe, () => (id ? referenceResolver.peek(id) : null), () => undefined);
  React.useEffect(() => { if (id && state === undefined) void referenceResolver.load(id); }, [id, state]);
  return state;
}
/** The references of a list of ids, in the order asked, plus the ids the server does not have. */
export function useReferences(ids: string[]): { found: ResolvedRef[]; missing: string[]; loading: boolean; error: Error | null; retry: () => void } {
  const [, bump] = React.useReducer((n: number) => n + 1, 0); const key = ids.join(",");
  React.useEffect(() => referenceResolver.subscribe(bump), []);
  React.useEffect(() => { if (ids.length) void referenceResolver.loadMany(ids); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const states = ids.map((id) => [id, isRefId(id) ? referenceResolver.peek(id) : null] as const);
  const loading = states.some(([, s]) => s === undefined); const error = loading ? referenceResolver.error() : null;
  return { found: states.flatMap(([, s]) => (s ? [s] : [])), missing: states.filter(([, s]) => s === null).map(([id]) => id), loading: loading && !error, error, retry: () => { void referenceResolver.loadMany(ids).then(bump); } };
}

/** The "/cite" command asks the next citation that mounts (the one it is about to insert) to open its reference picker. */
let openNext = false;
export const requestOpenCitation = () => { openNext = true; setTimeout(() => { openNext = false; }, 1500); };
export function CitationView({ attrs, update, editable, selected }: LeafViewProps<CitationAttrs>) {
  const [open, setOpen] = React.useState(false); const [q, setQ] = React.useState("");
  React.useEffect(() => { if (openNext && editable && !attrs.refId) { openNext = false; setOpen(true); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const lib = useLibrary(open && editable); const setLocator = useDebounced((v: string) => update({ locator: v }), 400);
  const hits = React.useMemo(() => fuzzyRank(q, lib.data ?? [], (r) => ({ title: `${citationLabel(r)} — ${r.title}`, keywords: `${r.citeKey} ${(r.authors ?? []).join(" ")} ${r.journal ?? ""}` }), undefined, 8), [q, lib.data]);
  const resolved = useReference(attrs.refId); const current = resolved ?? (lib.data ?? []).find((r) => r.id === attrs.refId);
  // what is shown: the reference as it is now; the cached label only while it is unknown (offline, first paint)
  const shown = resolved ? { ...attrs, label: citationLabel(resolved) } : attrs; const gone = Boolean(attrs.refId) && resolved === null;
  const state = !attrs.refId ? "empty" : gone ? "deleted" : resolved ? "resolved" : "cached";
  const chip = <span className="cite-inline" data-selected={selected ? "true" : undefined} data-missing={!attrs.refId || gone ? "true" : undefined} data-ref-state={state} title={gone ? "This reference is no longer in your library" : resolved?.citation ?? undefined} role={editable ? "button" : undefined} tabIndex={editable ? 0 : undefined}>{citationText(shown)}</span>;
  if (!editable) return <NodeViewWrapper as="span" className="nv-inline" data-node="citation">{attrs.refId && !gone ? <a className="cite-inline" data-ref-state={state} title={resolved?.citation ?? undefined} href={`/research?ref=${attrs.refId}`}>{citationText(shown)}</a> : chip}</NodeViewWrapper>;
  return (
    <NodeViewWrapper as="span" className="nv-inline" data-node="citation">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setLocator.flush(); if (resolved && citationLabel(resolved) !== attrs.label) update({ label: citationLabel(resolved) }); } }}>
        <PopoverTrigger asChild>{chip}</PopoverTrigger>
        <PopoverContent className="w-[min(22rem,calc(100vw-1.5rem))] p-2" onOpenAutoFocus={(e) => { if (attrs.refId) e.preventDefault(); }}>
          {attrs.refId && <div className="mb-2 border-b border-line pb-2"><div className="text-ui font-medium">{gone ? <span className="text-danger">This reference is no longer in your library — choose another one below.</span> : current ? formatCitation(current) : attrs.label || "Reference"}</div>
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
  const refs = useReferences(ids); const setTitle = useDebounced((v: string) => update({ title: v }), 400);
  const lines = React.useMemo(() => refs.found.map((r) => ({ id: r.id, text: r.citation || formatCitation(r) })).sort((a, b) => a.text.localeCompare(b.text)), [refs.found]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <NodeFrame kind="bibliography" icon={<Library />} label="Bibliography" selected={selected} title={<span className="nb-meta">{attrs.style.toUpperCase()} · {ids.length} cited</span>}>
      <div className="bib">
        {editable ? <input className="bib-title" defaultValue={attrs.title} aria-label="Bibliography title" onChange={(e) => setTitle(e.target.value)} onBlur={() => setTitle.flush()} /> : <div className="bib-title">{attrs.title}</div>}
        {ids.length === 0 ? <NodeState icon={<BookMarked />} title="No citation in this page yet" hint="Insert a citation with “/cite”: the references you cite are listed here automatically." />
          : refs.loading && lines.length === 0 ? <div className="skeleton h-5 w-2/3" />
          : refs.error && lines.length === 0 ? <NodeState tone="danger" icon={<BookMarked />} title="The references could not be loaded" hint={refs.error.message}><NodeButton label="Retry" text onClick={refs.retry} /></NodeState>
          : <ol className="bib-list" data-testid="bibliography-list">{lines.map((l) => <li key={l.id}>{l.text}</li>)}{refs.missing.map((id) => <li key={id} className="text-fg-muted" data-missing="true">Reference not found ({id.slice(0, 8)}…) — it may have been deleted.</li>)}</ol>}
      </div>
    </NodeFrame>
  );
}
