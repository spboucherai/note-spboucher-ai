"use client";
/** Small shared bits for the research workspace (select, field, key-value editor, badges, insert helpers). */
import * as React from "react";
import { Badge } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui/toast";

export const PAPER_STATUSES = ["planning", "research", "development", "writing", "submitted", "published"] as const;
export const STATUS_TONE: Record<string, "neutral" | "accent" | "ai" | "success" | "warning" | "danger"> = { planning: "neutral", research: "accent", development: "ai", writing: "warning", submitted: "warning", published: "success" };
export const EXP_TONE: Record<string, "neutral" | "accent" | "ai" | "success" | "warning" | "danger"> = { planned: "neutral", running: "accent", done: "success", failed: "danger" };

export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-8 rounded-md border border-line bg-bg-elev px-2 text-[13px] shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40", className)} {...p}>{children}</select>;
}
export function Field({ label, children, className, hint }: { label: React.ReactNode; children: React.ReactNode; className?: string; hint?: string }) {
  return <label className={cn("flex min-w-0 flex-col gap-1", className)}><span className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">{label}</span>{children}{hint && <span className="text-[11px] text-fg-faint">{hint}</span>}</label>;
}
export function VerifiedBadge({ v }: { v: string }) {
  return v === "doi_verified" ? <Badge tone="success">DOI verified</Badge> : v === "ai_suggested" ? <Badge tone="ai">AI suggested</Badge> : <Badge tone="neutral">Manual</Badge>;
}
export function AILabel({ model }: { model?: string | null }) { return <Badge tone="ai">AI-generated{model ? ` · ${model}` : ""}</Badge>; }

/** Key/value editor over a flat object (numbers are kept numeric). */
export function KVEditor({ value, onChange, placeholderKey = "key", placeholderValue = "value" }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; placeholderKey?: string; placeholderValue?: string }) {
  const rows = Object.entries(value ?? {}); const [draft, setDraft] = React.useState<{ k: string; v: string }>({ k: "", v: "" });
  const commit = (k: string, v: string, oldKey?: string) => { const n: Record<string, unknown> = {}; for (const [kk, vv] of rows) { if (kk === oldKey) continue; n[kk] = vv; } if (k.trim()) n[k.trim()] = v.trim() !== "" && !isNaN(Number(v)) && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v.trim()) ? Number(v) : v; onChange(n); };
  return (
    <div className="space-y-1">
      {rows.map(([k, v]) => <div key={k} className="flex items-center gap-1"><Input defaultValue={k} className="h-7 w-[38%] font-mono text-[12px]" onBlur={(e) => { if (e.target.value !== k) commit(e.target.value, String(v ?? ""), k); }} /><Input defaultValue={String(v ?? "")} className="h-7 flex-1 font-mono text-[12px]" onBlur={(e) => { if (e.target.value !== String(v ?? "")) commit(k, e.target.value, k); }} /><button className="grid size-7 shrink-0 place-items-center rounded text-fg-faint hover:bg-bg-sunk hover:text-danger" onClick={() => { const n = { ...value }; delete n[k]; onChange(n); }} aria-label="Remove"><X className="size-3.5" /></button></div>)}
      <div className="flex items-center gap-1"><Input value={draft.k} placeholder={placeholderKey} className="h-7 w-[38%] font-mono text-[12px]" onChange={(e) => setDraft({ ...draft, k: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && draft.k.trim()) { commit(draft.k, draft.v); setDraft({ k: "", v: "" }); } }} /><Input value={draft.v} placeholder={placeholderValue} className="h-7 flex-1 font-mono text-[12px]" onChange={(e) => setDraft({ ...draft, v: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && draft.k.trim()) { commit(draft.k, draft.v); setDraft({ k: "", v: "" }); } }} /><button className="grid size-7 shrink-0 place-items-center rounded text-fg-faint hover:bg-bg-sunk hover:text-fg" disabled={!draft.k.trim()} onClick={() => { commit(draft.k, draft.v); setDraft({ k: "", v: "" }); }} aria-label="Add"><Plus className="size-3.5" /></button></div>
    </div>
  );
}

/** Insert Markdown into the open page editor as an AI block (PageView listens for this event). */
export function insertMarkdown(md: string) { window.dispatchEvent(new CustomEvent("note:insert-markdown", { detail: md })); }
/** Save Markdown as a new note (wrapped in an AI block so provenance stays visible). */
export async function saveAsNote(md: string, title: string, model?: string | null) {
  const { markdownToDoc } = await import("@/lib/editor/markdown-client");
  const p = await api("/api/pages", { method: "POST", json: { title: title.slice(0, 120) || "AI research note", section: "research", content: { type: "doc", content: [{ type: "aiBlock", attrs: { model: model ?? "assistant", at: new Date().toISOString() }, content: markdownToDoc(md) }] } } });
  toast("Saved as a note", { tone: "success" }); return p as { id: string };
}
export const copy = (s: string, msg = "Copied") => { navigator.clipboard.writeText(s).then(() => toast(msg)).catch(() => toast("Copy failed", { tone: "danger" })); };
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const shortAuthors = (a: string[] | null | undefined) => { const ln = (a ?? []).map((x) => x.trim().split(/\s+/).pop() ?? ""); return ln.length === 0 ? "—" : ln.length === 1 ? ln[0] : ln.length === 2 ? `${ln[0]} & ${ln[1]}` : `${ln[0]} et al.`; };
export const dateInput = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
