import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { resolveConflict } from "@/lib/pages/service";
import { assertDoc } from "@/lib/editor/validate";
import { audit } from "@/lib/audit";
/** POST { choice: mine|theirs|both, serverVersion, mine: { title?, content? } } → settles a save conflict; both copies stay in the history. */
export const POST = handler(async ({ req, ws, params, user }) => {
  const id = uuid.parse(params.id);
  const b = await parseBody(req, z.object({ choice: z.enum(["mine", "theirs", "both"]), serverVersion: z.number().int().min(0), mine: z.object({ title: z.string().max(500).optional(), content: z.any().optional() }) }));
  if (b.mine.content !== undefined) assertDoc(b.mine.content);
  const r = await resolveConflict(ws.id, id, b);
  await audit(user.id, "page.conflict_resolved", { type: "page", id }, { choice: b.choice, copyId: r.copyId });
  return Response.json({ id: r.page.id, version: r.page.version, title: r.page.title, content: r.page.content, properties: r.page.properties, updatedAt: r.page.updatedAt, copyId: r.copyId });
});
