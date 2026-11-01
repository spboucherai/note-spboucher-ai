"use client";
import { Dialog, DialogContent, Kbd } from "@/components/ui/primitives";
const ROWS: [string, string][] = [["⌘ K", "Search & commands"], ["⌘ /", "Toggle AI assistant"], ["⌘ \\", "Toggle sidebar"], ["⌘ .", "Focus mode"], ["⌘ ⇧ N", "New page"], ["⌘ J", "AI on selection (in editor)"], ["/", "Block menu (in editor)"], ["@", "Link a page (in editor)"], ["⌘ B / I / U", "Bold / italic / underline"], ["⌘ E", "Inline code"], ["⌘ ⇧ 8 / 7", "Bulleted / numbered list"], ["⌘ Z / ⌘ ⇧ Z", "Undo / redo"], ["Tab / ⇧ Tab", "Indent / outdent list item"], ["⌘ ?", "This help"]];
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent title="Keyboard shortcuts"><div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">{ROWS.map(([k, l]) => <div key={k} className="contents"><div className="flex gap-1">{k.split(" / ").map((x) => <Kbd key={x}>{x}</Kbd>)}</div><div className="text-fg-muted">{l}</div></div>)}</div></DialogContent></Dialog>;
}
