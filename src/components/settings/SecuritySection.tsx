"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, KeyRound, RefreshCw, History, Plus, Pencil, Trash2, Smartphone, LogOut, ShieldCheck, Cloud, TriangleAlert } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, timeAgo, fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge, Dialog, DialogContent, Spinner } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { addPasskey, describePasskeyError, localUnlockName, withFreshAuth } from "@/lib/client/passkey";
import { wipeLocalData } from "@/lib/client/offline";
import type { SettingsProfile } from "./SettingsView";

interface AuditRow { id: string; action: string; targetType: string | null; targetId: string | null; detail: Record<string, unknown> | null; ip: string | null; createdAt: string }
interface Passkey { id: string; label: string; createdAt: string; lastUsedAt: string | null; synced: boolean; multiDevice: boolean; current: boolean }
interface Sess { id: string; label: string; ip: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean }
interface AuthState { sessionId: string; fresh: boolean; verifiedAt: string | null; idleDays: number; absoluteDays: number; rpId: string; origins: string[]; legacyEnv: string[]; enrollmentOpen: { purpose: string; expiresAt: string } | null }

const fail = (title: string, e: unknown) => { const d = describePasskeyError(e); toast(d.cancelled ? "Cancelled" : title, { description: d.cancelled ? "Nothing was changed." : d.message, tone: d.cancelled ? "neutral" : "danger" }); };

/** Access model v2: passkeys only (WebAuthn, user verification required) + revocable server-side sessions. Sensitive actions ask for the passkey again. */
export function SecuritySection(_: { profile: SettingsProfile; refresh: () => void }) {
  const qc = useQueryClient();
  const { data: state } = useQuery({ queryKey: ["auth-state"], queryFn: () => api<AuthState>("/api/auth/state") });
  const { data: passkeys, isLoading: pLoading, error: pErr } = useQuery({ queryKey: ["passkeys"], queryFn: () => api<Passkey[]>("/api/auth/passkeys") });
  const { data: sessions, isLoading: sLoading, error: sErr } = useQuery({ queryKey: ["sessions"], queryFn: () => api<Sess[]>("/api/auth/sessions") });
  const { data: auditRows = [], isLoading: aLoading, refetch: refetchAudit } = useQuery({ queryKey: ["settings-audit"], queryFn: () => api<AuditRow[]>("/api/settings/audit?limit=50") });
  const [adding, setAdding] = useState(false); const [newLabel, setNewLabel] = useState(""); const [busy, setBusy] = useState<string | null>(null);
  const [rename, setRename] = useState<Passkey | null>(null); const [renameTo, setRenameTo] = useState(""); const [confirm, setConfirm] = useState<null | { title: string; body: string; cta: string; run: () => Promise<void> }>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["passkeys"] }); qc.invalidateQueries({ queryKey: ["sessions"] }); qc.invalidateQueries({ queryKey: ["auth-state"] }); refetchAudit(); };

  async function lockDevice() { setBusy("lock"); try { await api("/api/auth/logout", { method: "POST", idempotencyKey: false }); } catch { /* cookie is cleared server-side even when the session was already gone */ } await wipeLocalData(); window.location.href = "/login"; }
  async function add() {
    setBusy("add");
    try { const r = await withFreshAuth(() => addPasskey(newLabel.trim())); toast("Passkey added", { description: r.label, tone: "success" }); setAdding(false); setNewLabel(""); refresh(); }
    catch (e) { fail("Could not add the passkey", e); } finally { setBusy(null); }
  }
  async function doRename() {
    if (!rename || !renameTo.trim()) return; setBusy("rename");
    try { await withFreshAuth(() => api(`/api/auth/passkeys/${encodeURIComponent(rename.id)}`, { method: "PATCH", json: { label: renameTo.trim() } })); toast("Renamed", { tone: "success" }); setRename(null); refresh(); }
    catch (e) { fail("Could not rename", e); } finally { setBusy(null); }
  }
  const revokePasskey = (p: Passkey) => setConfirm({ title: `Remove “${p.label}”?`, body: p.current ? "This is the passkey that opened this session: this device will be signed out, and the passkey can no longer open the app. Delete it from your password manager too." : "The passkey can no longer open the app and every session it opened is ended. Delete it from the device's password manager too.", cta: "Remove passkey", run: async () => {
    const r = await withFreshAuth(() => api<{ signedOut: boolean }>(`/api/auth/passkeys/${encodeURIComponent(p.id)}`, { method: "DELETE" }));
    if (r.signedOut) { await wipeLocalData(); window.location.href = "/login"; return; } toast("Passkey removed", { tone: "success" }); refresh();
  } });
  const revokeSession = (s: Sess) => setConfirm({ title: s.current ? "Lock this device?" : `Sign out “${s.label}”?`, body: s.current ? "This session ends now. Unsynced drafts kept on this device are erased. You come back with your passkey." : "That device is signed out immediately and needs its passkey to come back.", cta: s.current ? "Lock" : "Sign out", run: async () => {
    if (s.current) return lockDevice();
    await withFreshAuth(() => api(`/api/auth/sessions/${s.id}`, { method: "DELETE" })); toast("Device signed out", { tone: "success" }); refresh();
  } });
  const revokeAll = (includeCurrent: boolean) => setConfirm({ title: includeCurrent ? "Sign out everywhere?" : "Sign out all other devices?", body: includeCurrent ? "Every session ends, including this one. Passkeys are kept: each device signs in again." : "Every other session ends now. This device stays signed in.", cta: "Sign out", run: async () => {
    const r = await withFreshAuth(() => api<{ revoked: number }>("/api/auth/sessions", { method: "DELETE", json: { includeCurrent } }));
    if (includeCurrent) { await wipeLocalData(); window.location.href = "/login"; return; } toast(`${r.revoked} session${r.revoked === 1 ? "" : "s"} ended`, { tone: "success" }); refresh();
  } });

  const H = ({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }) => <div className="mb-3 flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h2 className="flex items-center gap-2 text-[15px] font-semibold [&_svg]:size-4 [&_svg]:text-fg-muted">{icon}{title}</h2><p className="text-[13px] leading-5 text-fg-muted">{hint}</p></div>{action}</div>;
  const rowCls = "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-3 last:border-b-0 sm:px-4";
  const only = (passkeys?.length ?? 0) <= 1;
  return (
    <div className="space-y-10">
      {state?.legacyEnv?.length ? <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning/15 p-3 text-[13px] leading-5"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" /><span>Old access variables are still present in the server <code className="font-mono text-[12px]">.env</code> ({state.legacyEnv.join(", ")}). They are ignored, but remove them to finish the migration (docs/security.md).</span></div> : null}
      {state?.enrollmentOpen ? <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning/15 p-3 text-[13px] leading-5"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" /><span>An enrollment window ({state.enrollmentOpen.purpose}) is open until {fmtDate(state.enrollmentOpen.expiresAt, { timeStyle: "short" })}. If you did not open it, run <code className="font-mono text-[12px]">pnpm auth:close-enrollment</code> on the server.</span></div> : null}

      <section aria-labelledby="sec-passkeys">
        <H icon={<KeyRound />} title="Passkeys" hint={`You open this app with a passkey confirmed by ${localUnlockName()} or your device passcode. The server stores a public key only — nothing biometric ever leaves the device.`} action={<Button size="sm" onClick={() => { setNewLabel(""); setAdding(true); }}><Plus /> Add a passkey</Button>} />
        <div id="sec-passkeys" className="overflow-hidden rounded-xl border border-line bg-bg-elev">
          {pLoading ? <div className="flex justify-center py-8"><Spinner /></div> : pErr ? <div className="p-4 text-[13px] text-danger">Could not load passkeys. <button className="underline" onClick={refresh}>Retry</button></div> : passkeys!.map((p) => (
            <div key={p.id} className={rowCls}>
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><KeyRound className="size-4" /></div>
              <div className="min-w-0 flex-1 basis-40"><div className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium"><span className="truncate">{p.label}</span>{p.current && <Badge tone="accent">this session</Badge>}{p.synced && <Badge><Cloud className="mr-1 size-3" />synced</Badge>}</div><div className="text-[12px] text-fg-faint">Added {fmtDate(p.createdAt)} · {p.lastUsedAt ? `last used ${timeAgo(p.lastUsedAt)}` : "never used"}</div></div>
              <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label={`Rename ${p.label}`} onClick={() => { setRename(p); setRenameTo(p.label); }}><Pencil /><span className="max-sm:sr-only">Rename</span></Button><Button size="sm" variant="ghost" className="text-danger hover:text-danger" disabled={only} title={only ? "Add another passkey first" : undefined} aria-label={`Remove ${p.label}`} onClick={() => revokePasskey(p)}><Trash2 /><span className="max-sm:sr-only">Remove</span></Button></div>
            </div>))}
        </div>
        {only && !pLoading && <p className="mt-2 text-[12.5px] leading-5 text-fg-muted">You have a single passkey. Add a second one on another device (or a hardware key) so that losing this device does not lock you out. The only fallback is the server-side recovery procedure.</p>}
      </section>

      <section aria-labelledby="sec-sessions">
        <H icon={<Smartphone />} title="Devices & sessions" hint={`A session ends after ${state?.idleDays ?? 30} days without use, at most ${state?.absoluteDays ?? 90} days after sign-in, or when you revoke it here.`} action={<div className="flex gap-1.5"><Button size="sm" variant="outline" onClick={() => revokeAll(false)} disabled={(sessions?.length ?? 0) < 2}><LogOut /> Others</Button><Button size="sm" variant="outline" onClick={() => revokeAll(true)}><LogOut /> Everywhere</Button></div>} />
        <div id="sec-sessions" className="overflow-hidden rounded-xl border border-line bg-bg-elev">
          {sLoading ? <div className="flex justify-center py-8"><Spinner /></div> : sErr ? <div className="p-4 text-[13px] text-danger">Could not load sessions. <button className="underline" onClick={refresh}>Retry</button></div> : sessions!.map((s) => (
            <div key={s.id} className={rowCls}>
              <div className="min-w-0 flex-1 basis-40"><div className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium"><span className="truncate">{s.label}</span>{s.current && <Badge tone="success">this device</Badge>}</div><div className="text-[12px] text-fg-faint">Active {timeAgo(s.lastSeenAt)} · signed in {fmtDate(s.createdAt)} · ends {fmtDate(s.expiresAt)}{s.ip ? ` · ${s.ip}` : ""}</div></div>
              <Button size="sm" variant={s.current ? "outline" : "ghost"} onClick={() => revokeSession(s)}>{s.current ? <><Lock /> Lock</> : <><LogOut /> Sign out</>}</Button>
            </div>))}
        </div>
      </section>

      <section>
        <H icon={<ShieldCheck />} title="How access works" hint="Plain facts about this installation." />
        <ul className="space-y-1.5 rounded-xl border border-line bg-bg-elev p-4 text-[13px] leading-5 text-fg-muted">
          <li>Passkeys are bound to <code className="font-mono text-[12px] text-fg">{state?.rpId ?? "…"}</code> and only accepted from <code className="font-mono text-[12px] text-fg">{state?.origins?.join(", ") ?? "…"}</code>.</li>
          <li>The app always asks the device for user verification. The operating system decides how: Face ID, Touch ID, fingerprint, or the device passcode as its own fallback — a website cannot force biometrics and never sees which one was used.</li>
          <li>There is no password and no secret link. If every device is lost, access is restored from the server shell only (<code className="font-mono text-[12px]">pnpm auth:recover</code>, see docs/security.md).</li>
          <li>Adding, renaming or removing passkeys, signing other devices out, full exports and permanent deletions ask for your passkey again (valid 5 minutes).</li>
        </ul>
      </section>

      <section>
        <H icon={<History />} title="Recent activity" hint="Last 50 security and content events." action={<Button size="sm" variant="ghost" onClick={() => refetchAudit()}><RefreshCw /> Refresh</Button>} />
        <div className="overflow-hidden rounded-xl border border-line bg-bg-elev">
          {aLoading ? <div className="flex justify-center py-8"><Spinner /></div> : auditRows.length ? <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">{auditRows.map((a) => <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-[12.5px] sm:px-4"><span className={cn("font-mono text-[12px]", /fail|denied|revoked|purge|delete|recovery/.test(a.action) ? "text-danger" : "text-fg")}>{a.action}</span><span className="min-w-0 flex-1 truncate text-fg-faint">{a.detail && Object.keys(a.detail).length ? Object.entries(a.detail).filter(([, v]) => v != null && typeof v !== "object").map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`).join(" · ") : ""}</span><span className="whitespace-nowrap text-fg-muted" title={fmtDate(a.createdAt, { dateStyle: "medium", timeStyle: "short" })}>{timeAgo(a.createdAt)}{a.ip ? ` · ${a.ip}` : ""}</span></li>)}</ul> : <div className="py-8 text-center text-[13px] text-fg-faint">No activity yet.</div>}
        </div>
      </section>

      <Dialog open={adding} onOpenChange={(o) => { if (!busy) setAdding(o); }}><DialogContent title="Add a passkey" description="Do this on the device that will hold the new passkey, or pick “another device” in the system sheet to store it on your phone or a security key. You will first confirm with your current passkey.">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); add(); }}><div className="grid gap-1"><Label htmlFor="new-pk">Name</Label><Input id="new-pk" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} maxLength={60} placeholder="MacBook, iPad, YubiKey…" autoComplete="off" className="h-10 text-[16px] sm:text-sm" /></div><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setAdding(false)} disabled={busy === "add"}>Cancel</Button><Button type="submit" disabled={busy === "add"}>{busy === "add" ? <Spinner className="border-white/40 border-t-white" /> : <KeyRound />} Continue</Button></div></form>
      </DialogContent></Dialog>
      <Dialog open={rename !== null} onOpenChange={(o) => { if (!o && !busy) setRename(null); }}><DialogContent title="Rename passkey">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); doRename(); }}><Input value={renameTo} onChange={(e) => setRenameTo(e.target.value)} maxLength={60} aria-label="Passkey name" autoFocus className="h-10 text-[16px] sm:text-sm" /><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setRename(null)}>Cancel</Button><Button type="submit" disabled={busy === "rename" || !renameTo.trim()}>Save</Button></div></form>
      </DialogContent></Dialog>
      <Dialog open={confirm !== null} onOpenChange={(o) => { if (!o && busy !== "confirm") setConfirm(null); }}><DialogContent title={confirm?.title} description={confirm?.body}>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy === "confirm"}>Cancel</Button><Button variant="danger" disabled={busy === "confirm"} onClick={async () => { const c = confirm!; setBusy("confirm"); try { await c.run(); setConfirm(null); } catch (e) { fail("Action failed", e); } finally { setBusy(null); } }}>{busy === "confirm" && <Spinner className="border-white/40 border-t-white" />}{confirm?.cta}</Button></div>
      </DialogContent></Dialog>
    </div>
  );
}
