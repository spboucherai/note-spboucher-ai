import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { backlinkStats, unlinkedMentions, linkMention, dismissMention } from "@/lib/graph/backlinks";
import { audit } from "@/lib/audit";

/** GET ?q=&pageId= → { pages, mentions } */
export const GET = handler(async ({ req, ws }) => {
  const u = new URL(req.url).searchParams; const pid = uuid.safeParse(u.get("pageId"));
  const [pages, mentions] = await Promise.all([backlinkStats(ws.id, { q: u.get("q") ?? "" }), unlinkedMentions(ws.id, { pageId: pid.success ? pid.data : null })]);
  return Response.json({ pages, mentions }, { headers: { "cache-control": "private, no-store" } });
});

/** POST { action: "link" | "dismiss" | "undismiss", fromId, toId } */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ action: z.enum(["link", "dismiss", "undismiss"]), fromId: uuid, toId: uuid }));
  if (b.action === "link") { await linkMention(ws.id, b.fromId, b.toId); await audit(user.id, "backlinks.link", { type: "page", id: b.fromId }, { to: b.toId }); return Response.json({ ok: true }); }
  await dismissMention(b.fromId, b.toId, b.action === "undismiss");
  return Response.json({ ok: true });
});
