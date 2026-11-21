/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/pages/[id]/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

import { z } from "zod";
import { handler, parseBody, uuid, requireFresh } from "@/lib/api";
import { getPage, updatePage, softDeletePage, restorePage, purgePage, breadcrumb, backlinks, touchOpened, duplicatePage } from "@/lib/pages/service";
import { audit } from "@/lib/audit";
import { assertDoc } from "@/lib/editor/validate";

export const GET = handler(async ({ ws, params, req }) => {
  const id = uuid.parse(params.id); const p = await getPage(ws.id, id, { includeDeleted: true });
  if (new URL(req.url).searchParams.get("open") === "1") touchOpened(id).catch(() => {});
  if (new URL(req.url).searchParams.get("head") === "1") return Response.json({ id: p.id, version: p.version, updatedAt: p.updatedAt, deletedAt: p.deletedAt });
  const [crumbs, back] = await Promise.all([breadcrumb(ws.id, id), backlinks(ws.id, id)]);
  return Response.json({ ...p, breadcrumb: crumbs, backlinks: back });
});
export const PATCH = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id);
  const b = await parseBody(req, z.object({ title: z.string().max(500).optional(), content: z.any().optional(), icon: z.string().max(16).nullable().optional(), cover: z.string().max(2000).nullable().optional(), properties: z.record(z.string(), z.unknown()).optional(), parentId: z.string().uuid().nullable().optional(), section: z.string().optional(), position: z.number().optional(), pinned: z.boolean().optional(), archived: z.boolean().optional(), type: z.string().optional(), versionReason: z.string().max(100).optional(), baseVersion: z.number().int().min(0).optional() }));
  const { versionReason, baseVersion, ...patch } = b;
  if (patch.content !== undefined) assertDoc(patch.content);
  const p = await updatePage(ws.id, id, patch, { versionReason, baseVersion });
  if (patch.content === undefined) await audit(user.id, "page.update", { type: "page", id }, { keys: Object.keys(patch) });
  return Response.json({ id: p.id, version: p.version, updatedAt: p.updatedAt, title: p.title, wordCount: p.wordCount });
});
export const DELETE = handler(async ({ ws, params, user, req }) => {
  const id = uuid.parse(params.id); const purge = new URL(req.url).searchParams.get("purge") === "1";
  if (purge) { requireFresh(user); // permanent deletion: passkey verified in the last 5 minutes
    await purgePage(ws.id, id); await audit(user.id, "page.purge", { type: "page", id }); return Response.json({ ok: true }); }
  const n = await softDeletePage(ws.id, id); await audit(user.id, "page.trash", { type: "page", id }, { count: n });
  return Response.json({ ok: true, trashed: n });
});
export const POST = handler(async ({ ws, params, user, req }) => {
  const id = uuid.parse(params.id); const action = new URL(req.url).searchParams.get("action");
  if (action === "restore") { await restorePage(ws.id, id); await audit(user.id, "page.restore", { type: "page", id }); return Response.json({ ok: true }); }
  if (action === "duplicate") { const p = await duplicatePage(ws.id, id); await audit(user.id, "page.duplicate", { type: "page", id }, { to: p.id }); return Response.json(p); }
  return Response.json({ error: "Unknown action" }, { status: 400 });
});
