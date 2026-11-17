import { and, count, eq, gt, sql as dsql } from "drizzle-orm";
import { db, schema } from "../../db/index";
/** Failed sign-in / enrollment attempts: 10 per minute per IP, 60 per minute globally (table login_attempts). */
const PER_IP = 10, GLOBAL = 60, WINDOW_MS = 60_000;
export async function tooManyFailures(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [mine] = await db.select({ n: count() }).from(schema.loginAttempts).where(and(eq(schema.loginAttempts.ip, ip), eq(schema.loginAttempts.success, false), gt(schema.loginAttempts.createdAt, since)));
  if (mine.n >= PER_IP) return true;
  const [all] = await db.select({ n: count() }).from(schema.loginAttempts).where(and(eq(schema.loginAttempts.success, false), gt(schema.loginAttempts.createdAt, since)));
  return all.n >= GLOBAL;
}
export async function recordAttempt(ip: string, kind: string, success: boolean) {
  await db.insert(schema.loginAttempts).values({ ip, username: kind, success });
  if (Math.random() < 0.05) await db.delete(schema.loginAttempts).where(dsql`created_at < now() - interval '30 days'`);
}
