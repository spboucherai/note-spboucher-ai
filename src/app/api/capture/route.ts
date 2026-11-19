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
