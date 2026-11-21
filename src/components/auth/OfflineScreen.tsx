/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/auth/OfflineScreen.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
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
import { CloudOff } from "lucide-react";
export function OfflineScreen() {
  const [online, setOnline] = useState(false);
  useEffect(() => { const back = () => { setOnline(true); const to = sessionStorage.getItem("note-offline-from") || "/"; setTimeout(() => window.location.replace(to), 400); }; if (window.location.pathname !== "/offline") try { sessionStorage.setItem("note-offline-from", window.location.pathname + window.location.search); } catch {} window.addEventListener("online", back); return () => window.removeEventListener("online", back); }, []);
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center safe-top safe-bottom">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-bg-sunk text-fg-muted"><CloudOff className="size-7" /></div>
        <h1 className="text-[19px] font-semibold">{online ? "Back online…" : "You are offline"}</h1>
        <p className="mt-2 text-[14px] leading-6 text-fg-muted">Your notes are not stored on this device, so they cannot be shown without a connection. Text you were typing and captures made offline are kept here and are sent as soon as the network returns.</p>
        <button onClick={() => window.location.reload()} className="mt-5 h-11 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg">Try again</button>
      </div>
    </main>
  );
}
