/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/graph/backlinks/route.ts
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

import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { backlinkStats, unlinkedMentions, linkMention, dismissMention } from "@/lib/graph/backlinks";
import { audit } from "@/lib/audit";

/** GET ?q=&pageId= → { pages, mentions } */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams; const pid = uuid.safeParse(u.get("pageId"));
  const [pages, mentions] = await Promise.all([backlinkStats(ws.id, { q: u.get("q") ?? "" }), unlinkedMentions(ws.id, { pageId: pid.success ? pid.data : null })]);
  return Response.json({ pages, mentions }, { headers: { "cache-control": "private, no-store" } });
});

/** POST { action: "link" | "dismiss" | "undismiss", fromId, toId } */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ action: z.enum(["link", "dismiss", "undismiss"]), fromId: uuid, toId: uuid }));
  if (b.action === "link") { await linkMention(ws.id, b.fromId, b.toId); await audit(user.id, "backlinks.link", { type: "page", id: b.fromId }, { to: b.toId }); return Response.json({ ok: true }); }
  await dismissMention(b.fromId, b.toId, b.action === "undismiss");
  return Response.json({ ok: true });
});
