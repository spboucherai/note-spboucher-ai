/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/editor/extensions/suggestion-ui.tsx
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
import React, { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance } from "tippy.js";
import { cn } from "@/lib/utils";

export interface Item { id: string; title: string; hint?: string; icon?: React.ReactNode; group?: string; run?: () => void; data?: any }
export const SuggestionList = forwardRef<{ onKeyDown: (p: { event: KeyboardEvent }) => boolean }, { items: Item[]; command: (item: Item) => void; empty?: string }>(({ items, command, empty = "No results" }, ref) => {
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [items]);
  useImperativeHandle(ref, () => ({ onKeyDown: ({ event }) => {
    if (event.key === "ArrowUp") { setIdx((i) => (i + items.length - 1) % Math.max(1, items.length)); return true; }
    if (event.key === "ArrowDown") { setIdx((i) => (i + 1) % Math.max(1, items.length)); return true; }
    if (event.key === "Enter") { if (items[idx]) command(items[idx]); return true; }
    return false;
  } }));
  useEffect(() => { document.getElementById(`sg-${idx}`)?.scrollIntoView({ block: "nearest" }); }, [idx]);
  if (!items.length) return <div className="rounded-lg border border-line bg-bg-elev px-3 py-2 text-[13px] text-fg-muted shadow-pop">{empty}</div>;
  let lastGroup: string | undefined;
  return (
    <div className="max-h-80 w-72 overflow-y-auto rounded-lg border border-line bg-bg-elev p-1 shadow-pop fade-up">
      {items.map((it, i) => { const g = it.group !== lastGroup ? it.group : null; lastGroup = it.group; return (
        <React.Fragment key={it.id}>
          {g && <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">{g}</div>}
          <button id={`sg-${i}`} type="button" onMouseEnter={() => setIdx(i)} onClick={() => command(it)} className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px]", i === idx ? "bg-bg-sunk" : "")}>
            <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-bg text-fg-muted [&_svg]:size-4">{it.icon ?? "•"}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{it.title}</span>{it.hint && <span className="block truncate text-[11px] text-fg-faint">{it.hint}</span>}</span>
          </button>
        </React.Fragment>); })}
    </div>
  );
});
SuggestionList.displayName = "SuggestionList";

/** Generic Tiptap suggestion renderer (slash commands, mentions) using ReactRenderer + tippy. */
export function makeRenderer(Component: React.ComponentType<any>, extra: Record<string, unknown> = {}) {
  return () => {
    let component: ReactRenderer<any> | null = null; let popup: Instance[] | null = null;
    return {
      onStart: (props: any) => {
        component = new ReactRenderer(Component, { props: { ...props, ...extra }, editor: props.editor });
        if (!props.clientRect) return;
        popup = tippy("body", { getReferenceClientRect: props.clientRect, appendTo: () => document.body, content: component.element, showOnCreate: true, interactive: true, trigger: "manual", placement: "bottom-start", arrow: false, theme: "none", offset: [0, 6] });
      },
      onUpdate: (props: any) => { component?.updateProps({ ...props, ...extra }); if (props.clientRect) popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect }); },
      onKeyDown: (props: any) => { if (props.event.key === "Escape") { popup?.[0]?.hide(); return true; } return component?.ref?.onKeyDown?.(props) ?? false; },
      onExit: () => { popup?.[0]?.destroy(); component?.destroy(); popup = null; component = null; },
    };
  };
}
