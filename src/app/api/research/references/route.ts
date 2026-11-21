/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/research/references/route.ts
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

import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { listReferences, createReference, REPLAYED } from "@/lib/research/references";
import { audit } from "@/lib/audit";
import { shortLabel, formatCitation } from "@/lib/research/cite";
import { projectPages, projectReferences } from "@/lib/research/latex";
export const refSchema = z.object({ id: uuid.optional(), pageId: uuid.nullable().optional(), citeKey: z.string().max(120).nullable().optional(), entryType: z.string().max(40).optional(), title: z.string().min(1).max(1000), authors: z.array(z.string().max(200)).max(100).optional(), year: z.number().int().min(1000).max(2100).nullable().optional(), journal: z.string().max(500).nullable().optional(), doi: z.string().max(200).nullable().optional(), url: z.string().max(2000).nullable().optional(), fields: z.record(z.string(), z.unknown()).optional(), verified: z.enum(["user", "doi_verified", "ai_suggested"]).optional(), attachmentId: uuid.nullable().optional() });
/**
 * GET ?pageId=<id> (page references) | no pageId = whole library
 * NEXT (SPEC §4.14): ?ids=<uuid,uuid,…> (≤ 200) → exactly those references, for resolving `citation` nodes — each row gains `label`
 * (author–year) and `citation` (formatted entry); ids that do not exist are listed in the `x-missing-ids` header.
 * ?projectId=<page id> → references of a project (attached to any of its pages, or cited in its text).
 * ?attachmentId=<attachment id> → the references whose attached PDF is that file (each with `label`), so a `pdf` block can link its
 *   annotations to the reference's extracts. Combinable with nothing else; `400 bad_id` on a malformed id.
 */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams; const pageId = u.get("pageId"); const rawIds = u.get("ids"); const projectId = u.get("projectId");
  if (rawIds !== null) {
    const ids = [...new Set(rawIds.split(",").map((x) => x.trim()).filter(Boolean))]; if (ids.length > 200) throw new HttpError(400, "At most 200 ids", "too_many_ids");
    for (const id of ids) if (!uuid.safeParse(id).success) throw new HttpError(400, "Invalid reference id", "bad_id");
    const rows = ids.length ? await listReferences(ws.id, { ids }) : []; const found = new Set(rows.map((r) => r.id));
    return Response.json(rows.map((r) => ({ ...r, label: shortLabel(r), citation: formatCitation(r) })), { headers: { "x-missing-ids": ids.filter((i) => !found.has(i)).join(",") } });
  }
  const attachmentId = u.get("attachmentId");
  if (attachmentId !== null) {
    if (!uuid.safeParse(attachmentId).success) throw new HttpError(400, "Invalid attachmentId", "bad_id");
    return Response.json((await listReferences(ws.id, { attachmentId })).map((r) => ({ ...r, label: shortLabel(r) })));
  }
  if (projectId) {
    if (!uuid.safeParse(projectId).success) throw new HttpError(400, "Invalid projectId", "bad_id");
    return Response.json(await projectReferences(ws.id, await projectPages(ws.id, projectId)));
  }
  if (pageId && !uuid.safeParse(pageId).success) throw new HttpError(400, "Invalid pageId", "bad_id");
  return Response.json(await listReferences(ws.id, { pageId: pageId || null }));
});
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, refSchema);
  const r = await createReference(ws.id, { ...b, verified: b.verified ?? "user" }); // 3.0: a client-chosen `id` makes the call idempotent (the stored reference is returned)
  if (REPLAYED.has(r)) return Response.json(r, { status: 200, headers: { "x-existing": "1" } }); // same id again: the stored row, nothing written
  await audit(user.id, "reference.create", { type: "reference", id: r.id }, { citeKey: r.citeKey });
  return Response.json(r, { status: 201 });
});
