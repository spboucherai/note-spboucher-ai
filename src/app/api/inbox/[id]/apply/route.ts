import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { applySuggestions, SECTIONS } from "@/lib/ai/inbox";
import { audit } from "@/lib/audit";
const body = z.object({
  title: z.string().trim().min(1).max(300).optional(), tags: z.array(z.string().max(60)).max(10).optional(),
  destination: z.object({ section: z.enum(SECTIONS).optional(), parentId: uuid.nullable().optional() }).optional(),
  relations: z.array(z.object({ pageId: uuid, reason: z.string().max(300).optional() })).max(10).optional(), summary: z.string().trim().min(1).max(1000).optional(),
}).strict();
/**
 * POST → apply the subset of AI suggestions the owner chose (SPEC §4.12). Only the keys present in the body are applied, with the values
 * sent (the owner may have edited them). Journaled in `inbox_actions`: the answer carries `actionId`, which POST /api/inbox/undo reverses.
 * The capture leaves the inbox only when `destination` is part of the choice.
 */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.safeParse(params.id); if (!id.success) throw new HttpError(400, "Invalid id", "bad_id");
  const b = await parseBody(req, body);
  const r = await applySuggestions(ws.id, id.data, b);
  await audit(user.id, "inbox.suggestions_apply", { type: "page", id: id.data }, { actionId: r.actionId, applied: r.applied });
  return Response.json(r);
});
