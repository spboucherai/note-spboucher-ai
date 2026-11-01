"use client";
import { useState } from "react";
import { Sun, Moon, Laptop, Check } from "lucide-react";
import { api } from "@/lib/client/api";
import { useUI } from "@/lib/client/store";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { applyPrefs, type Prefs } from "./prefs";
import type { SettingsProfile } from "./SettingsView";

function Choice<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; hint?: string; icon?: React.ReactNode }[]; onChange: (v: T) => void }) {
  return <div className="grid gap-2 sm:grid-cols-3">{options.map((o) => <button key={o.id} type="button" onClick={() => onChange(o.id)} className={cn("flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors [&_svg]:size-4", value === o.id ? "border-accent bg-accent-soft/60 text-fg" : "border-line bg-bg-elev text-fg-muted hover:bg-bg-sunk")}>{o.icon}<span className="min-w-0 flex-1"><span className="block font-medium">{o.label}</span>{o.hint && <span className="block text-[11px] text-fg-faint">{o.hint}</span>}</span>{value === o.id && <Check className="text-accent" />}</button>)}</div>;
}
export function AppearanceSection({ profile, refresh }: { profile: SettingsProfile; refresh: () => void }) {
  const ui = useUI(); const prefs = profile.preferences as Prefs;
  const [local, setLocal] = useState<Prefs>({ density: prefs.density ?? "comfortable", editorFont: prefs.editorFont ?? "sans", defaultSection: prefs.defaultSection ?? "notes" });
  async function set(p: Prefs) { const next = { ...local, ...p }; setLocal(next); applyPrefs(next); try { await api("/api/settings", { method: "PATCH", json: { preferences: p } }); refresh(); } catch (e: any) { toast("Could not save preference", { description: e.message, tone: "danger" }); } }
  const Row = ({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) => <section><h2 className="text-[15px] font-semibold">{title}</h2><p className="mb-3 text-[13px] text-fg-muted">{hint}</p>{children}</section>;
  return (
    <div className="max-w-2xl space-y-8">
      <Row title="Theme" hint="Stored on this device. Dark mode follows the design tokens everywhere, including the editor."><Choice value={ui.theme} onChange={(t) => ui.setTheme(t)} options={[{ id: "system", label: "System", hint: "Follow macOS / iOS", icon: <Laptop /> }, { id: "light", label: "Light", icon: <Sun /> }, { id: "dark", label: "Dark", icon: <Moon /> }]} /></Row>
      <Row title="Density" hint="Compact tightens the base type size for dense screens; comfortable is the default."><Choice value={local.density!} onChange={(density) => set({ density })} options={[{ id: "comfortable", label: "Comfortable", hint: "16 px base" }, { id: "compact", label: "Compact", hint: "15 px base" }]} /></Row>
      <Row title="Editor font" hint="Typeface used for page bodies in the editor."><Choice value={local.editorFont!} onChange={(editorFont) => set({ editorFont })} options={[{ id: "sans", label: "Sans", hint: "Inter", icon: <span className="font-sans text-base leading-none">Aa</span> }, { id: "serif", label: "Serif", hint: "Source Serif", icon: <span className="font-serif text-base leading-none">Aa</span> }]} /></Row>
      <Row title="Default section for new pages" hint="Used by Quick capture on the home dashboard."><Choice value={local.defaultSection!} onChange={(defaultSection) => set({ defaultSection })} options={[{ id: "notes", label: "My Notes" }, { id: "documents", label: "Documents" }, { id: "projects", label: "Projects" }, { id: "research", label: "Research" }]} /></Row>
    </div>
  );
}
