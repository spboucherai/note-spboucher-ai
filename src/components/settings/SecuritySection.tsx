"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, KeyRound, Bookmark, RefreshCw, History } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, timeAgo, fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, Spinner } from "@/components/ui/primitives";
import type { SettingsProfile } from "./SettingsView";

interface AuditRow { id: string; action: string; targetType: string | null; targetId: string | null; detail: Record<string, unknown> | null; ip: string | null; createdAt: string }

/** Access model (2026-11-09): shared password gate or bookmark unlock → one long-lived device cookie. No accounts, sessions or 2FA. */
export function SecuritySection(_: { profile: SettingsProfile; refresh: () => void }) {
  const { data: auditRows = [], isLoading: aLoading, refetch: refetchAudit } = useQuery({ queryKey: ["settings-audit"], queryFn: () => api<AuditRow[]>("/api/settings/audit?limit=50") });
  const [lockOpen, setLockOpen] = useState(false);
  async function lock() { await api("/api/lock", { method: "POST" }).catch(() => {}); window.location.href = "/"; }
  const H = ({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }) => <div className="mb-3 flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h2 className="flex items-center gap-2 text-[15px] font-semibold [&_svg]:size-4 [&_svg]:text-fg-muted">{icon}{title}</h2><p className="text-[13px] text-fg-muted">{hint}</p></div>{action}</div>;
  return (
    <div className="space-y-10">
      <section>
        <H icon={<KeyRound />} title="Access" hint="This device holds a private access cookie valid 400 days. No account, no sign-in." action={<Button size="sm" variant="outline" onClick={() => setLockOpen(true)}><Lock /> Lock this device</Button>} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-bg-elev p-4"><div className="flex items-center gap-2 text-[13px] font-medium"><KeyRound className="size-4 text-accent" /> Shared password</div><p className="mt-1 text-[12.5px] leading-5 text-fg-muted">Any page opened without the cookie shows a neutral lock screen with one password field. Attempts are rate-limited (5 / min per IP) and logged below.</p></div>
          <div className="rounded-xl border border-line bg-bg-elev p-4"><div className="flex items-center gap-2 text-[13px] font-medium"><Bookmark className="size-4 text-accent" /> Bookmark unlock</div><p className="mt-1 text-[12.5px] leading-5 text-fg-muted">The private <code className="font-mono text-[11.5px]">/unlock/…</code> link sets the same cookie in one tap. Rotation: change <code className="font-mono text-[11.5px]">ACCESS_KEY</code> or <code className="font-mono text-[11.5px]">ACCESS_PASSWORD_HASH</code> in the node <code className="font-mono text-[11.5px]">.env</code> — every device is locked out (see docs/security.md).</p></div>
        </div>
      </section>
      <section>
        <H icon={<History />} title="Recent activity" hint="Last 50 security and content events recorded for your account." action={<Button size="sm" variant="ghost" onClick={() => refetchAudit()}><RefreshCw /> Refresh</Button>} />
        <div className="overflow-x-auto rounded-xl border border-line bg-bg-elev">
          <table className="w-full min-w-[520px] text-[12.5px]"><thead><tr className="border-b border-line bg-bg-sunk/60 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-faint"><th className="px-3 py-1.5">When</th><th className="px-3 py-1.5">Action</th><th className="px-3 py-1.5">Target</th><th className="px-3 py-1.5">IP</th></tr></thead>
            <tbody>{aLoading ? <tr><td colSpan={4} className="py-8 text-center"><Spinner /></td></tr> : auditRows.length ? auditRows.map((a) => <tr key={a.id} className="border-b border-line last:border-b-0"><td className="whitespace-nowrap px-3 py-1.5 text-fg-muted" title={fmtDate(a.createdAt, { dateStyle: "medium", timeStyle: "short" })}>{timeAgo(a.createdAt)}</td><td className={cn("px-3 py-1.5 font-mono text-[12px]", /fail|revoked|disabled|purge|delete/.test(a.action) && "text-danger")}>{a.action}</td><td className="max-w-[260px] truncate px-3 py-1.5 text-fg-muted">{a.targetType ? `${a.targetType} ${a.targetId?.slice(0, 8) ?? ""}` : ""}{a.detail && Object.keys(a.detail).length ? <span className="text-fg-faint"> {JSON.stringify(a.detail).slice(0, 80)}</span> : null}</td><td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-fg-faint">{a.ip ?? ""}</td></tr>) : <tr><td colSpan={4} className="py-8 text-center text-fg-faint">No activity yet.</td></tr>}</tbody></table>
        </div>
      </section>
      <Dialog open={lockOpen} onOpenChange={setLockOpen}><DialogContent title="Lock this device?" description="The access cookie is removed from this browser. You will need the password or the bookmark link to come back."><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setLockOpen(false)}>Cancel</Button><Button variant="danger" onClick={lock} autoFocus><Lock /> Lock</Button></div></DialogContent></Dialog>
    </div>
  );
}
