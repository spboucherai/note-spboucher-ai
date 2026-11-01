import { z } from "zod";
import { eq } from "drizzle-orm";
import { handler, parseBody, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { verifyPassword, hashPassword, passwordPolicy } from "@/lib/auth/password";
import { revokeAllSessions, clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/ratelimit";
import { audit } from "@/lib/audit";
import { headers } from "next/headers";

/** POST { current, next } → change password (current password check), then revoke every other session. */
export const POST = handler(async ({ req, user }) => {
  const ip = clientIp(await headers());
  if (!rateLimit(`pw:${user.id}`, 5, 15 * 60_000)) throw new HttpError(429, "Too many attempts, try again later");
  const b = await parseBody(req, z.object({ current: z.string().min(1), next: z.string().min(1).max(200) }));
  const policy = passwordPolicy(b.next); if (policy) throw new HttpError(400, policy);
  if (b.next === b.current) throw new HttpError(400, "New password must differ from the current one.");
  const [u] = await db.select({ passwordHash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, user.id));
  if (!u || !(await verifyPassword(u.passwordHash, b.current))) { await audit(user.id, "auth.password_change_failed", undefined, {}, ip); throw new HttpError(400, "Current password is incorrect."); }
  await db.update(schema.users).set({ passwordHash: await hashPassword(b.next), updatedAt: new Date() }).where(eq(schema.users.id, user.id));
  await revokeAllSessions(user.id, user.sessionId);
  await audit(user.id, "auth.password_changed", undefined, { revokedOthers: true }, ip);
  return Response.json({ ok: true });
});
