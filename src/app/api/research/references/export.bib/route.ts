/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/research/references/export.bib/route.ts
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

import { and, eq } from "drizzle-orm";
import { handler, uuid, HttpError } from "@/lib/api";
import { listReferences } from "@/lib/research/references";
import { bibFile } from "@/lib/research/bibtex";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { projectPages, projectReferences } from "@/lib/research/latex";
/**
 * GET ?pageId=<id> → references.bib of that page; without pageId → whole library. ?inline=1 returns text without attachment header.
 * NEXT (SPEC §4.14): ?projectId=<page id> → the .bib companion of the LaTeX export: references attached to any page of the project
 * plus every library reference cited in its text.
 */
export const GET = handler(async ({ req, ws, user }) => {
  const u = new URL(req.url); const raw = u.searchParams.get("pageId"); const inline = u.searchParams.get("inline") === "1";
  const pageId = raw ? uuid.safeParse(raw) : null; if (pageId && !pageId.success) throw new HttpError(400, "Invalid pageId");
  const rawProject = u.searchParams.get("projectId"); const projectId = rawProject ? uuid.safeParse(rawProject) : null; if (projectId && !projectId.success) throw new HttpError(400, "Invalid projectId");
  if (projectId?.data) {
    const pages = await projectPages(ws.id, projectId.data); const prefs = await projectReferences(ws.id, pages);
    await audit(user.id, "export", { type: "page", id: projectId.data }, { format: "bib", scope: "project", references: prefs.length });
    return new Response(bibFile(prefs), { headers: { "content-type": "application/x-bibtex; charset=utf-8", "x-export-count": String(prefs.length), ...(inline ? {} : { "content-disposition": `attachment; filename="references.bib"` }) } });
  }
  const refs = await listReferences(ws.id, { pageId: pageId?.data ?? null });
  let name = "library";
  if (pageId?.data) { const [p] = await db.select({ title: schema.pages.title }).from(schema.pages).where(and(eq(schema.pages.id, pageId.data), eq(schema.pages.workspaceId, ws.id))); name = (p?.title ?? "references").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "references"; }
  await audit(user.id, "export", pageId?.data ? { type: "page", id: pageId.data } : { type: "workspace", id: ws.id }, { format: "bib", references: refs.length });
  return new Response(bibFile(refs), { headers: { "content-type": "application/x-bibtex; charset=utf-8", "x-export-count": String(refs.length), ...(inline ? {} : { "content-disposition": `attachment; filename="${name}.bib"` }) } });
});
