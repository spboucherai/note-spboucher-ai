import { z } from "zod";
import { and, eq, isNotNull, lt, sql as dsql } from "drizzle-orm";
import { handler, parseBody, requireFresh } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { purgePages } from "@/lib/pages/service";

const AUTO_PURGE_DAYS = 30;
async function purge(wsId: string, olderThanDays: number | null) {
  const where = [eq(schema.pages.workspaceId, wsId), isNotNull(schema.pages.deletedAt)];
  if (olderThanDays != null) where.push(lt(schema.pages.deletedAt, new Date(Date.now() - olderThanDays * 864e5)));
  // through the page service: attachments of the purged pages (rows + files) and index rows go with them, each purge is journaled (3.0)
  const rows = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(...where));
  return (await purgePages(wsId, rows.map((r) => r.id))).purged;
}
/** DELETE ?olderThanDays=N → purge trashed pages older than N days (all trashed pages when omitted). */
export const DELETE = handler(async ({ req, ws, user }) => {
  requireFresh(user); // permanent deletion
  const q = new URL(req.url).searchParams.get("olderThanDays"); const days = q == null ? null : Math.max(0, Number(q) || 0);
  const n = await purge(ws.id, days);
  await audit(user.id, "trash.empty", undefined, { purged: n, olderThanDays: days });
  return Response.json({ ok: true, purged: n });
});
/** POST { action: "purge-old", days? } → purge items trashed more than `days` (default 30) ago. */
export const POST = handler(async ({ req, ws, user }) => {
  requireFresh(user); // permanent deletion — never triggered by opening the trash
  const b = await parseBody(req, z.object({ action: z.literal("purge-old"), days: z.number().int().min(1).max(365).optional() }));
  const n = await purge(ws.id, b.days ?? AUTO_PURGE_DAYS);
  if (n) await audit(user.id, "trash.auto_purge", undefined, { purged: n, days: b.days ?? AUTO_PURGE_DAYS });
  const [{ count }] = await db.select({ count: dsql<number>`count(*)` }).from(schema.pages).where(and(eq(schema.pages.workspaceId, ws.id), isNotNull(schema.pages.deletedAt)));
  return Response.json({ ok: true, purged: n, remaining: Number(count), autoPurgeDays: b.days ?? AUTO_PURGE_DAYS });
});
