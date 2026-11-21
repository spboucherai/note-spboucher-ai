/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/auth/AuthCard.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-19
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
import { cn } from "@/lib/utils";
/** Neutral frame shared by the sign-in and enrollment screens: no workspace name, no hint of what is behind. */
export function AuthCard({ icon, title, children, footer }: { icon: React.ReactNode; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-5 py-8 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="rounded-3xl border border-line bg-bg-elev p-6 shadow-pop sm:p-7">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent [&_svg]:size-7">{icon}</div>
          <h1 className="text-center text-[19px] font-semibold tracking-[-0.015em]">{title}</h1>
          <div className="mt-4">{children}</div>
        </div>
        {footer && <div className="mt-4 px-2 text-center text-[12px] leading-5 text-fg-faint">{footer}</div>}
      </div>
    </main>
  );
}
export function AuthNotice({ tone = "neutral", children }: { tone?: "neutral" | "danger" | "success" | "warning"; children: React.ReactNode }) {
  return <div role={tone === "danger" ? "alert" : "status"} aria-live="polite" className={cn("rounded-xl border px-3 py-2.5 text-[13px] leading-5", tone === "danger" ? "border-danger/30 bg-danger/10 text-danger-text" : tone === "success" ? "border-success/30 bg-success/10 text-success-text" : tone === "warning" ? "border-warning/40 bg-warning/15 text-fg" : "border-line bg-bg-sunk text-fg-muted")}>{children}</div>;
}
export const BIOMETRIC_NOTE = "Your device checks that it is you (Face ID, Touch ID, fingerprint — or the device passcode as its own fallback). This site only receives a cryptographic signature: never an image of your face, a fingerprint or your passcode.";
