"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import { ShieldCheck, ShieldOff, Smartphone, LogOut, Trash2, Fingerprint, Plus, Monitor, RefreshCw, History } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, timeAgo, fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge, Dialog, DialogContent, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import type { SettingsProfile } from "./SettingsView";

interface Session { id: string; device: string; userAgent: string | null; ip: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; mfaPassed: boolean; current: boolean }
interface Passkey { id: string; label: string | null; deviceType: string | null; backedUp: boolean | null; transports: string[] | null; createdAt: string; lastUsedAt: string | null }
interface AuditRow { id: string; action: string; targetType: string | null; targetId: string | null; detail: Record<string, unknown> | null; ip: string | null; createdAt: string }

export function SecuritySection({ profile, refresh }: { profile: SettingsProfile; refresh: () => void }) {
  const qc = useQueryClient();
  const { data: sessions = [], isLoading: sLoading } = useQuery({ queryKey: ["settings-sessions"], queryFn: () => api<Session[]>("/api/settings/sessions") });
  const { data: passkeys = [] } = useQuery({ queryKey: ["settings-passkeys"], queryFn: () => api<Passkey[]>("/api/settings/passkeys") });
  const { data: auditRows = [], isLoading: aLoading, refetch: refetchAudit } = useQuery({ queryKey: ["settings-audit"], queryFn: () => api<AuditRow[]>("/api/settings/audit?limit=50") });
  const inv = (k: string) => qc.invalidateQueries({ queryKey: [k] });

  // sessions
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  async function revoke(s: Session) { try { const r = await api("/api/settings/sessions", { method: "DELETE", json: { id: s.id } }); if (r.current) { window.location.href = "/login"; return; } toast("Session revoked"); inv("settings-sessions"); inv("settings-audit"); } catch (e: any) { toast("Could not revoke", { description: e.message, tone: "danger" }); } }
  async function revokeAll() { try { await api("/api/settings/sessions", { method: "DELETE", json: { all: true } }); toast("Signed out everywhere else", { tone: "success" }); setRevokeAllOpen(false); inv("settings-sessions"); inv("settings-audit"); } catch (e: any) { toast("Failed", { description: e.message, tone: "danger" }); } }

  // TOTP
  const [totp, setTotp] = useState<{ step: "idle" | "setup" | "disable"; qr?: string; secret?: string; code: string; busy: boolean }>({ step: "idle", code: "", busy: false });
  async function totpSetup() { setTotp((t) => ({ ...t, busy: true })); try { const r = await api("/api/auth/totp", { method: "PUT", json: { action: "setup" } }); setTotp({ step: "setup", qr: r.qr, secret: r.secret, code: "", busy: false }); } catch (e: any) { toast("Setup failed", { description: e.message, tone: "danger" }); setTotp((t) => ({ ...t, busy: false })); } }
  async function totpEnable() { setTotp((t) => ({ ...t, busy: true })); try { await api("/api/auth/totp", { method: "PUT", json: { action: "enable", code: totp.code.replace(/\s/g, "") } }); toast("Two-factor authentication enabled", { tone: "success" }); setTotp({ step: "idle", code: "", busy: false }); refresh(); inv("settings-audit"); } catch (e: any) { toast("Invalid code", { description: e.message, tone: "danger" }); setTotp((t) => ({ ...t, busy: false })); } }
  async function totpDisable() { setTotp((t) => ({ ...t, busy: true })); try { await api("/api/auth/totp", { method: "PUT", json: { action: "disable", code: totp.code.replace(/\s/g, "") } }); toast("Two-factor authentication disabled"); setTotp({ step: "idle", code: "", busy: false }); refresh(); inv("settings-audit"); } catch (e: any) { toast("Invalid code", { description: e.message, tone: "danger" }); setTotp((t) => ({ ...t, busy: false })); } }

  // passkeys
  const [pkBusy, setPkBusy] = useState(false);
  async function registerPasskey() {
    setPkBusy(true);
    try {
      const o = await api("/api/auth/passkey?step=register");
      const resp = await startRegistration({ optionsJSON: o.options });
      const label = window.prompt("Name this passkey (e.g. MacBook Touch ID, iPhone)", "Passkey") ?? "Passkey";
      await api("/api/auth/passkey", { method: "POST", json: { challengeId: o.challengeId, response: resp, label } });
      toast("Passkey registered", { tone: "success" }); inv("settings-passkeys"); inv("settings-audit");
    } catch (e: any) { if (e?.name !== "NotAllowedError") toast("Passkey not registered", { description: e.message, tone: "danger" }); } finally { setPkBusy(false); }
  }
  async function deletePasskey(p: Passkey) { if (!window.confirm(`Remove passkey "${p.label ?? p.id.slice(0, 8)}"?`)) return; try { await api("/api/auth/passkey", { method: "DELETE", json: { id: p.id } }); toast("Passkey removed"); inv("settings-passkeys"); inv("settings-audit"); } catch (e: any) { toast("Failed", { description: e.message, tone: "danger" }); } }

  const H = ({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }) => <div className="mb-3 flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h2 className="flex items-center gap-2 text-[15px] font-semibold [&_svg]:size-4 [&_svg]:text-fg-muted">{icon}{title}</h2><p className="text-[13px] text-fg-muted">{hint}</p></div>{action}</div>;
  return (
    <div className="space-y-10">
      <section>
        <H icon={<Monitor />} title="Sessions" hint="Devices currently signed in to your workspace." action={<Button size="sm" variant="outline" onClick={() => setRevokeAllOpen(true)} disabled={sessions.length < 2}><LogOut /> Sign out everywhere</Button>} />
        <div className="overflow-hidden rounded-xl border border-line bg-bg-elev">
          {sLoading ? <div className="flex justify-center py-8"><Spinner /></div> : sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-bg-sunk text-fg-muted">{/iOS|Android/.test(s.device) ? <Smartphone className="size-4" /> : <Monitor className="size-4" />}</span>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-[13px] font-medium"><span className="truncate">{s.device}</span>{s.current && <Badge tone="success">this device</Badge>}{s.mfaPassed && <Badge tone="accent">2FA</Badge>}</div><div className="truncate text-[11px] text-fg-faint">{s.ip ?? "unknown IP"} · last seen {timeAgo(s.lastSeenAt)} · signed in {fmtDate(s.createdAt, { dateStyle: "medium" })}</div></div>
              <Button size="sm" variant="ghost" className="shrink-0" onClick={() => revoke(s)}>{s.current ? "Sign out" : "Revoke"}</Button>
            </div>
          ))}
        </div>
      </section>
      <section>
        <H icon={profile.totpEnabled ? <ShieldCheck /> : <ShieldOff />} title="Two-factor authentication (TOTP)" hint={profile.totpEnabled ? "Enabled. A code from your authenticator app is required at each sign-in." : "Add a time-based one-time code (Google Authenticator, 1Password, Apple Passwords…) as a second factor."} action={profile.totpEnabled ? <Badge tone="success">Enabled</Badge> : <Badge>Off</Badge>} />
        {totp.step === "idle" && (profile.totpEnabled ? <Button size="sm" variant="outline" onClick={() => setTotp({ step: "disable", code: "", busy: false })}><ShieldOff /> Disable 2FA</Button> : <Button size="sm" onClick={totpSetup} disabled={totp.busy}>{totp.busy ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <ShieldCheck />} Set up authenticator</Button>)}
        {totp.step === "setup" && (
          <div className="grid max-w-xl gap-4 rounded-xl border border-line bg-bg-elev p-4 sm:grid-cols-[160px_1fr]">
            {totp.qr && <img src={totp.qr} alt="TOTP QR code" className="size-40 rounded-md border border-line bg-white p-1" />}
            <div className="min-w-0 space-y-3">
              <ol className="list-decimal space-y-1 pl-4 text-[13px] text-fg-muted"><li>Scan the QR code with your authenticator app.</li><li>Or enter this key manually: <code className="break-all rounded bg-bg-sunk px-1 font-mono text-[12px] text-fg">{totp.secret}</code></li><li>Enter the 6-digit code to confirm.</li></ol>
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); totpEnable(); }}><div className="grid gap-1"><Label htmlFor="totp-code">Code</Label><Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" value={totp.code} onChange={(e) => setTotp({ ...totp, code: e.target.value })} className="w-32 font-mono tracking-widest" placeholder="123 456" autoFocus /></div><Button type="submit" size="sm" disabled={totp.busy || totp.code.replace(/\s/g, "").length !== 6}>{totp.busy ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <ShieldCheck />} Enable</Button><Button type="button" size="sm" variant="ghost" onClick={() => setTotp({ step: "idle", code: "", busy: false })}>Cancel</Button></form>
            </div>
          </div>
        )}
        {totp.step === "disable" && <form className="flex max-w-xl flex-wrap items-end gap-2 rounded-xl border border-line bg-bg-elev p-4" onSubmit={(e) => { e.preventDefault(); totpDisable(); }}><div className="grid gap-1"><Label htmlFor="totp-off">Current code from your app</Label><Input id="totp-off" inputMode="numeric" autoComplete="one-time-code" value={totp.code} onChange={(e) => setTotp({ ...totp, code: e.target.value })} className="w-32 font-mono tracking-widest" placeholder="123 456" autoFocus /></div><Button type="submit" size="sm" variant="danger" disabled={totp.busy || totp.code.replace(/\s/g, "").length !== 6}>{totp.busy ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <ShieldOff />} Disable</Button><Button type="button" size="sm" variant="ghost" onClick={() => setTotp({ step: "idle", code: "", busy: false })}>Cancel</Button></form>}
      </section>
      <section>
        <H icon={<Fingerprint />} title="Passkeys" hint="Sign in with Touch ID, Face ID or a security key — phishing-resistant and no password needed." action={<Button size="sm" onClick={registerPasskey} disabled={pkBusy}>{pkBusy ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <Plus />} Add passkey</Button>} />
        <div className="overflow-hidden rounded-xl border border-line bg-bg-elev">
          {passkeys.length ? passkeys.map((p) => <div key={p.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-bg-sunk text-fg-muted"><Fingerprint className="size-4" /></span><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{p.label ?? "Passkey"} {p.backedUp && <Badge tone="accent">synced</Badge>}</div><div className="truncate text-[11px] text-fg-faint">{p.deviceType === "multiDevice" ? "Multi-device" : "Single device"} · added {fmtDate(p.createdAt, { dateStyle: "medium" })}{p.lastUsedAt ? ` · last used ${timeAgo(p.lastUsedAt)}` : " · never used"}</div></div><Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => deletePasskey(p)}><Trash2 /> Remove</Button></div>) : <div className="px-3 py-6 text-center text-[12px] text-fg-faint">No passkey registered yet.</div>}
        </div>
      </section>
      <section>
        <H icon={<History />} title="Recent activity" hint="Last 50 security and content events recorded for your account." action={<Button size="sm" variant="ghost" onClick={() => refetchAudit()}><RefreshCw /> Refresh</Button>} />
        <div className="overflow-x-auto rounded-xl border border-line bg-bg-elev">
          <table className="w-full min-w-[520px] text-[12.5px]"><thead><tr className="border-b border-line bg-bg-sunk/60 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-faint"><th className="px-3 py-1.5">When</th><th className="px-3 py-1.5">Action</th><th className="px-3 py-1.5">Target</th><th className="px-3 py-1.5">IP</th></tr></thead>
            <tbody>{aLoading ? <tr><td colSpan={4} className="py-8 text-center"><Spinner /></td></tr> : auditRows.length ? auditRows.map((a) => <tr key={a.id} className="border-b border-line last:border-b-0"><td className="whitespace-nowrap px-3 py-1.5 text-fg-muted" title={fmtDate(a.createdAt, { dateStyle: "medium", timeStyle: "short" })}>{timeAgo(a.createdAt)}</td><td className={cn("px-3 py-1.5 font-mono text-[12px]", /fail|revoked|disabled|purge|delete/.test(a.action) && "text-danger")}>{a.action}</td><td className="max-w-[260px] truncate px-3 py-1.5 text-fg-muted">{a.targetType ? `${a.targetType} ${a.targetId?.slice(0, 8) ?? ""}` : ""}{a.detail && Object.keys(a.detail).length ? <span className="text-fg-faint"> {JSON.stringify(a.detail).slice(0, 80)}</span> : null}</td><td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-fg-faint">{a.ip ?? ""}</td></tr>) : <tr><td colSpan={4} className="py-8 text-center text-fg-faint">No activity yet.</td></tr>}</tbody></table>
        </div>
      </section>
      <Dialog open={revokeAllOpen} onOpenChange={setRevokeAllOpen}><DialogContent title="Sign out everywhere?" description="Every other device will need to sign in again. This session stays active."><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRevokeAllOpen(false)}>Cancel</Button><Button variant="danger" onClick={revokeAll} autoFocus><LogOut /> Sign out other sessions</Button></div></DialogContent></Dialog>
    </div>
  );
}
