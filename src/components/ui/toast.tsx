"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
type T = { id: number; title: string; description?: string; tone?: "neutral" | "success" | "danger" | "ai" };
let push: ((t: Omit<T, "id">) => void) | null = null;
export function toast(title: string, opts: Omit<T, "id" | "title"> = {}) { push?.({ title, ...opts }); }
export function Toaster() {
  const [items, set] = React.useState<T[]>([]);
  React.useEffect(() => { push = (t) => { const id = Date.now() + Math.random(); set((s) => [...s, { ...t, id }]); setTimeout(() => set((s) => s.filter((x) => x.id !== id)), 4200); }; return () => { push = null; }; }, []);
  return <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2 safe-bottom">{items.map((t) => (
    <div key={t.id} className={cn("pointer-events-auto w-80 rounded-lg border bg-bg-elev p-3 shadow-pop fade-up", t.tone === "danger" ? "border-danger/40" : t.tone === "success" ? "border-success/40" : t.tone === "ai" ? "border-ai/40" : "border-line")}>
      <div className="text-sm font-medium">{t.title}</div>{t.description && <div className="mt-0.5 text-[13px] text-fg-muted">{t.description}</div>}
    </div>))}</div>;
}
