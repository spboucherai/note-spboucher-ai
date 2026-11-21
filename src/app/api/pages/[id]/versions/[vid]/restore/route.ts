/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/pages/[id]/versions/[vid]/restore/route.ts
 * Module           : app
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

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { handler, HttpError, uuid } from "@/lib/api";
import { db, schema } from "@/db";
import { getPage, updatePage } from "@/lib/pages/service";
import { audit } from "@/lib/audit";
/**
 * POST /api/pages/<id>/versions/<vid>/restore [{ baseVersion? }] → `{ok, version}` — restores a history entry (SPEC §4.4). `<vid>` is the
 * id of the entry (`versionId` of the time machine, `id` of GET …/versions) or its version number. Same path as the 2.x
 * `POST /api/pages/<id>/versions {version}`: the current state is saved in the history first, then replaced. With `baseVersion`, the
 * restore is refused (409 `conflict`) when the page changed meanwhile.
 */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id); await getPage(ws.id, id);
  const V = schema.pageVersions; const vid = params.vid;
  const byId = z.string().uuid().safeParse(vid).success; if (!byId && !/^-?\d{1,12}$/.test(vid)) throw new HttpError(400, "Invalid version", "bad_request");
  const [row] = await db.select().from(V).where(and(eq(V.pageId, id), byId ? eq(V.id, vid) : eq(V.version, Number(vid))));
  if (!row) throw new HttpError(404, "Version not found", "not_found");
  const body = await req.json().catch(() => ({})); const base = z.object({ baseVersion: z.number().int().min(0).optional() }).safeParse(body ?? {});
  if (!base.success) throw new HttpError(400, "Validation: baseVersion must be an integer", "bad_request");
  const p = await updatePage(ws.id, id, { title: row.title, content: row.content as any, properties: (row.properties ?? {}) as any }, { versionReason: `restore v${row.version}`, baseVersion: base.data.baseVersion });
  await audit(user.id, "page.restore_version", { type: "page", id }, { version: row.version });
  return Response.json({ ok: true, version: p.version, restored: row.version });
});
