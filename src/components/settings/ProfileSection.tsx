"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import type { SettingsProfile } from "./SettingsView";

export function ProfileSection({ profile, refresh }: { profile: SettingsProfile; refresh: () => void }) {
  const r = useRouter(); const qc = useQueryClient();
  const [name, setName] = useState(profile.displayName); const [email, setEmail] = useState(profile.email ?? ""); const [saving, setSaving] = useState(false);
  useEffect(() => { setName(profile.displayName); setEmail(profile.email ?? ""); }, [profile.displayName, profile.email]);
  const dirty = name.trim() !== profile.displayName || (email.trim() || "") !== (profile.email ?? "");
  async function save() { setSaving(true); try { await api("/api/settings", { method: "PATCH", json: { displayName: name.trim(), email: email.trim() || "" } }); toast("Profile saved", { tone: "success" }); refresh(); qc.invalidateQueries({ queryKey: ["dashboard"] }); r.refresh(); } catch (e: any) { toast("Could not save", { description: e.message, tone: "danger" }); } finally { setSaving(false); } }
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-[15px] font-semibold">Profile</h2><p className="mb-3 text-[13px] text-fg-muted">Owner <span className="font-mono">@{profile.username}</span> · member since {new Date(profile.createdAt).toLocaleDateString("en-CA", { dateStyle: "medium" })}</p>
        <form className="grid max-w-lg gap-3" onSubmit={(e) => { e.preventDefault(); if (dirty) save(); }}>
          <div className="grid gap-1"><Label htmlFor="displayName">Display name</Label><Input id="displayName" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /></div>
          <div className="grid gap-1"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div>
          <div><Button type="submit" size="sm" disabled={!dirty || saving || !name.trim()}>{saving ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <Save />} Save</Button></div>
        </form>
      </section>
    </div>
  );
}
