import { db, schema } from "@/db";
export async function audit(userId: string | null, action: string, target?: { type: string; id: string }, detail: Record<string, unknown> = {}, ip?: string) {
  try { await db.insert(schema.auditLogs).values({ userId, action, targetType: target?.type, targetId: target?.id, detail, ip }); } catch (e) { console.error("audit failed", e); }
}
