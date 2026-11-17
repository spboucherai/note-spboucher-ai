/**
 * Enrollment windows. A passkey can be registered WITHOUT an existing session only through a window opened from the node shell
 * (`pnpm auth:open-enrollment`, `pnpm auth:recover`). The window is a database row: one-time 256-bit token (only its SHA-256 stored),
 * explicit short expiry, closed by the first successful registration, and force-closed whenever the web process starts.
 */
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "../../db/index";
import { ENROLL_DEFAULT_MIN, ENROLL_MAX_MIN } from "./config";
import { newToken, sha256 } from "./tokens";

export type Enrollment = typeof schema.authEnrollments.$inferSelect;
const open = () => and(isNull(schema.authEnrollments.consumedAt), isNull(schema.authEnrollments.closedReason), gt(schema.authEnrollments.expiresAt, new Date()));

export async function credentialCount(): Promise<number> { const [r] = await db.select({ n: count() }).from(schema.webauthnCredentials); return r.n; }

export async function openEnrollment(purpose: "bootstrap" | "recovery", opts: { minutes?: number; revokeExisting?: boolean } = {}) {
  const n = await credentialCount();
  if (purpose === "bootstrap" && n > 0) throw new Error("A passkey already exists: bootstrap is closed for good. Add passkeys from Settings → Security, or use `pnpm auth:recover` if every device is lost.");
  if (purpose === "recovery" && n === 0) throw new Error("No passkey exists yet: use `pnpm auth:open-enrollment` (bootstrap) instead.");
  const minutes = Math.min(ENROLL_MAX_MIN, Math.max(1, Math.floor(opts.minutes ?? ENROLL_DEFAULT_MIN)));
  await closeEnrollments("superseded");
  const token = newToken(); const expiresAt = new Date(Date.now() + minutes * 60_000);
  const [row] = await db.insert(schema.authEnrollments).values({ purpose, tokenHash: sha256(token), revokeExisting: purpose === "recovery" ? opts.revokeExisting !== false : false, expiresAt }).returning();
  return { token, expiresAt, id: row.id, minutes };
}
/** Valid, unconsumed, unexpired window for this token — or null. */
export async function findEnrollment(token: string | null | undefined): Promise<Enrollment | null> {
  if (!token || token.length < 40 || token.length > 64) return null;
  const [row] = await db.select().from(schema.authEnrollments).where(and(eq(schema.authEnrollments.tokenHash, sha256(token)), open())).limit(1);
  if (!row) return null;
  if (row.purpose === "bootstrap" && (await credentialCount()) > 0) { await closeEnrollments("already-enrolled"); return null; }
  return row;
}
/** Atomically consume the window; false when someone else used it first. */
export async function consumeEnrollment(id: string): Promise<boolean> {
  const r = await db.update(schema.authEnrollments).set({ consumedAt: new Date() }).where(and(eq(schema.authEnrollments.id, id), open())).returning({ id: schema.authEnrollments.id });
  return r.length === 1;
}
export async function closeEnrollments(reason: string): Promise<number> {
  const r = await db.update(schema.authEnrollments).set({ closedReason: reason }).where(open()).returning({ id: schema.authEnrollments.id });
  return r.length;
}
export async function openEnrollmentInfo() {
  const [row] = await db.select({ purpose: schema.authEnrollments.purpose, expiresAt: schema.authEnrollments.expiresAt }).from(schema.authEnrollments).where(open()).limit(1);
  return row ?? null;
}
