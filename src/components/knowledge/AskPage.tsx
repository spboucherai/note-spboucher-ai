/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/knowledge/AskPage.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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
/**
 * file: src/components/knowledge/AskPage.tsx
 * description: Ask My Knowledge as a full screen (`/ai`): the list of conversations (kept, searchable, removable with undo) next to
 *   the same grounded assistant as the page panel (src/components/chat/Chat.tsx — scope selector, citations that jump to the cited
 *   block, the honest "insufficient evidence" state, starter questions). Opening the screen sends nothing to any provider.
 *   Phones: the assistant fills the screen; the conversations open from its history button.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2, MessagesSquare, Pin } from "lucide-react";
import { api } from "@/lib/client/api";
import { useUI } from "@/lib/client/store";
import { useMounted } from "@/lib/client/hooks";
import { cn, timeAgo } from "@/lib/utils";
import { Chat } from "@/components/chat/Chat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

interface Conv { id: string; title: string; updatedAt: string; pinned: boolean; pageId: string | null }
export function AskPage({ conversationId, prefill }: { conversationId: string | null; prefill: string | null }) {
  const qc = useQueryClient(); const mounted = useMounted(); const live = useUI((s) => s.aiContext.conversationId ?? null);
  const [conv, setConv] = React.useState<string | null>(conversationId); const [gen, setGen] = React.useState(0); const [q, setQ] = React.useState("");
  const list = useQuery({ queryKey: ["convs", "all"], queryFn: () => api<Conv[]>("/api/ai/conversations"), staleTime: 10_000 });
  // the chat reports the conversation it is in (a new one gets its id with the first answer): keep the list selection in step
  React.useEffect(() => { useUI.getState().set({ aiContext: { ...useUI.getState().aiContext, pageId: null, conversationId: conversationId } }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const current = live ?? conv;
  React.useEffect(() => { const u = new URL(window.location.href); if (current) u.searchParams.set("c", current); else u.searchParams.delete("c"); u.searchParams.delete("q"); history.replaceState(null, "", u.pathname + u.search); }, [current]);
  const open = (id: string | null) => { useUI.getState().set({ aiContext: { ...useUI.getState().aiContext, pageId: null, conversationId: id } }); setConv(id); setGen((g) => g + 1); };
  const remove = async (c: Conv) => { try { await api(`/api/ai/conversations?id=${c.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["convs"] }); if (current === c.id) open(null); toast("Conversation removed", { action: { label: "Undo", run: async () => { await api(`/api/ai/conversations?id=${c.id}&restore=1`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["convs"] }); } } }); } catch (e: any) { toast("Could not remove", { description: e?.message, tone: "danger" }); } };
  const rows = (list.data ?? []).filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="absolute inset-0 flex pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0" data-testid="ask-page">
      <aside aria-label="Conversations" className="hidden w-72 shrink-0 flex-col border-r border-line bg-bg-side lg:flex" data-testid="ask-conversations">
        <div className="flex items-center gap-2 px-3 pb-1 pt-3"><h1 className="min-w-0 flex-1 truncate font-serif text-[1.0625rem] font-semibold tracking-[-0.018em]">Ask My Knowledge</h1><Button size="iconSm" variant="ghost" aria-label="New conversation" onClick={() => open(null)}><Plus /></Button></div>
        <div className="relative px-3 py-1.5"><Search className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" /><input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter conversations" placeholder="Filter conversations…" className="h-8 w-full rounded-control border border-line bg-bg-elev pl-8 pr-2 text-ui outline-none focus:border-accent/60" /></div>
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
          {list.isLoading ? <li className="space-y-1.5 p-1"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></li> : list.isError ? <li className="p-2 text-ui text-danger-text">Could not load the conversations. <button type="button" className="underline" onClick={() => list.refetch()}>Retry</button></li>
            : rows.length ? rows.map((c) => <li key={c.id} className="group/c relative"><button type="button" aria-current={c.id === current} onClick={() => open(c.id)} className={cn("flex min-h-9 w-full items-center gap-1.5 rounded-control py-1 pl-2 pr-8 text-left text-ui hover:bg-bg-hover", c.id === current && "bg-bg-elev font-medium shadow-card")}>{c.pinned && <Pin className="size-3 shrink-0 text-fg-muted" />}<span className="min-w-0 flex-1"><span className="block truncate">{c.title || "Untitled conversation"}</span><span className="block text-micro font-normal text-fg-muted">{timeAgo(c.updatedAt)}{c.pageId ? " · on a page" : ""}</span></span></button><button type="button" aria-label={`Remove conversation ${c.title}`} onClick={() => remove(c)} className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-chip text-fg-muted opacity-0 hover:bg-bg-sunk hover:text-danger-text focus-visible:opacity-100 group-hover/c:opacity-100"><Trash2 className="size-3.5" /></button></li>)
            : <li className="flex flex-col items-center gap-2 px-3 py-8 text-center text-ui text-fg-muted"><MessagesSquare className="size-5" />{q ? "No conversation matches." : "No conversation yet. Ask something to start one."}</li>}
        </ul>
      </aside>
      <section aria-label="Assistant" className="flex min-w-0 flex-1 flex-col bg-bg"><div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">{mounted ? <Chat key={`${gen}:${conv ?? "new"}`} pageId={null} conversationId={conv} prefill={prefill} /> : <div className="space-y-2 p-4"><Skeleton className="h-9" /><Skeleton className="h-32" /></div>}</div></section>
    </div>
  );
}
