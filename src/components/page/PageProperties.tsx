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
