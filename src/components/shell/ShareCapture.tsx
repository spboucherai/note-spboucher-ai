/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/shell/ShareCapture.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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
/**
 * file: src/components/shell/ShareCapture.tsx
 * description: client half of `/share` (Web Share Target): turns `?title=&text=&url=` into a capture prefill, opens the quick-capture
 *   sheet on it and replaces the address by `/inbox`, so a reload or "Back" does not offer the same share again. Nothing is saved
 *   until the user presses Capture.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { useEffect, useRef } from "react";
import { openCapture } from "@/lib/client/capture";
import { prefillFromShare } from "@/lib/client/capture-logic";
import { toast } from "@/components/ui/toast";

export function ShareCapture({ title, text, url }: { title: string; text: string; url: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return; done.current = true;
    const prefill = prefillFromShare({ title, text, url });
    window.history.replaceState(window.history.state, "", "/inbox");
    if (prefill) openCapture(prefill); else toast("Nothing was shared", { description: "Open quick capture to write something." });
  }, [title, text, url]);
  return null;
}
