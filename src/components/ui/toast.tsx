/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/ui/toast.tsx
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
import * as React from "react";
import { cn } from "@/lib/utils";
type T = { id: number; title: string; description?: string; tone?: "neutral" | "success" | "danger" | "ai"; action?: { label: string; run: () => void | Promise<void> }; duration?: number };
let push: ((t: Omit<T, "id">) => void) | null = null;
/** Transient message. With `action` (e.g. Undo) it stays 8 s and the button is a full-size touch target. Announced to screen readers. */
export function toast(title: string, opts: Omit<T, "id" | "title"> = {}) { push?.({ title, ...opts }); }
export function Toaster() {
  const [items, set] = React.useState<T[]>([]);
  React.useEffect(() => { push = (t) => { const id = Date.now() + Math.random(); set((s) => [...s.slice(-2), { ...t, id }]); setTimeout(() => set((s) => s.filter((x) => x.id !== id)), t.duration ?? (t.action ? 8000 : 4200)); }; return () => { push = null; }; }, []);
  return <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--kb,0px)+5rem+env(safe-area-inset-bottom))] z-[100] flex flex-col items-stretch gap-2 md:inset-x-auto md:bottom-4 md:right-4 md:items-end">{items.map((t) => (
    <div key={t.id} className={cn("pointer-events-auto flex w-full items-center gap-3 rounded-xl border bg-bg-elev p-3 shadow-pop fade-up md:w-80", t.tone === "danger" ? "border-danger/40" : t.tone === "success" ? "border-success/40" : t.tone === "ai" ? "border-ai/40" : "border-line")}>
      <div className="min-w-0 flex-1"><div className="text-sm font-medium">{t.title}</div>{t.description && <div className="mt-0.5 text-[13px] leading-5 text-fg-muted">{t.description}</div>}</div>
      {t.action && <button type="button" className="h-10 shrink-0 rounded-lg px-3 text-[14px] font-semibold text-accent active:bg-accent-soft" onClick={async () => { set((s) => s.filter((x) => x.id !== t.id)); await t.action!.run(); }}>{t.action.label}</button>}
    </div>))}</div>;
}
