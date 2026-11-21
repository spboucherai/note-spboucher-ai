/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/research/references/[id]/route.ts
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
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { getReference, updateReference, deleteReference, restoreReference, attachPdf, verifyReference } from "@/lib/research/references";
import { audit } from "@/lib/audit";
/** `fields` is a partial edit of BibTeX tags: tags that are not listed are kept, an empty value removes a tag. */
const patchSchema = z.object({ pageId: uuid.nullable().optional(), citeKey: z.string().max(120).optional(), entryType: z.string().max(40).optional(), title: z.string().min(1).max(1000).optional(), authors: z.array(z.string().max(200)).max(100).optional(), year: z.number().int().min(1000).max(2100).nullable().optional(), journal: z.string().max(500).nullable().optional(), doi: z.string().max(200).nullable().optional(), url: z.string().max(2000).nullable().optional(), fields: z.record(z.string().max(80), z.union([z.string().max(20_000), z.number(), z.null()])).optional(), verified: z.enum(["user", "doi_verified", "ai_suggested"]).optional(), attachmentId: uuid.nullable().optional() });
export const GET = handler(async ({ ws, params }) => Response.json(await getReference(ws.id, uuid.parse(params.id))));
export const PATCH = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const b = await parseBody(req, patchSchema);
  const r = await updateReference(ws.id, id, b); await audit(user.id, "reference.update", { type: "reference", id }, { keys: Object.keys(b) });
  return Response.json(r);
});
export const DELETE = handler(async ({ ws, params, user }) => { const id = uuid.parse(params.id); await deleteReference(ws.id, id); await audit(user.id, "reference.delete", { type: "reference", id }); return Response.json({ ok: true }); });
/** POST ?action=attach {attachmentId|null} | ?action=verify (Crossref re-check) | ?action=restore (undo of a delete) */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); const action = new URL(req.url).searchParams.get("action");
  if (action === "attach") { const b = await parseBody(req, z.object({ attachmentId: uuid.nullable() })); const r = await attachPdf(ws.id, id, b.attachmentId); await audit(user.id, "reference.attach", { type: "reference", id }, { attachmentId: b.attachmentId }); return Response.json(r); }
  if (action === "verify") { const r = await verifyReference(ws.id, id); await audit(user.id, "reference.verify", { type: "reference", id }, { doi: r.doi }); return Response.json(r); }
  if (action === "restore") { const r = await restoreReference(ws.id, id); await audit(user.id, "reference.restore", { type: "reference", id }); return Response.json(r); }
  throw new HttpError(400, "Unknown action");
});
