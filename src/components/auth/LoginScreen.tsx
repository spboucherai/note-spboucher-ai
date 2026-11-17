"use client";
import { useEffect, useState } from "react";
import { Fingerprint, KeyRound, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";
import { AuthCard, AuthNotice, BIOMETRIC_NOTE } from "./AuthCard";
import { describePasskeyError, localUnlockName, passkeySupport, signIn, type PasskeySupport } from "@/lib/client/passkey";

export function LoginScreen() {
  const [support, setSupport] = useState<PasskeySupport | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; tone: "danger" | "neutral" | "warning" } | null>(null); const [name, setName] = useState("your passkey"); const [online, setOnline] = useState(true);
  useEffect(() => {
    passkeySupport().then(setSupport); setName(localUnlockName()); setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  async function go() {
    setBusy(true); setError(null);
    try {
      const next = new URLSearchParams(window.location.search).get("next");
      const r = await signIn(next);
      window.location.replace(r.next || "/");
    } catch (e: any) {
      const d = describePasskeyError(e);
      if (e?.code === "not_enrolled") setError({ tone: "warning", message: "No passkey is registered yet. Open an enrollment window on the server (pnpm auth:open-enrollment) and follow its one-time link." });
      else if (e?.code === "rate_limited") setError({ tone: "warning", message: "Too many attempts. Wait a minute, then try again." });
      else if (e?.code === "not_configured") setError({ tone: "danger", message: "Passkeys are not configured on this server (APP_URL / AUTH_RP_ID)." });
      else if (e?.code === "csrf") setError({ tone: "danger", message: "This address is not the configured origin of the app, so passkeys cannot be used here." });
      else setError({ tone: d.cancelled ? "neutral" : "danger", message: d.cancelled ? "Cancelled. Tap the button to try again." : d.message });
      setBusy(false);
    }
  }
  const blocked = support && !support.webauthn;
  return (
    <AuthCard icon={<Fingerprint />} title="Private space" footer={BIOMETRIC_NOTE}>
      {!online && <div className="mb-3"><AuthNotice tone="warning"><WifiOff className="mr-1.5 inline size-4 align-[-3px]" />You are offline. Signing in needs a connection.</AuthNotice></div>}
      {blocked ? (
        <AuthNotice tone="danger">{support!.secure ? "This browser does not support passkeys. Use Safari on iPhone, iPad or Mac, Chrome on Android, or a current desktop browser." : "Passkeys only work over HTTPS. Open the app at its https:// address."}</AuthNotice>
      ) : (
        <Button size="lg" className="h-12 w-full text-[15px]" onClick={go} disabled={busy || !support || !online} autoFocus>
          {busy ? <Spinner className="border-white/40 border-t-white" /> : <KeyRound />}{busy ? "Waiting for your device…" : `Continue with ${name}`}
        </Button>
      )}
      {error && <div className="mt-3"><AuthNotice tone={error.tone}>{error.message}</AuthNotice></div>}
      {support && support.webauthn && !support.platform && <p className="mt-3 text-center text-[12px] leading-5 text-fg-faint">No built-in authenticator found on this device: you can use a passkey from your phone (QR code) or a security key.</p>}
    </AuthCard>
  );
}
