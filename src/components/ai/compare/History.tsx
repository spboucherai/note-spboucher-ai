/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/ai/compare/History.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
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
import { Clock } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
export interface HistoryItem { id: string; prompt: string; models: string[]; createdAt: string }
export function History({ items, current, votes, onOpen }: { items: HistoryItem[]; current: string | null; votes: Record<string, { model: string }>; onOpen: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-line bg-bg-elev shadow-card">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[12.5px] font-semibold"><Clock className="size-3.5 text-fg-muted" />History<span className="ml-auto font-normal text-fg-muted">{items.length}</span></div>
      <ul className="max-h-[60vh] overflow-y-auto p-1">{items.map((h) => <li key={h.id}><button onClick={() => onOpen(h.id)} className={cn("w-full rounded-md px-2 py-1.5 text-left hover:bg-bg-sunk", current === h.id && "bg-accent-soft/60")}><div className="line-clamp-2 text-[12.5px]">{h.prompt}</div><div className="mt-0.5 flex items-center gap-1 text-[11px] text-fg-muted"><span className="truncate font-mono">{h.models.length} models{votes[h.id] ? ` · best: ${votes[h.id].model}` : ""}</span><span className="ml-auto shrink-0">{timeAgo(h.createdAt)}</span></div></button></li>)}{!items.length && <li className="px-2 py-6 text-center text-[12px] text-fg-muted">No comparisons yet.</li>}</ul>
    </div>
  );
}
