/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/shell/ShortcutsDialog.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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
import { Dialog, DialogContent, Kbd } from "@/components/ui/primitives";
const GROUPS: { title: string; rows: [string, string][] }[] = [
  { title: "Navigation", rows: [["⌘ K", "Search & commands"], ["Tab", "Titles ↔ content search (in palette)"], ["⌘ \\", "Toggle sidebar"], ["⌘ .", "Focus mode"], ["⌘ ?", "This help"], /* NEXT-K */ ["⌥ 1 – 4", "Zoom: synopsis / outline / full / + connections (on a page)"]] },
  { title: "Create", rows: [["⌘ ⇧ N", "New page"], ["/", "Block menu (in editor)"], ["@", "Link a page (in editor)"]] },
  { title: "AI", rows: [["⌘ /", "Toggle AI assistant"], ["⌘ J", "AI on selection (in editor)"], ["⏎ / ⇧ ⏎", "Send / new line (chat)"]] },
  { title: "Editing", rows: [["⌘ B / I / U", "Bold / italic / underline"], ["⌘ E", "Inline code"], ["⌘ ⇧ 8 / 7", "Bulleted / numbered list"], ["Tab / ⇧ Tab", "Indent / outdent"], ["⌘ Z / ⌘ ⇧ Z", "Undo / redo"]] },
];
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" description="Ctrl replaces ⌘ on Windows and Linux." wide className="max-w-2xl">
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-faint">{g.title}</h3>
              <dl className="divide-y divide-line rounded-lg border border-line">
                {g.rows.map(([k, l]) => <div key={k} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]"><dt className="text-fg-muted">{l}</dt><dd className="flex shrink-0 gap-1">{k.split(" / ").map((x) => <Kbd key={x}>{x}</Kbd>)}</dd></div>)}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
