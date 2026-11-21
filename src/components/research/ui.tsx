/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/research/ui.tsx
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
/**
 * Shared bits of the research workspace. Phone rules live here once: `TAP` (44 px targets below `md`), `FIELD` (44 px, 16 px text so iOS
 * does not zoom), icon buttons with a label, confirm sheet, list skeleton, retryable error box, drafts that survive closing a sheet.
 */
import * as React from "react";
import { Badge, Dialog, SheetContent, Skeleton } from "@/components/ui/primitives";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AlertTriangle, Plus, RotateCw, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";

export const PAPER_STATUSES = ["planning", "research", "development", "writing", "submitted", "published"] as const;
export const STATUS_TONE: Record<string, "neutral" | "accent" | "ai" | "success" | "warning" | "danger"> = { planning: "neutral", research: "accent", development: "ai", writing: "warning", submitted: "warning", published: "success" };
export const EXP_TONE: Record<string, "neutral" | "accent" | "ai" | "success" | "warning" | "danger"> = { planned: "neutral", running: "accent", done: "success", failed: "danger" };

/** 44 px touch target on phones, compact from `md` up. */
export const TAP = "min-h-11 md:min-h-8";
/** Form control: 44 px high and 16 px text on phones (no iOS zoom), compact on desktop. */
export const FIELD = "h-11 text-[16px] md:h-8 md:text-[13px]";
export const AREA = "text-[16px] md:text-[13px]";

/** Button with a phone-sized target (the base `Button` sizes are desktop sizes). */
export const TButton = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, size = "sm", ...p }, ref) => <Button ref={ref} size={size} className={cn("h-11 px-3.5 md:h-8 md:px-2.5", className)} {...p} />);
TButton.displayName = "TButton";
/** Icon-only button: 44 px on phones, always labelled. */
export function IconBtn({ label, className, danger, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }) {
  return <button type="button" aria-label={label} title={label} className={cn("grid size-11 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-bg-sunk hover:text-fg disabled:opacity-40 md:size-8 [&_svg]:size-[18px] md:[&_svg]:size-4", danger && "hover:text-danger-text", className)} {...p}>{children}</button>;
}
export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-11 min-w-0 rounded-md border border-line bg-bg-elev px-2 text-[16px] shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 md:h-8 md:text-[13px]", className)} {...p}>{children}</select>;
}
export function Field({ label, children, className, hint }: { label: React.ReactNode; children: React.ReactNode; className?: string; hint?: React.ReactNode }) {
  return <label className={cn("flex min-w-0 flex-col gap-1", className)}><span className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">{label}</span>{children}{hint && <span className="text-[12px] leading-snug text-fg-faint">{hint}</span>}</label>;
}
export function VerifiedBadge({ v }: { v: string }) {
  return v === "doi_verified" ? <Badge tone="success">DOI verified</Badge> : v === "ai_suggested" ? <Badge tone="ai">AI suggested</Badge> : <Badge tone="neutral">Manual</Badge>;
}
export function AILabel({ model }: { model?: string | null }) { return <Badge tone="ai">AI-generated{model ? ` · ${model}` : ""}</Badge>; }

/** Loading placeholder for a list of cards. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="mt-3 space-y-2" role="status" aria-label="Loading">{Array.from({ length: rows }, (_v, i) => <div key={i} className="rounded-lg border border-line bg-bg-elev p-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-2 h-3 w-1/2" /></div>)}</div>;
}
/** Error with what happened and a way out. */
export function ErrorBox({ title = "Could not load", message, onRetry, className, children }: { title?: string; message?: string; onRetry?: () => void; className?: string; children?: React.ReactNode }) {
  return (
    <div role="alert" className={cn("mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-[13px]", className)}>
      <AlertTriangle className="size-4 shrink-0 text-danger" />
      <div className="min-w-0 flex-1"><div className="font-medium">{title}</div>{message && <div className="break-words text-fg-muted">{message}</div>}</div>
      {children}
      {onRetry && <TButton variant="outline" onClick={onRetry}><RotateCw /> Retry</TButton>}
    </div>
  );
}
/** Human sentence for a failed request (network vs server). */
export const errText = (e: unknown) => { const x = e as { status?: number; message?: string }; return x?.status === 0 ? "No connection to the server. Nothing was lost — try again when you are back online." : x?.message || "Something went wrong."; };

/** Confirmation in a sheet (never `window.confirm`): says what will happen, one clear action. */
export function Confirm({ open, onOpenChange, title, description, confirmLabel, danger, busy, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: React.ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><SheetContent title={title} description={description}>
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end"><TButton variant="ghost" onClick={() => onOpenChange(false)}>Cancel</TButton><TButton variant={danger ? "danger" : "default"} disabled={busy} onClick={onConfirm}>{confirmLabel}</TButton></div>
    </SheetContent></Dialog>
  );
}
/** Form state that survives closing the sheet and a reload of the tab (sessionStorage); `clear()` after a successful save. */
export function useDraft<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void, () => void] {
  const [v, setV] = React.useState<T>(initial); const loaded = React.useRef(false);
  React.useEffect(() => { loaded.current = false; try { const s = sessionStorage.getItem(`draft:${key}`); setV(s ? { ...(initial as object), ...JSON.parse(s) } as T : initial); } catch { setV(initial); } loaded.current = true; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);
  const set = React.useCallback((n: T | ((p: T) => T)) => setV((p) => { const next = typeof n === "function" ? (n as (p: T) => T)(p) : n; try { sessionStorage.setItem(`draft:${key}`, JSON.stringify(next)); } catch {} return next; }), [key]);
  const clear = React.useCallback(() => { try { sessionStorage.removeItem(`draft:${key}`); } catch {} setV(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);
  return [v, set, clear];
}

/** Key/value editor over a flat object (numbers are kept numeric). Rows stack on phones; every control is a full-size target. */
export function KVEditor({ value, onChange, placeholderKey = "key", placeholderValue = "value" }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; placeholderKey?: string; placeholderValue?: string }) {
  const rows = Object.entries(value ?? {}); const [draft, setDraft] = React.useState<{ k: string; v: string }>({ k: "", v: "" });
  const commit = (k: string, v: string, oldKey?: string) => { const n: Record<string, unknown> = {}; for (const [kk, vv] of rows) { if (kk === oldKey) continue; n[kk] = vv; } if (k.trim()) n[k.trim()] = v.trim() !== "" && !isNaN(Number(v)) && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v.trim()) ? Number(v) : v; onChange(n); };
  const add = () => { if (!draft.k.trim()) return; commit(draft.k, draft.v); setDraft({ k: "", v: "" }); };
  return (
    <div className="space-y-1.5">
      {rows.map(([k, v]) => <div key={k} className="flex items-center gap-1"><Input defaultValue={k} aria-label="Name" autoCapitalize="none" className={cn(FIELD, "w-[40%] font-mono")} onBlur={(e) => { if (e.target.value !== k) commit(e.target.value, String(v ?? ""), k); }} /><Input defaultValue={String(v ?? "")} aria-label={`Value of ${k}`} autoCapitalize="none" className={cn(FIELD, "min-w-0 flex-1 font-mono")} onBlur={(e) => { if (e.target.value !== String(v ?? "")) commit(k, e.target.value, k); }} /><IconBtn label={`Remove ${k}`} danger onClick={() => { const n = { ...value }; delete n[k]; onChange(n); }}><X /></IconBtn></div>)}
      <div className="flex items-center gap-1"><Input value={draft.k} placeholder={placeholderKey} aria-label="New name" autoCapitalize="none" className={cn(FIELD, "w-[40%] font-mono")} onChange={(e) => setDraft({ ...draft, k: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} /><Input value={draft.v} placeholder={placeholderValue} aria-label="New value" autoCapitalize="none" className={cn(FIELD, "min-w-0 flex-1 font-mono")} onChange={(e) => setDraft({ ...draft, v: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} /><IconBtn label="Add" disabled={!draft.k.trim()} onClick={add}><Plus /></IconBtn></div>
    </div>
  );
}

/** Insert Markdown into the open page editor (PageView listens for this event). */
export function insertMarkdown(md: string) { window.dispatchEvent(new CustomEvent("note:insert-markdown", { detail: { markdown: md, plain: true } })); }
/** Save Markdown as a new note (wrapped in an AI block so provenance stays visible). */
export async function saveAsNote(md: string, title: string, model?: string | null) {
  const { markdownToDoc } = await import("@/lib/editor/markdown-client");
  const p = await api("/api/pages", { method: "POST", json: { title: title.slice(0, 120) || "AI research note", section: "research", content: { type: "doc", content: [{ type: "aiBlock", attrs: { model: model ?? "assistant", at: new Date().toISOString() }, content: markdownToDoc(md) }] } } });
  toast("Saved as a note", { tone: "success" }); return p as { id: string };
}
/** Clipboard with a fallback for browsers/contexts without the async API. */
export const copy = (s: string, msg = "Copied") => {
  const fallback = () => { try { const t = document.createElement("textarea"); t.value = s; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); toast(ok ? msg : "Copy failed — select the text and copy it manually", ok ? {} : { tone: "danger" }); } catch { toast("Copy failed — select the text and copy it manually", { tone: "danger" }); } };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(s).then(() => toast(msg)).catch(fallback); else fallback();
};
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const shortAuthors = (a: string[] | null | undefined) => { const ln = (a ?? []).map((x) => x.trim().split(/\s+/).pop() ?? ""); return ln.length === 0 ? "—" : ln.length === 1 ? ln[0] : ln.length === 2 ? `${ln[0]} & ${ln[1]}` : `${ln[0]} et al.`; };
export const dateInput = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
