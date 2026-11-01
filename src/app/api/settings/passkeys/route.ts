import { desc, eq } from "drizzle-orm";
import { handler } from "@/lib/api";
import { db, schema } from "@/db";
/** GET → the current user's registered passkeys (register/delete go through /api/auth/passkey). */
export const GET = handler(async ({ user }) => {
  const rows = await db.select({ id: schema.webauthnCredentials.id, label: schema.webauthnCredentials.label, deviceType: schema.webauthnCredentials.deviceType, backedUp: schema.webauthnCredentials.backedUp, transports: schema.webauthnCredentials.transports, createdAt: schema.webauthnCredentials.createdAt, lastUsedAt: schema.webauthnCredentials.lastUsedAt }).from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, user.id)).orderBy(desc(schema.webauthnCredentials.createdAt));
  return Response.json(rows);
});
