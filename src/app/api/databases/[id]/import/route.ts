/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/databases/[id]/import/route.ts
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

import { handler, HttpError } from "@/lib/api";
import { importCsv } from "@/lib/databases/csv";
import { audit } from "@/lib/audit";
/** multipart: file=<csv>. 3.0 (audit D4): a body that is not multipart, an empty file or a file without a header row → 400 (was 500). */
export const POST = handler(async ({ ws, params, req, user }) => {
  const form = await req.formData().catch(() => { throw new HttpError(400, "A multipart/form-data body with a `file` field is expected", "bad_request"); });
  const file = form.get("file"); if (!(file instanceof File)) throw new HttpError(400, "file missing", "bad_request");
  if (file.size > 20 * 1024 * 1024) throw new HttpError(413, "CSV too large (max 20 MB)");
  const text = await file.text(); if (!text.trim()) throw new HttpError(400, "The CSV file is empty", "bad_csv");
  const r = await importCsv(ws.id, params.id, text); await audit(user.id, "database.import", { type: "database", id: params.id }, r);
  return Response.json(r, { status: 201 });
});
