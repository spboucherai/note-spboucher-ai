/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/Responsive.tsx
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
import * as React from "react";
import { Dialog, DialogTrigger, SheetContent, Popover, PopoverTrigger, PopoverContent } from "@/components/ui/primitives";
import { useIsPhone } from "@/lib/client/hooks";

/**
 * One panel, two presentations: a popover anchored to its trigger on desktop, a bottom sheet on phones
 * (phone-first rule 4: details and forms open in a sheet, never in a popover full of small controls).
 * `trigger` must be a single element that accepts a ref (a native button or div).
 */
export function ResponsivePanel({ open, onOpenChange, trigger, title, description, children, className, align, focusFirstInput }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  /** Sheet title on phones (popovers have no title bar). */
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Popover classes (desktop only). */
  className?: string;
  align?: "start" | "center" | "end";
  /** Desktop: move focus to the first input when the popover opens. Never done on phones (it would pop the keyboard over the list). */
  focusFirstInput?: boolean;
}) {
  const phone = useIsPhone();
  if (phone) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <SheetContent title={title} description={description} onOpenAutoFocus={(e) => e.preventDefault()}>
          {children}
        </SheetContent>
      </Dialog>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={className}
        onOpenAutoFocus={focusFirstInput ? (e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("input")?.focus(); } : undefined}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Section heading inside a sheet. */
export function SheetSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-4 first:border-t-0 first:pt-1">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-[12px] leading-5 text-fg-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}
