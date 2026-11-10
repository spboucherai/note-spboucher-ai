import { z } from "zod";
import { eq } from "drizzle-orm";
import { handler, parseBody } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";

/** GET → profile + preferences + a few workspace-level settings the Settings screen needs. */
export const GET = handler(async ({ user, ws }) => {
  const [u] = await db.select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, email: schema.users.email, preferences: schema.users.preferences, createdAt: schema.users.createdAt }).from(schema.users).where(eq(schema.users.id, user.id));
  const [budget] = await db.select().from(schema.settings).where(eq(schema.settings.key, "ai.daily_budget_usd"));
  return Response.json({ ...u, workspace: { id: ws.id, name: ws.name }, aiBudgetUsd: Number((budget?.value as any) ?? 20), sessionId: user.sessionId });
});
/** PATCH { displayName?, email?, preferences? } — preferences are shallow-merged into users.preferences. */
export const PATCH = handler(async ({ req, user }) => {
  const b = await parseBody(req, z.object({ displayName: z.string().trim().min(1).max(100).optional(), email: z.string().trim().email().max(200).nullable().or(z.literal("")).optional(), preferences: z.record(z.string(), z.unknown()).optional() }));
  const [cur] = await db.select({ preferences: schema.users.preferences }).from(schema.users).where(eq(schema.users.id, user.id));
  const set: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };
  if (b.displayName !== undefined) set.displayName = b.displayName;
  if (b.email !== undefined) set.email = b.email || null;
  if (b.preferences) set.preferences = { ...(cur?.preferences ?? {}), ...b.preferences };
  const [u] = await db.update(schema.users).set(set).where(eq(schema.users.id, user.id)).returning({ displayName: schema.users.displayName, email: schema.users.email, preferences: schema.users.preferences });
  await audit(user.id, "settings.update", undefined, { keys: Object.keys(b) });
  return Response.json(u);
});
