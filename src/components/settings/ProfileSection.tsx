/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/settings/ProfileSection.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-09
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
