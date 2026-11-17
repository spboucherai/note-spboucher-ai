"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { User, ShieldCheck, Palette, Sparkles, Database, Info, SearchCheck, CheckSquare, Activity } from "lucide-react";
import { IndexSection } from "./IndexSection";
import { TasksSection } from "./TasksSection";
import { JobsSection } from "./JobsSection";
import { api } from "@/lib/client/api";
import { Tabs, TabsList, TabsTrigger, TabsContent, Spinner } from "@/components/ui/primitives";
import { ProfileSection } from "./ProfileSection";
import { SecuritySection } from "./SecuritySection";
import { AppearanceSection } from "./AppearanceSection";
import { AISection } from "./AISection";
import { AboutSection } from "./AboutSection";
import { applyPrefs } from "./prefs";

export interface SettingsProfile { id: string; username: string; displayName: string; email: string | null; preferences: Record<string, unknown>; createdAt: string; workspace: { id: string; name: string }; aiBudgetUsd: number; sessionId: string }
// @ts-ignore — DataSection is written by another engineer; a missing export falls back to a placeholder.
const DataSection = dynamic(() => import("@/components/settings/DataSection").then((m: any) => (m.DataSection ?? m.default ?? (() => <p className="text-[13px] text-fg-muted">Data tools are not available yet.</p>)) as React.ComponentType<any>).catch(() => (() => <p className="text-[13px] text-fg-muted">Data tools are not available yet.</p>) as React.ComponentType<any>), { ssr: false, loading: () => <div className="flex justify-center py-8"><Spinner /></div> });
const TABS = [{ id: "security", label: "Security", icon: <ShieldCheck /> }, { id: "appearance", label: "Appearance", icon: <Palette /> }, { id: "data", label: "Data & backups", icon: <Database /> }, { id: "ai", label: "AI & costs", icon: <Sparkles /> }, { id: "index", label: "Indexing", icon: <SearchCheck /> }, { id: "jobs", label: "Jobs", icon: <Activity /> }, { id: "tasks", label: "Tasks", icon: <CheckSquare /> }, { id: "profile", label: "Profile", icon: <User /> }, { id: "about", label: "About", icon: <Info /> }];

export function SettingsView({ version }: { version: string }) {
  const [tab, setTab] = useState("security");
  useEffect(() => { const read = () => { const h = window.location.hash.slice(1); if (TABS.some((t) => t.id === h)) setTab(h); }; read(); window.addEventListener("hashchange", read); return () => window.removeEventListener("hashchange", read); }, []);
  const { data: profile, refetch, isLoading } = useQuery({ queryKey: ["settings"], queryFn: () => api<SettingsProfile>("/api/settings") });
  useEffect(() => { if (profile) applyPrefs(profile.preferences as any); }, [profile]);
  const refresh = () => { refetch(); };
  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-4 sm:px-6 sm:py-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Settings</h1>
      <Tabs value={tab} onValueChange={(v) => { setTab(v); history.replaceState(null, "", `#${v}`); }}>
        <div className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"><TabsList className="h-auto gap-1 bg-transparent p-0">{TABS.map((t) => <TabsTrigger key={t.id} value={t.id} className="h-10 shrink-0 gap-1.5 rounded-full border border-line bg-bg-elev px-3.5 text-[13.5px] data-[state=active]:border-accent/40 data-[state=active]:bg-accent-soft data-[state=active]:text-accent data-[state=active]:shadow-none sm:h-9 [&_svg]:size-4">{t.icon}{t.label}</TabsTrigger>)}</TabsList></div>
        {isLoading || !profile ? <div className="flex justify-center py-16"><Spinner /></div> : <>
          <TabsContent value="profile"><ProfileSection profile={profile} refresh={refresh} /></TabsContent>
          <TabsContent value="security"><SecuritySection profile={profile} refresh={refresh} /></TabsContent>
          <TabsContent value="appearance"><AppearanceSection profile={profile} refresh={refresh} /></TabsContent>
          <TabsContent value="ai"><AISection profile={profile} refresh={refresh} /></TabsContent>
          <TabsContent value="data"><DataSection /></TabsContent>
          <TabsContent value="index"><IndexSection /></TabsContent>
          <TabsContent value="jobs"><JobsSection /></TabsContent>
          <TabsContent value="tasks"><TasksSection /></TabsContent>
          <TabsContent value="about"><AboutSection version={version} /></TabsContent>
        </>}
      </Tabs>
    </div>
  );
}
