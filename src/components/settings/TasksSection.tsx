/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/settings/TasksSection.tsx
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
import Link from "next/link";
import { BellOff, CheckSquare } from "lucide-react";
/** Tasks & notifications. Honest by design: no notification channel exists in this installation, so none is pretended. */
export function TasksSection() {
  return (
    <div className="space-y-6">
      <section><h2 className="flex items-center gap-2 text-[15px] font-semibold"><CheckSquare className="size-4 text-fg-muted" />Tasks</h2>
        <ul className="mt-2 space-y-1.5 rounded-2xl border border-line bg-bg-elev p-4 text-[13.5px] leading-5 text-fg-muted">
          <li>A task has a title, a status, a priority, a due date and an optional link to the note it came from.</li>
          <li>Checklists captured with <b className="text-fg">+ → To-do</b> become tasks from the inbox (“Turn into a task”), linked to their note.</li>
          <li>Due and overdue tasks are shown on Home and in <Link className="font-medium text-accent" href="/tasks">Tasks</Link>, sorted by date.</li>
        </ul></section>
      <section><h2 className="flex items-center gap-2 text-[15px] font-semibold"><BellOff className="size-4 text-fg-muted" />Reminders & notifications</h2>
        <div className="mt-2 rounded-2xl border border-line bg-bg-elev p-4 text-[13.5px] leading-5 text-fg-muted">
          <p><b className="text-fg">Not available.</b> This installation has no push service, no e-mail sender and no calendar integration configured, so the app cannot notify you when it is closed — and it does not pretend to. Recurring tasks are not offered for the same reason: nothing would reliably create or announce the next occurrence.</p>
          <p className="mt-2">What works today: open the app and due tasks are on Home. If a reliable channel is added later (web push for the installed app, or e-mail), reminders belong here.</p>
        </div></section>
    </div>
  );
}
