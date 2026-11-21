/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/editor/extensions/tasks.ts
 * Description      : rich tasks — the `taskItem` of 2.x extended with the
 *                    optional attrs of SPEC §2 (`due` ISO date, `priority`
 *                    low|medium|high, `taskId` uuid of the linked `tasks` row;
 *                    all null by default, so 2.x documents are unchanged). The
 *                    standard checkbox node view is kept as is; a small
 *                    non-editable chip group is appended to the item (due date,
 *                    priority, "+" to add them). A click on a chip asks the
 *                    editor to open the chip editor (`onEditChips`), anchored
 *                    on the chip.
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

import { TaskItem } from "@tiptap/extension-list";
import type { Node as PMNode } from "@tiptap/pm/model";
import { shortDate, isOverdue } from "@/lib/editor/query";

export interface TaskChipRequest { pos: number; anchor: HTMLElement }
const ICON_CAL = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/></svg>';
const ICON_LINK = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
const PRIORITY_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
const attr = (name: string, dataName: string) => ({ default: null, keepOnSplit: false, parseHTML: (el: HTMLElement) => el.getAttribute(dataName) || null, renderHTML: (a: Record<string, unknown>) => (a[name] ? { [dataName]: String(a[name]) } : {}) });

export const RichTaskItem = TaskItem.extend<{ nested: boolean; HTMLAttributes: Record<string, unknown>; taskListTypeName: string; onReadOnlyChecked?: (node: PMNode, checked: boolean) => boolean; a11y?: { checkboxLabel?: (node: PMNode, checked: boolean) => string }; onEditChips?: (req: TaskChipRequest) => void }>({
  addAttributes() { return { ...this.parent?.(), due: attr("due", "data-due"), priority: attr("priority", "data-priority"), taskId: attr("taskId", "data-task-id") }; },
  addNodeView() {
    const base = this.parent?.(); if (!base) return null as never;
    return (props) => {
      const view = base(props) as { dom: HTMLElement; contentDOM?: HTMLElement | null; update?: (node: PMNode, ...rest: unknown[]) => boolean; destroy?: () => void };
      const chips = document.createElement("span"); chips.className = "task-chips"; chips.contentEditable = "false";
      const open = (anchor: HTMLElement) => { const pos = typeof props.getPos === "function" ? props.getPos() : undefined; if (typeof pos === "number") this.options.onEditChips?.({ pos, anchor }); };
      const chip = (cls: string, html: string, label: string) => { const b = document.createElement("button"); b.type = "button"; b.className = `task-chip ${cls}`; b.innerHTML = html; b.setAttribute("aria-label", label); b.title = label; b.addEventListener("mousedown", (e) => e.preventDefault()); b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (props.editor.isEditable) open(b); }); return b; };
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
      let key = "";
      const render = (node: PMNode) => {
        const { due, priority, taskId, checked } = node.attrs as { due: string | null; priority: string | null; taskId: string | null; checked: boolean };
        const k = `${due}|${priority}|${taskId}|${checked}|${props.editor.isEditable}`; if (k === key) return; key = k;
        chips.replaceChildren();
        if (due) { const late = isOverdue(due, checked); chips.append(chip(`is-due${late ? " is-late" : ""}`, `${ICON_CAL}<span>${esc(shortDate(due))}</span>`, `Due ${shortDate(due)}${late ? " — overdue" : ""}. Edit`)); }
        if (priority && PRIORITY_LABEL[priority]) chips.append(chip(`is-priority is-${priority}`, `<span>${PRIORITY_LABEL[priority]}</span>`, `Priority: ${PRIORITY_LABEL[priority]}. Edit`));
        if (taskId) { const s = document.createElement("span"); s.className = "task-chip is-linked"; s.innerHTML = ICON_LINK; s.title = "Linked to your task list"; s.setAttribute("aria-label", "Linked to your task list"); chips.append(s); }
        if (props.editor.isEditable && !due && !priority) chips.append(chip("is-add", "<span>+</span>", "Add a due date or a priority"));
      };
      render(props.node); view.dom.append(chips);
      return {
        ...view,
        update: (node: PMNode, ...rest: unknown[]) => { const ok = view.update ? view.update(node, ...rest) : false; if (ok) render(node); return ok; },
        stopEvent: (e: Event) => chips.contains(e.target as globalThis.Node),
        ignoreMutation: (m: { type: string; target: globalThis.Node }) => (m.type === "selection" ? false : !view.contentDOM?.contains(m.target) || m.target === view.dom),
      } as ReturnType<typeof base>;
    };
  },
});
/** Attrs of the task item that contains the selection, with its position (null when the cursor is not in a task). */
export function taskAt(state: { selection: { $from: { depth: number; node: (d: number) => PMNode; before: (d: number) => number } } }): { pos: number; node: PMNode } | null {
  const { $from } = state.selection; for (let d = $from.depth; d > 0; d--) { const n = $from.node(d); if (n.type.name === "taskItem") return { pos: $from.before(d), node: n }; } return null;
}
