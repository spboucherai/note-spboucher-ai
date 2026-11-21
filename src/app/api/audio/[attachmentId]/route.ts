/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/audio/[attachmentId]/route.ts
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

import { handler, uuid, HttpError } from "@/lib/api";
import { getTranscript } from "@/lib/ai/transcribe";
/**
 * GET → state of the transcription of one audio attachment (SPEC §4.13):
 * `{attachmentId, status: none|pending|done|failed, transcript:[{t,text}], text, engine, model, language, duration, segments, summary?, error}`.
 * Poll while `pending` (2–3 s). The client writes the transcript into the `audio` node itself.
 */
export const GET = handler(async ({ ws, params }) => {
  const id = uuid.safeParse(params.attachmentId); if (!id.success) throw new HttpError(400, "Invalid attachment id", "bad_id");
  return Response.json(await getTranscript(ws.id, id.data));
});
