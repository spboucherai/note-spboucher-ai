/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/page/PageProperties.tsx
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
/** Lightweight page-level properties (tags, status, due) — database rows use the full engine. */
import { useState } from "react";
import { Tag, Plus, X } from "lucide-react";
export function PageProperties({ page, onChange }: { page: any; onChange: (props: Record<string, unknown>) => void }) {
  const [props, setProps] = useState<Record<string, any>>(page.properties ?? {});
  const tags: string[] = props.tags ?? [];
  // merge into the freshest server copy so sibling editors (research panel status, etc.) are not overwritten
  const set = async (p: Record<string, any>) => { let base = props; try { const fresh = await fetch(`/api/pages/${page.id}`).then((r) => r.json()); if (fresh?.properties) base = fresh.properties; } catch {} const n = { ...base, ...p }; setProps(n); onChange(n); };
  if (page.databaseId) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
      <Tag className="size-3.5 text-fg-faint" />
      {tags.map((t) => <span key={t} className="flex items-center gap-1 rounded-md bg-bg-sunk px-1.5 py-0.5 text-fg-muted">{t}<button onClick={() => set({ tags: tags.filter((x) => x !== t) })}><X className="size-3" /></button></span>)}
      <button className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-fg-faint hover:bg-bg-sunk hover:text-fg-muted" onClick={() => { const t = window.prompt("Add tag"); if (t?.trim() && !tags.includes(t.trim())) set({ tags: [...tags, t.trim()] }); }}><Plus className="size-3" /> tag</button>
    </div>
  );
}
