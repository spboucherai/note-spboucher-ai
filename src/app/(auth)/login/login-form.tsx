"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/primitives";
import { KeyRound, ShieldCheck } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";

export function LoginForm({ next, step: initial }: { next: string; step: "password" | "totp" }) {
  const r = useRouter();
  const [step, setStep] = useState(initial); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [username, setU] = useState(""); const [password, setP] = useState(""); const [code, setCode] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (step === "password") {
        const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
        const j = await res.json(); if (!res.ok) throw new Error(j.error ?? "Login failed");
        if (j.mfaRequired) { setStep("totp"); setPassword(); } else { r.replace(next); r.refresh(); }
      } else {
        const res = await fetch("/api/auth/totp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
        const j = await res.json(); if (!res.ok) throw new Error(j.error ?? "Invalid code");
        r.replace(next); r.refresh();
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  function setPassword() { setP(""); }
  async function passkey() {
    setBusy(true); setErr(null);
    try {
      const o = await fetch("/api/auth/passkey?step=options").then((x) => x.json()); if (o.error) throw new Error(o.error);
      const resp = await startAuthentication({ optionsJSON: o.options });
      const v = await fetch("/api/auth/passkey", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: o.challengeId, response: resp }) }).then((x) => x.json());
      if (v.error) throw new Error(v.error); r.replace(next); r.refresh();
    } catch (e: any) { setErr(e.name === "NotAllowedError" ? "Passkey cancelled" : e.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-bg-elev p-5 shadow-card space-y-4">
      {step === "password" ? (<>
        <div className="space-y-1.5"><Label htmlFor="u">Username</Label><Input id="u" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setU(e.target.value)} required autoFocus /></div>
        <div className="space-y-1.5"><Label htmlFor="p">Password</Label><Input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} required /></div>
      </>) : (
        <div className="space-y-1.5"><Label htmlFor="c" className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" /> Two-factor code</Label><Input id="c" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus className="text-center tracking-[0.4em] font-mono text-lg" /></div>
      )}
      {err && <p className="text-[13px] text-danger">{err}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? <Spinner className="border-t-white" /> : step === "password" ? "Sign in" : "Verify"}</Button>
      {step === "password" && <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={passkey}><KeyRound /> Use a passkey</Button>}
    </form>
  );
}
