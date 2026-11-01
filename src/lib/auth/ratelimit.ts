import { and, eq, gt, count, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/db";

/** Login limiter: max 5 failures per 15 min per IP, and per username; lockout grows with repeated failures. */
export async function loginAllowed(ip: string, username: string): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const since = new Date(Date.now() - 15 * 60_000);
  const [byIp] = await db.select({ n: count() }).from(schema.loginAttempts).where(and(eq(schema.loginAttempts.ip, ip), eq(schema.loginAttempts.success, false), gt(schema.loginAttempts.createdAt, since)));
  const [byUser] = await db.select({ n: count() }).from(schema.loginAttempts).where(and(eq(schema.loginAttempts.username, username), eq(schema.loginAttempts.success, false), gt(schema.loginAttempts.createdAt, since)));
  const failures = Math.max(byIp.n, byUser.n);
  if (failures < 5) return { ok: true };
  const lockMin = Math.min(60, 2 ** (failures - 4)); // 2,4,8,...,60 minutes
  return { ok: false, retryAfterSec: lockMin * 60 };
}
export async function recordAttempt(ip: string, username: string | null, success: boolean) {
  await db.insert(schema.loginAttempts).values({ ip, username, success });
  if (Math.random() < 0.05) await db.delete(schema.loginAttempts).where(dsql`created_at < now() - interval '2 days'`);
}

/** Generic in-memory limiter for API routes (per key, sliding window). */
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now(); const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now); buckets.set(key, arr); return true;
}
