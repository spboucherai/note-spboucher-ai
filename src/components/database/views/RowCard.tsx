/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/views/RowCard.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
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
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RowOut } from "@/lib/databases/types";
import { isEmpty } from "@/lib/databases/values";
import { isPending, isError } from "@/lib/databases/types";
import { useDb } from "../hooks";
import { CellDisplay } from "../cells/Cell";

/**
 * Phone card of a row: title + the view's priority properties (label and value on one line each).
 * The whole card is one button that opens the row sheet, where every property can be read and edited.
 * Links inside values (URLs, relations, files) stay tappable on their own.
 */
export function RowCard({ row, exclude, className }: { row: RowOut; exclude?: string; className?: string }) {
  const ctx = useDb();
  const shown = ctx.priorityProps.filter((p) => p.id !== exclude && (!isEmpty(row.values[p.id]) || isPending(row.values[p.id]) || isError(row.values[p.id])));
  return (
    <div className={cn("relative rounded-xl border border-line bg-bg-elev shadow-card", className)}>
      <button
        type="button"
        onClick={() => ctx.open(row.id)}
        aria-label={`Open ${row.title || "Untitled"}`}
        className="absolute inset-0 rounded-xl focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-bg-hover/60"
      />
      <div className="pointer-events-none relative px-3.5 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 text-[15px] font-semibold leading-5 [overflow-wrap:anywhere]">
            {row.icon ? `${row.icon} ` : ""}{row.title || <span className="font-normal text-fg-faint">Untitled</span>}
          </div>
          <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-faint" />
        </div>
        {shown.length > 0 && (
          <dl className="mt-2 space-y-1.5">
            {shown.map((p) => (
              <div key={p.id} className="flex min-w-0 items-baseline gap-2 text-[13px] leading-5">
                <dt className="w-[5.5rem] shrink-0 truncate text-fg-muted">{p.name}</dt>
                <dd className="min-w-0 flex-1 [overflow-wrap:anywhere] [&_a]:pointer-events-auto"><CellDisplay p={p} value={row.values[p.id]} compact /></dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
