/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/ui/error-state.tsx
 * Description      : Load-failure state of a list or panel: never to be
 *                    confused with an empty state. Announced (`role="alert"`),
 *                    shows the message of the error and a Retry button with a
 *                    44 px touch target. Also exports the "Show more" footer of
 *                    paged lists.
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
import * as React from "react";
import { TriangleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";

export const errorMessage = (e: unknown) => (e instanceof Error && e.message ? e.message : typeof e === "string" && e ? e : "Something went wrong.");

export function ErrorState({ title, error, onRetry, retrying, testId }: { title: string; error: unknown; onRetry: () => void; retrying?: boolean; testId?: string }) {
  return (
    <div role="alert" data-testid={testId} className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
      <div aria-hidden className="mb-1 grid size-12 place-items-center rounded-2xl border border-danger/30 bg-danger/10 text-danger-text [&_svg]:size-5"><TriangleAlert /></div>
      <div className="text-[14px] font-semibold tracking-[-0.01em]">{title}</div>
      <div className="max-w-sm break-words text-[13px] leading-5 text-fg-muted [overflow-wrap:anywhere]">{errorMessage(error)}</div>
      <div className="mt-3"><Button variant="outline" className="h-11 px-5 md:h-9" onClick={onRetry} disabled={retrying}>{retrying ? <Spinner className="size-3.5" /> : <RotateCw />} Retry</Button></div>
    </div>
  );
}

/** Footer of a paged list: "Show more" while the server has more rows, otherwise a note when the list is truncated. */
export function ListFooter({ shown, hasMore, onMore, loading, note, testId }: { shown: number; hasMore: boolean; onMore: () => void; loading?: boolean; note?: string | null; testId?: string }) {
  if (!hasMore && !note) return null;
  return (
    <div data-testid={testId} className="flex flex-col items-center gap-2 pt-3 text-center">
      <p className="text-[12.5px] leading-5 text-fg-muted" aria-live="polite">{note ?? `Showing the first ${shown}.`}</p>
      {hasMore && <Button variant="outline" className="h-11 px-5 md:h-9" onClick={onMore} disabled={loading}>{loading ? <Spinner className="size-3.5" /> : null} Show more</Button>}
    </div>
  );
}
