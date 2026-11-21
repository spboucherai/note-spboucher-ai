/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/(app)/p/[id]/loading.tsx
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-09
 * Last Modified    : 2026-11-09
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

import { Skeleton } from "@/components/ui/primitives";
export default function Loading() {
  return (
    <div role="status" aria-label="Loading page" className="measure mx-auto w-full px-5 pt-10 md:px-0">
      <Skeleton className="size-12 rounded-xl" /><Skeleton className="mt-4 h-10 w-2/3" />
      <div className="mt-8 space-y-3">{["w-full", "w-11/12", "w-4/5", "w-full", "w-3/5"].map((w, i) => <Skeleton key={i} className={`h-4 ${w}`} />)}</div>
      <div className="mt-8 space-y-3">{["w-full", "w-5/6", "w-2/3"].map((w, i) => <Skeleton key={i} className={`h-4 ${w}`} />)}</div>
    </div>
  );
}
