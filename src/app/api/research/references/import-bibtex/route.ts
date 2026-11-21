/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/research/references/import-bibtex/route.ts
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
import { importBibtex } from "@/lib/research/references";
import { audit } from "@/lib/audit";
export const maxDuration = 120;
const MAX = 20 * 1024 * 1024;
/**
 * POST multipart (file=.bib | text, pageId) or JSON { text, pageId }. `?dryRun=1` (or dryRun in the body) analyses without writing:
 * { parsed, wouldCreate[], skipped[{ citeKey, reason }], failed[{ citeKey, reason }] }. Duplicates (DOI, then cite key) are skipped, never overwritten.
 */
export const POST = handler(async ({ req, ws, user }) => {
  let text = ""; let pageId: string | null = null; let dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData(); const f = form.get("file"); const t = form.get("text"); pageId = (form.get("pageId") as string) || null; if (form.get("dryRun") === "1") dryRun = true;
    if (f instanceof File) { if (f.size > MAX) throw new HttpError(413, "BibTeX file too large (max 20 MB)", "file_too_large"); const buf = Buffer.from(await f.arrayBuffer()); if (buf.subarray(0, 8192).includes(0)) throw new HttpError(415, "This file is not text — choose a .bib file.", "type_mismatch"); text = buf.toString("utf8"); } else if (typeof t === "string") text = t;
  } else { const b = await parseBody(req, z.object({ text: z.string().min(1).max(MAX), pageId: uuid.nullable().optional(), dryRun: z.boolean().optional() })); text = b.text; pageId = b.pageId ?? null; dryRun = dryRun || Boolean(b.dryRun); }
  if (text.length > MAX) throw new HttpError(413, "BibTeX too large (max 20 MB)", "file_too_large");
  if (!text.trim()) throw new HttpError(400, "Paste BibTeX or choose a .bib file first.", "bibtex_empty");
  if (pageId && !uuid.safeParse(pageId).success) throw new HttpError(400, "Invalid pageId");
  const res = await importBibtex(ws.id, text, pageId, { dryRun });
  if (!dryRun) await audit(user.id, "reference.import", pageId ? { type: "page", id: pageId } : undefined, { parsed: res.parsed, created: res.created.length, skipped: res.skipped.length, failed: res.failed.length });
  return Response.json({ dryRun, parsed: res.parsed, created: res.created.map((r) => ({ id: r.id, citeKey: r.citeKey, title: r.title })), wouldCreate: res.wouldCreate.slice(0, 500), skipped: res.skipped.slice(0, 500), failed: res.failed.slice(0, 200), counts: { created: res.created.length, wouldCreate: res.wouldCreate.length, skipped: res.skipped.length, failed: res.failed.length } });
});
