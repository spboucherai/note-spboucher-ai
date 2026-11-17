import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { handler, uuid, HttpError, requireFresh } from "@/lib/api";
import { revokeSession } from "@/lib/auth/sessions";
import { audit } from "@/lib/audit";
/** DELETE → revoke one session. Another device needs a fresh passkey verification; the current one is the same as "Lock this device". */
export const DELETE = handler(async ({ user, params }) => {
  const id = uuid.parse(params.id);
  if (id !== user.sessionId) requireFresh(user);
  const [s] = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, user.id)));
  if (!s) throw new HttpError(404, "Session not found");
  await revokeSession(id, "revoked-by-owner");
  await audit(user.id, "auth.session_revoked", { type: "session", id });
  return Response.json({ ok: true, current: id === user.sessionId });
});
