/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/research/papers/route.ts
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
import { handler, parseBody } from "@/lib/api";
import { createPage } from "@/lib/pages/service";
import { workingPaperTemplate, researchProjectTemplate } from "@/lib/research/template";
import { PAPER_STATUSES } from "@/lib/research/overview";
import { audit } from "@/lib/audit";
/**
 * POST { title?, status?, venue?, kind? } → new research page (section research) with the LaTeX-ready starter template.
 * `kind: "project"` (3.0, additive; default "paper" = unchanged behaviour) scaffolds a research project instead: the root research page
 * plus five child pages (Hypotheses, Methods notes, Equations, Results, Figures). The answer is the root page, with `children: [{id, title, key}]`.
 */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ title: z.string().max(300).optional(), status: z.enum(PAPER_STATUSES).optional(), venue: z.string().max(200).optional(), kind: z.enum(["paper", "project"]).optional() }));
  const project = b.kind === "project"; const title = b.title?.trim() || (project ? "New research project" : "New working paper");
  const properties = { status: b.status ?? "planning", ...(b.venue ? { venue: b.venue } : {}), tags: [project ? "research-project" : "working-paper"], ...(project ? { researchKind: "project" } : {}) };
  if (!project) {
    const p = await createPage(ws.id, { title, section: "research", type: "research", icon: "🔬", content: workingPaperTemplate(title), properties });
    await audit(user.id, "page.create", { type: "page", id: p.id }, { title: p.title, kind: "working-paper" });
    return Response.json(p, { status: 201 });
  }
  const scaffold = researchProjectTemplate(title);
  const root = await createPage(ws.id, { title, section: "research", type: "research", icon: "🔬", content: scaffold.root, properties });
  const children: { id: string; title: string; key: string }[] = [];
  for (const c of scaffold.children) { const page = await createPage(ws.id, { title: c.title, parentId: root.id, section: "research", icon: c.icon, content: c.content, properties: { researchRole: c.key } }); children.push({ id: page.id, title: page.title, key: c.key }); }
  await audit(user.id, "page.create", { type: "page", id: root.id }, { title: root.title, kind: "research-project", children: children.length });
  return Response.json({ ...root, children }, { status: 201 });
});
