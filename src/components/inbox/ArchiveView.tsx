/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/inbox/ArchiveView.tsx
 * Description      : Archived pages with one-tap restore (undo in the toast).
 *                    Paged list: 100 rows per request, "Show more" for the
 *                    rest.
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-19
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
import { useMemo } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, RotateCcw } from "lucide-react";
import { api } from "@/lib/client/api";
import { Empty, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { timeAgo } from "@/lib/utils";
import { ErrorState, ListFooter, errorMessage } from "@/components/ui/error-state";
import { LIST_PAGE_SIZE, flattenPages, nextOffset } from "@/lib/paging";

/** Archived pages: out of the tree and the inbox, kept and searchable. One tap brings a page back. */
export function ArchiveView() {
  const qc = useQueryClient();
  const { data: paged, isLoading, error, refetch, isFetching, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({ queryKey: ["archive"], queryFn: ({ pageParam }) => api<any[]>(`/api/pages?view=archived&limit=${LIST_PAGE_SIZE}&offset=${pageParam}`), initialPageParam: 0, getNextPageParam: (_last, pages) => nextOffset(pages) });
  const data = useMemo(() => (paged ? flattenPages<any>(paged.pages) : undefined), [paged]);
  async function restore(p: any) { try { await api(`/api/pages/${p.id}`, { method: "PATCH", json: { archived: false } }); qc.invalidateQueries({ queryKey: ["archive"] }); qc.invalidateQueries({ queryKey: ["tree"] }); toast("Back in the workspace", { description: p.title, action: { label: "Undo", run: async () => { await api(`/api/pages/${p.id}`, { method: "PATCH", json: { archived: true } }); qc.invalidateQueries({ queryKey: ["archive"] }); qc.invalidateQueries({ queryKey: ["tree"] }); } } }); } catch (e: any) { toast("Could not restore", { description: e.message, tone: "danger" }); } }
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 sm:px-6 sm:pt-8">
      <h1 className="text-[22px] font-semibold tracking-tight">Archive</h1><p className="mb-4 text-[13px] text-fg-muted">Hidden from the workspace, still found by search.</p>
      {isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div> : !data ? <ErrorState testId="archive-error" title="Could not load the archive" error={error} onRetry={() => refetch()} retrying={isFetching} /> : !data.length ? <Empty icon={<Archive />} title="Nothing archived" hint="Archive a page from its ⋯ menu, or an inbox item with one tap." /> :
        <><ul data-testid="archive-list" className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bg-elev">{data.map((p) => <li key={p.id} className="flex items-center gap-2 pl-3.5"><Link href={`/p/${p.id}`} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2"><span className="w-5 text-center text-[17px] leading-none">{p.icon ?? "📄"}</span><span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{p.title || "Untitled"}</span><span className="block text-[12px] text-fg-faint">Updated {timeAgo(p.updatedAt)}</span></span></Link><button onClick={() => restore(p)} aria-label={`Restore ${p.title}`} className="flex h-14 items-center gap-1.5 px-3.5 text-[13.5px] font-medium text-accent"><RotateCcw className="size-4" /><span className="max-sm:sr-only">Restore</span></button></li>)}</ul><ListFooter testId="archive-more" shown={data.length} hasMore={Boolean(hasNextPage)} onMore={() => fetchNextPage()} loading={isFetchingNextPage} note={error ? `Could not load more: ${errorMessage(error)}` : null} /></>}
    </div>
  );
}
