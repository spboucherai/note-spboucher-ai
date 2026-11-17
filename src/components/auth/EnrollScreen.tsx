"use client";
import { useEffect, useRef, useState } from "react";
import { ShieldCheck, KeyRound, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/primitives";
import { AuthCard, AuthNotice, BIOMETRIC_NOTE } from "./AuthCard";
import { describePasskeyError, enrollFinish, enrollOptions, localUnlockName, passkeySupport } from "@/lib/client/passkey";

type Phase = "checking" | "ready" | "closed" | "unsupported" | "working" | "done";
export function EnrollScreen() {
  const token = useRef<string>(""); const [phase, setPhase] = useState<Phase>("checking"); const [info, setInfo] = useState<{ purpose: string; revokeExisting: boolean; expiresAt: string } | null>(null);
  const [label, setLabel] = useState(""); const [error, setError] = useState<string | null>(null); const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    (async () => {
      // Take the token out of the address bar immediately: it must not end up in history, screenshots or a shared tab.
      token.current = window.location.hash.slice(1); history.replaceState(null, "", "/enroll");
      const sup = await passkeySupport(); if (!sup.webauthn) return setPhase("unsupported");
      if (!/^[A-Za-z0-9_-]{40,64}$/.test(token.current)) return setPhase("closed");
      const ua = navigator.userAgent; setLabel(/iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Macintosh/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android phone" : "This device");
      try { const o = await enrollOptions(token.current); setInfo({ purpose: o.purpose, revokeExisting: o.revokeExisting, expiresAt: o.expiresAt }); optionsRef.current = o.options; setPhase("ready"); }
      catch (e: any) { if (e?.code === "enrollment_closed" || e?.status === 403) setPhase("closed"); else { setError(e?.message ?? "Could not start"); setPhase("closed"); } }
    })();
  }, []);
  const optionsRef = useRef<any>(null);
  async function create() {
    setPhase("working"); setError(null); setCancelled(false);
    try { await enrollFinish(token.current, optionsRef.current, label.trim()); token.current = ""; setPhase("done"); setTimeout(() => window.location.replace("/settings#security"), 1400); }
    catch (e: any) {
      const d = describePasskeyError(e);
      if (d.cancelled) {
        // The challenge was not consumed by a cancelled prompt on most platforms, but ask for fresh options to be safe.
        try { const o = await enrollOptions(token.current); optionsRef.current = o.options; setCancelled(true); setPhase("ready"); } catch { setPhase("closed"); }
      } else if (e?.code === "enrollment_closed") setPhase("closed");
      else { setError(d.message); try { const o = await enrollOptions(token.current); optionsRef.current = o.options; setPhase("ready"); } catch { setPhase("closed"); } }
    }
  }
  if (phase === "checking") return <AuthCard icon={<ShieldCheck />} title="Checking the link…"><div className="flex justify-center py-4"><Spinner /></div></AuthCard>;
  if (phase === "unsupported") return <AuthCard icon={<ShieldCheck />} title="Passkeys unavailable"><AuthNotice tone="danger">This browser cannot create a passkey here. Open the link in Safari (iPhone, iPad, Mac) or Chrome (Android, desktop), over HTTPS.</AuthNotice></AuthCard>;
  if (phase === "closed") return <AuthCard icon={<ShieldCheck />} title="Link closed"><AuthNotice tone="warning">This enrollment link is invalid, expired or already used. A new one can only be opened from the server shell: <code className="font-mono text-[12px]">pnpm auth:open-enrollment</code> (first passkey) or <code className="font-mono text-[12px]">pnpm auth:recover</code>.</AuthNotice>{error && <p className="mt-2 text-[12px] text-fg-faint">{error}</p>}<a href="/login" className="mt-4 block text-center text-[13px] font-medium text-accent">Go to sign-in</a></AuthCard>;
  if (phase === "done") return <AuthCard icon={<CircleCheck />} title="Passkey registered"><AuthNotice tone="success">This device can now open the app. The enrollment link is closed for good.</AuthNotice></AuthCard>;
  return (
    <AuthCard icon={<ShieldCheck />} title={info?.purpose === "recovery" ? "Recover access" : "Register your first passkey"} footer={BIOMETRIC_NOTE}>
      {info?.purpose === "recovery" && <div className="mb-3"><AuthNotice tone="warning">{info.revokeExisting ? "Recovery: once this passkey is created, every previous passkey is deleted and every device is signed out." : "Recovery: once this passkey is created, every device is signed out. Existing passkeys are kept."}</AuthNotice></div>}
      <form onSubmit={(e) => { e.preventDefault(); create(); }} className="grid gap-3">
        <div className="grid gap-1"><Label htmlFor="pk-label">Name of this device</Label><Input id="pk-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="iPhone" autoComplete="off" className="h-11 text-[16px]" /></div>
        <Button type="submit" size="lg" className="h-12 w-full text-[15px]" disabled={phase === "working"}>{phase === "working" ? <Spinner className="border-white/40 border-t-white" /> : <KeyRound />}{phase === "working" ? "Waiting for your device…" : `Create passkey with ${localUnlockName()}`}</Button>
      </form>
      {cancelled && <div className="mt-3"><AuthNotice>Cancelled. Nothing was registered — you can try again while the link is open.</AuthNotice></div>}
      {error && <div className="mt-3"><AuthNotice tone="danger">{error}</AuthNotice></div>}
      {info && <p className="mt-3 text-center text-[12px] text-fg-faint">Link valid until {new Date(info.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · single use</p>}
    </AuthCard>
  );
}
