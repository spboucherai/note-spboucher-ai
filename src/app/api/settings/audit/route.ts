import { desc, eq } from "drizzle-orm";
import { handler } from "@/lib/api";
import { db, schema } from "@/db";
/** GET ?limit=50 → most recent audit log entries of the current user. */
export const GET = handler(async ({ req, user }) => {
  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 50)));
  const rows = await db.select({ id: schema.auditLogs.id, action: schema.auditLogs.action, targetType: schema.auditLogs.targetType, targetId: schema.auditLogs.targetId, detail: schema.auditLogs.detail, ip: schema.auditLogs.ip, createdAt: schema.auditLogs.createdAt }).from(schema.auditLogs).where(eq(schema.auditLogs.userId, user.id)).orderBy(desc(schema.auditLogs.createdAt)).limit(limit);
  return Response.json(rows);
});
