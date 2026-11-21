/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/(app)/graph/page.tsx
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { KnowledgeGraph } from "@/components/knowledge/KnowledgeGraph";
export const metadata = { title: "Graph — Note SPBoucher AI" };
/** /graph[?view=global|local|project|timeline|concepts|documents|references&pageId=<id>] — `?focus=<id>` (2.x links) opens the local view of that page. */
export default async function GraphPage({ searchParams }: { searchParams: Promise<{ focus?: string; view?: string; pageId?: string; panel?: string; new?: string }> }) {
  const user = await requireUserPage(); await getWorkspace(user.id);
  const { focus, view, pageId, panel, new: create } = await searchParams;
  return <KnowledgeGraph initial={{ view: view ?? null, pageId: pageId ?? focus ?? null, panel: panel ?? null, create: create ?? null }} />;
}
