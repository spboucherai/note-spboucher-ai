"use client";
/**
 * File: src/components/database/growing.tsx
 * Description: incremental loading for the views that are not virtualised (phone cards, list, gallery, board columns): they show the
 *   first rows and load 100 more when the end comes into view (or on "Load more"). Rows come from the view window (`ctx.win`).
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { useEffect, useRef, useState } from "react";
import type { RowOut } from "@/lib/databases/types";
import { useDb } from "./hooks";
import { PAGE, type Win } from "./window";
import type { ViewGroup } from "./group";

/** `shown` = how many rows of the view order are wanted; grows by one page each time `more()` runs. Declares the range to the window. */
export function useGrowing(step = PAGE) {
  const ctx = useDb(); const [state, setState] = useState({ key: "", shown: step }); const key = `${ctx.view.id}|${ctx.search}`;
  const shown = state.key === key ? state.shown : step;
  const { ensure } = ctx.win; useEffect(() => { ensure([[0, shown]]); }, [ensure, shown]);
  return { shown, more: () => setState({ key, shown: Math.min(shown + step, Math.max(step, ctx.total)) }) };
}
/** Rows of one group among the first `shown` rows of the view order (an ungrouped view is one group at offset 0). */
export function rowsOfGroup(win: Win, g: ViewGroup, shown: number): RowOut[] {
  const out: RowOut[] = []; for (let i = g.offset; i < Math.min(g.offset + g.count, shown); i++) { const r = win.rowAt(i); if (r) out.push(r); }
  return out;
}
/** Sentinel + button under a growing list: loads the next page when it scrolls into view, or on click / tap. */
export function LoadMore({ shown, more, className }: { shown: number; more: () => void; className?: string }) {
  const ctx = useDb(); const ref = useRef<HTMLButtonElement>(null); const left = ctx.total - Math.min(shown, ctx.total); const fn = useRef(more); fn.current = more;
  useEffect(() => {
    const el = ref.current; if (!el || left <= 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) fn.current(); }, { rootMargin: "400px" }); io.observe(el); return () => io.disconnect();
  }, [left, shown]);
  if (left <= 0) return null;
  return <button ref={ref} type="button" onClick={more} data-testid="load-more" className={className ?? "flex h-10 w-full items-center justify-center rounded-lg border border-dashed border-line text-[13px] text-fg-muted hover:bg-bg-sunk max-md:h-11 max-md:text-[14px]"}>{ctx.win.fetching ? "Loading…" : `Load more · ${left.toLocaleString("en-CA")} more row${left === 1 ? "" : "s"}`}</button>;
}
