"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Home, Search, Sparkles, Plus, Menu as MenuIcon, X } from "lucide-react";
import { useUI } from "@/lib/client/store";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { Sidebar } from "./Sidebar";
import { useQuery } from "@tanstack/react-query";
import type { TreeNode } from "./types";
export function MobileNav() {
  const pathname = usePathname(); const ui = useUI(); const r = useRouter(); const [drawer, setDrawer] = useState(false);
  const { data: tree = [] } = useQuery({ queryKey: ["tree"], queryFn: () => api<TreeNode[]>("/api/tree") });
  useEffect(() => {
    let sx = 0, sy = 0, edge = false;
    const ts = (e: TouchEvent) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; edge = sx < 24; };
    const te = (e: TouchEvent) => { if (!edge) return; const t = e.changedTouches[0]; if (t.clientX - sx > 70 && Math.abs(t.clientY - sy) < 60) setDrawer(true); };
    window.addEventListener("touchstart", ts, { passive: true }); window.addEventListener("touchend", te, { passive: true });
    return () => { window.removeEventListener("touchstart", ts); window.removeEventListener("touchend", te); };
  }, []);
  if (ui.focusMode) return null;
  const I = ({ active, onClick, href, icon, label }: { active?: boolean; onClick?: () => void; href?: string; icon: React.ReactNode; label: string }) => { const cls = cn("flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10.5px] font-medium text-fg-faint transition-colors [&_svg]:size-5", active && "text-accent"); return href ? <Link href={href} className={cls}>{icon}{label}</Link> : <button className={cls} onClick={onClick}>{icon}{label}</button>; };
  return (
    <>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex items-end border-t border-line bg-bg-elev/90 px-1 backdrop-blur-md md:hidden safe-bottom">
        <I href="/" active={pathname === "/"} icon={<Home />} label="Home" />
        <I onClick={() => ui.set({ paletteOpen: true })} icon={<Search />} label="Search" />
        <button onClick={async () => { const p = await api("/api/pages", { method: "POST", json: { title: "" } }); r.push(`/p/${p.id}`); }} aria-label="New page" className="mx-1 mb-2 grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-accent-fg shadow-pop transition-transform active:scale-95"><Plus className="size-6" /></button>
        <I onClick={() => ui.toggleAI()} active={ui.aiOpen} icon={<Sparkles />} label="AI" />
        <I onClick={() => setDrawer(true)} icon={<MenuIcon />} label="Pages" />
      </nav>
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" />
          <div role="dialog" aria-modal="true" aria-label="Pages" className="absolute inset-y-0 left-0 w-[84vw] max-w-sm bg-bg-side shadow-pop fade-up" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Close" className="absolute -right-11 top-3 z-10 grid size-9 place-items-center rounded-full bg-bg-elev text-fg-muted shadow-pop safe-top" onClick={() => setDrawer(false)}><X className="size-4" /></button>
            <Sidebar tree={tree} user={{ id: "", username: "", displayName: "" }} workspace={{ name: "Note" }} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
    </>
  );
}
