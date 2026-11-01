"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { KeyRound, Save } from "lucide-react";
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
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" }); const [pwBusy, setPwBusy] = useState(false);
  const dirty = name.trim() !== profile.displayName || (email.trim() || "") !== (profile.email ?? "");
  async function save() { setSaving(true); try { await api("/api/settings", { method: "PATCH", json: { displayName: name.trim(), email: email.trim() || "" } }); toast("Profile saved", { tone: "success" }); refresh(); qc.invalidateQueries({ queryKey: ["dashboard"] }); r.refresh(); } catch (e: any) { toast("Could not save", { description: e.message, tone: "danger" }); } finally { setSaving(false); } }
  async function changePw() {
    if (pw.next !== pw.confirm) { toast("Passwords do not match", { tone: "danger" }); return; }
    setPwBusy(true);
    try { await api("/api/settings/password", { method: "POST", json: { current: pw.current, next: pw.next } }); setPw({ current: "", next: "", confirm: "" }); toast("Password changed", { description: "Every other session has been signed out.", tone: "success" }); }
    catch (e: any) { toast("Password not changed", { description: e.message, tone: "danger" }); } finally { setPwBusy(false); }
  }
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-[15px] font-semibold">Profile</h2><p className="mb-3 text-[13px] text-fg-muted">Signed in as <span className="font-mono">@{profile.username}</span> · member since {new Date(profile.createdAt).toLocaleDateString("en-CA", { dateStyle: "medium" })}</p>
        <form className="grid max-w-lg gap-3" onSubmit={(e) => { e.preventDefault(); if (dirty) save(); }}>
          <div className="grid gap-1"><Label htmlFor="displayName">Display name</Label><Input id="displayName" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /></div>
          <div className="grid gap-1"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div>
          <div><Button type="submit" size="sm" disabled={!dirty || saving || !name.trim()}>{saving ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <Save />} Save</Button></div>
        </form>
      </section>
      <section>
        <h2 className="text-[15px] font-semibold">Change password</h2><p className="mb-3 text-[13px] text-fg-muted">At least 12 characters with upper-case, lower-case letters and a digit. Other devices are signed out afterwards.</p>
        <form className="grid max-w-lg gap-3" onSubmit={(e) => { e.preventDefault(); changePw(); }} autoComplete="off">
          <div className="grid gap-1"><Label htmlFor="pw-current">Current password</Label><Input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1"><Label htmlFor="pw-next">New password</Label><Input id="pw-next" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={12} required /></div><div className="grid gap-1"><Label htmlFor="pw-confirm">Confirm</Label><Input id="pw-confirm" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></div></div>
          {pw.next && pw.confirm && pw.next !== pw.confirm && <p className="text-[12px] text-danger">Passwords do not match.</p>}
          <div><Button type="submit" size="sm" variant="secondary" disabled={pwBusy || !pw.current || !pw.next || pw.next !== pw.confirm}>{pwBusy ? <Spinner className="size-3.5" /> : <KeyRound />} Update password</Button></div>
        </form>
      </section>
    </div>
  );
}
