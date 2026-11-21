/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/audio/[attachmentId]/transcribe/route.ts
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
import { handler, uuid, HttpError } from "@/lib/api";
import { requestTranscription } from "@/lib/ai/transcribe";
import { audit } from "@/lib/audit";
/**
 * POST {summarize?, force?} → queue the transcription of an audio attachment (pg-boss job `transcribe`, never retried automatically).
 * 202 `{queued:true, status:"pending", …}` when a job was queued; 200 `{queued:false, …}` when a transcript already exists or is pending.
 * `summarize:true` also extracts a summary, decisions and tasks (strict JSON through the router) once the transcript exists.
 * Errors: 404 unknown attachment · 415 `not_audio` · 413 `too_large` (> 25 MB) · 503 `not_configured` | `queue_unavailable`.
 */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.safeParse(params.attachmentId); if (!id.success) throw new HttpError(400, "Invalid attachment id", "bad_id");
  const b = z.object({ summarize: z.boolean().optional(), force: z.boolean().optional() }).safeParse(await req.json().catch(() => ({}))); if (!b.success) throw new HttpError(400, "Invalid body");
  const r = await requestTranscription(ws.id, id.data, b.data);
  if (r.queued) await audit(user.id, "audio.transcribe", { type: "attachment", id: id.data }, { summarize: Boolean(b.data.summarize) });
  return Response.json(r, { status: r.queued ? 202 : 200 });
});
