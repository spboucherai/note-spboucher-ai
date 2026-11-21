/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/api/capture/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
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
import { handler, parseBody, uuid } from "@/lib/api";
import { capture } from "@/lib/inbox/service";
import { audit } from "@/lib/audit";
/**
 * POST { kind, text?, url?, attachmentIds? } → one new page in the capture inbox. No workspace, section or template to choose.
 * Kinds: note | tasks | link | photo | file | audio, and since 3.0 (SPEC §4.12) screenshot | selection | document. `idea` is accepted as an
 * alias of `note` (stored as `note`, icon 💡). `selection`: `text` is the selected text, `url` its source (`/p/<id>#block-<id>` or http(s)).
 * Always sent with an Idempotency-Key (the offline outbox reuses the same key on replay), so a retry after a timeout cannot create a duplicate.
 */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ kind: z.enum(["note", "tasks", "link", "photo", "file", "audio", "screenshot", "selection", "document", "idea"]), text: z.string().max(100_000).optional(), url: z.string().max(2000).optional(), attachmentIds: z.array(uuid).max(20).optional() }));
  const p = await capture(ws.id, b);
  await audit(user.id, "inbox.capture", { type: "page", id: p.id }, { kind: b.kind, attachments: b.attachmentIds?.length ?? 0 });
  return Response.json({ id: p.id, title: p.title, kind: p.captureKind ?? b.kind, inboxAt: p.inboxAt }, { status: 201 });
});
