/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/(app)/p/[id]/page.tsx
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

import { notFound } from "next/navigation";
import { requireUserPage, getWorkspace } from "@/lib/auth/guard";
import { getPage, breadcrumb, backlinks, touchOpened } from "@/lib/pages/service";
import { PageView } from "@/components/page/PageView";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const user = await requireUserPage(); const ws = await getWorkspace(user.id);
  let page; try { page = await getPage(ws.id, id, { includeDeleted: true }); } catch { notFound(); }
  const [crumbs, back] = await Promise.all([breadcrumb(ws.id, id), backlinks(ws.id, id)]);
  touchOpened(id).catch(() => {});
  return <PageView key={id} page={JSON.parse(JSON.stringify(page))} breadcrumb={crumbs} backlinks={JSON.parse(JSON.stringify(back))} />;
}
