"use client";
/**
 * File: src/components/database/RowTemplates.tsx
 * Description: Databases Next Generation — row templates in the UI: the "New from template" menu next to the New button, the
 *   management panel (rename, default, delete) and "Save as template" (captures the values and the body of a row).
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FilePlus2, LayoutTemplate, Star, Trash2, Plus } from "lucide-react";
import { Dialog, DialogContent, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { RowOut, RowTemplate } from "@/lib/databases/types";
import { useDb } from "./hooks";
import { inputCls } from "./meta";

/** Captures a row (its stored values, relations, icon and page body) as a template of the database. */
export function useSaveAsTemplate() {
  const ctx = useDb(); const qc = useQueryClient();
  return async (row: RowOut) => {
    const name = prompt("Name of the template", row.title && row.title !== "Untitled" ? row.title : "Template"); if (!name?.trim()) return;
    try { await api(`/api/databases/${ctx.db.id}/row-templates`, { method: "POST", json: { name: name.trim(), fromRowId: row.id } }); qc.invalidateQueries({ queryKey: ["db-row-templates", ctx.db.id] }); toast(`Template “${name.trim()}” saved`, { description: "New ▾ creates a row from it.", tone: "success" }); }
    catch (e: any) { toast("Could not save the template", { description: e?.message, tone: "danger" }); }
  };
}
/** The ▾ next to "New": an empty row, one row per template, and the management panel. */
export function NewFromTemplate({ className }: { className?: string }) {
  const ctx = useDb(); const [manage, setManage] = useState(false);
  return (
    <>
      <Menu>
        <MenuTrigger asChild><button type="button" aria-label="New row from a template" className={className}><ChevronDown className="size-4" /></button></MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => ctx.newRow({}, null)}><Plus /> Empty row</MenuItem>
          {ctx.templates.length > 0 && <MenuSeparator />}
          {ctx.templates.map((t) => <MenuItem key={t.id} onSelect={() => ctx.newRow({}, t.id)}><FilePlus2 /> <span className="truncate">{t.icon ? `${t.icon} ` : ""}{t.name}</span>{t.isDefault && <Star className="ml-auto size-3 text-fg-muted" aria-label="default" />}</MenuItem>)}
          <MenuSeparator />
          <MenuItem onSelect={() => setManage(true)}><LayoutTemplate /> Row templates…</MenuItem>
        </MenuContent>
      </Menu>
      <Dialog open={manage} onOpenChange={setManage}>
        <DialogContent title="Row templates" description="A template presets the values and the body of a new row. Create one from a row: open the row, then “Save as template”.">
          <TemplateList />
        </DialogContent>
      </Dialog>
    </>
  );
}
function TemplateList() {
  const ctx = useDb(); const qc = useQueryClient(); const inv = () => qc.invalidateQueries({ queryKey: ["db-row-templates", ctx.db.id] });
  const call = async (fn: () => Promise<unknown>, fail: string) => { try { await fn(); await inv(); } catch (e: any) { toast(fail, { description: e?.message, tone: "danger" }); } };
  const patch = (t: RowTemplate, body: Record<string, unknown>) => call(() => api(`/api/databases/${ctx.db.id}/row-templates`, { method: "PATCH", json: { id: t.id, ...body } }), "Could not update the template");
  if (!ctx.templates.length) return <p className="py-6 text-center text-[13px] text-fg-muted">No template yet.</p>;
  return (
    <ul className="space-y-1.5" aria-label="Row templates">
      {ctx.templates.map((t) => (
        <li key={t.id} className="flex items-center gap-1.5">
          <input aria-label={`Name of the template ${t.name}`} defaultValue={t.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) void patch(t, { name: v }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={cn(inputCls, "min-w-0 flex-1")} />
          <span className="shrink-0 text-[11px] tabular-nums text-fg-muted">{Object.keys(t.values).length} value{Object.keys(t.values).length === 1 ? "" : "s"}{t.content ? " · body" : ""}</span>
          <Button size="xs" variant={t.isDefault ? "outline" : "ghost"} aria-pressed={t.isDefault} className="max-md:h-11" onClick={() => patch(t, { isDefault: !t.isDefault })} title="The default template is used by the New button"><Star /> {t.isDefault ? "Default" : "Make default"}</Button>
          <Button size="xs" variant="ghost" className="text-danger-text max-md:h-11" aria-label={`Delete the template ${t.name}`} onClick={() => { if (confirm(`Delete the template “${t.name}”? Rows created from it are not touched.`)) void call(() => api(`/api/databases/${ctx.db.id}/row-templates?id=${t.id}`, { method: "DELETE" }), "Could not delete the template"); }}><Trash2 /></Button>
        </li>
      ))}
    </ul>
  );
}
