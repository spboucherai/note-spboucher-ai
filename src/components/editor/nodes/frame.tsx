/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/editor/nodes/frame.tsx
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
/**
 * file: src/components/editor/nodes/frame.tsx
 * description: shared chrome and contract of the Next Generation node views. Every new block is a leaf atom rendered by a React
 *   component that receives `LeafViewProps` and wraps its content in `<NodeFrame>` (card, header, actions, selection ring). The frame
 *   never widens the page: bodies scroll inside themselves. `data-nv-stop` marks the area where ProseMirror must leave pointer, key and
 *   clipboard events to the block (canvases, text layers, grids).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { cn } from "@/lib/utils";

export interface LeafViewProps<A> {
  /** The node's attrs exactly as stored (plus the block `id`). Treat as immutable. */
  attrs: A & { id?: string | null };
  /** Merge a patch into the attrs (one undoable transaction). No-op when the editor is read-only. */
  update: (patch: Partial<A>) => void;
  editable: boolean;
  /** True while the block is the ProseMirror node selection. */
  selected: boolean;
  /** Page being edited (attachments are uploaded against it); null in previews. */
  pageId: string | null;
  editor: Editor;
  getPos: () => number | undefined;
  deleteNode: () => void;
}

export function NodeFrame({ kind, icon, label, title, actions, children, selected, tone = "neutral", bare, className, bodyClassName, stop = true }: {
  /** node type name — becomes data-node (tests and CSS hook) */ kind: string; icon?: React.ReactNode; /** small uppercase type label, e.g. "Diagram" */ label: string; /** optional title next to the label */ title?: React.ReactNode;
  /** buttons on the right of the header (use `NodeButton`) */ actions?: React.ReactNode; children?: React.ReactNode; selected?: boolean; tone?: "neutral" | "ai" | "accent"; /** no card, no header (inline-looking blocks) */ bare?: boolean; className?: string; bodyClassName?: string;
  /** false = let ProseMirror handle events in the body too (purely presentational bodies) */ stop?: boolean;
}) {
  return (
    <NodeViewWrapper as="div" className={cn("nb", bare && "nb-bare", className)} data-node={kind} data-tone={tone} data-selected={selected ? "true" : undefined}>
      {!bare && (
        <div className="nb-head" contentEditable={false}>
          <span className="nb-icon" aria-hidden>{icon}</span><span className="nb-label">{label}</span>
          {title != null && title !== "" && <span className="nb-title">{title}</span>}
          {actions && <span className="nb-actions">{actions}</span>}
        </div>
      )}
      <div className={cn("nb-body", bodyClassName)} contentEditable={false} {...(stop ? { "data-nv-stop": "" } : {})}>{children}</div>
    </NodeViewWrapper>
  );
}
/** Header / toolbar button of a node view (32 px, 44 px on touch). Always give `label` (tooltip + accessible name). */
export function NodeButton({ label, onClick, children, active, disabled, tone, className, text }: { label: string; onClick?: (e: React.MouseEvent) => void; children?: React.ReactNode; active?: boolean; disabled?: boolean; tone?: "ai" | "danger" | "accent"; className?: string; /** show `label` as visible text after the icon */ text?: boolean }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick} data-tone={tone} className={cn("nb-btn", text && "nb-btn-text", active && "is-active", className)}>{children}{text && <span>{label}</span>}</button>;
}
/** Neutral empty / unavailable / error state inside a block. */
export function NodeState({ icon, title, hint, children, tone = "neutral" }: { icon?: React.ReactNode; title: string; hint?: React.ReactNode; children?: React.ReactNode; tone?: "neutral" | "danger" }) {
  return <div className="nb-state" data-tone={tone}>{icon && <span className="nb-state-icon" aria-hidden>{icon}</span>}<div className="min-w-0"><div className="nb-state-title">{title}</div>{hint && <div className="nb-state-hint">{hint}</div>}</div>{children && <div className="nb-state-actions">{children}</div>}</div>;
}
/** Debounced callback that is flushed on unmount (attrs edited in a textarea are written a moment after typing stops, never per key). */
export function useDebounced<T extends unknown[]>(fn: (...a: T) => void, ms: number) {
  const ref = React.useRef(fn); ref.current = fn; const t = React.useRef<ReturnType<typeof setTimeout> | null>(null); const last = React.useRef<T | null>(null);
  const flush = React.useCallback(() => { if (t.current) { clearTimeout(t.current); t.current = null; } if (last.current) { const a = last.current; last.current = null; ref.current(...a); } }, []);
  React.useEffect(() => flush, [flush]);
  const call = React.useCallback((...a: T) => { last.current = a; if (t.current) clearTimeout(t.current); t.current = setTimeout(flush, ms); }, [flush, ms]);
  return Object.assign(call, { flush });
}
