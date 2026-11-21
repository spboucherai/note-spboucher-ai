/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/(app)/layout.tsx
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
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

import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { listTree } from "@/lib/pages/service";
import { Shell } from "@/components/shell/Shell";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage(); const ws = await getWorkspace(user.id);
  const tree = await listTree(ws.id);
  return <Shell user={{ id: user.id, username: user.username, displayName: user.displayName }} workspace={{ id: ws.id, name: ws.name }} initialTree={tree.map((p) => ({ id: p.id, parentId: p.parentId, title: p.title, icon: p.icon, type: p.type, section: p.section, pinned: p.pinned, updatedAt: p.updatedAt.toISOString() }))}>{children}</Shell>;
}
