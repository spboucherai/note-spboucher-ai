import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getSession, type SessionUser } from "./session";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { cache } from "react";

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

/** For route handlers: 401 without the access cookie. Also enforces same-origin on mutating requests. */
export async function requireUser(req?: Request): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new HttpError(401, "Locked");
  if (req && !["GET", "HEAD", "OPTIONS"].includes(req.method)) await assertSameOrigin();
  return s;
}
/** For server components/pages (the proxy already gates; this is defence in depth). */
export async function requireUserPage(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) notFound();
  return s;
}
export async function assertSameOrigin() {
  const h = await headers();
  const sfs = h.get("sec-fetch-site");
  if (sfs && sfs !== "same-origin" && sfs !== "none") throw new HttpError(403, "Cross-site request blocked");
  const origin = h.get("origin");
  if (origin) {
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const allowed = new Set([process.env.APP_URL?.replace(/\/$/, ""), `https://${host}`, `http://${host}`].filter(Boolean));
    if (!allowed.has(origin)) throw new HttpError(403, "Origin mismatch");
  }
}
/** The single owner workspace (created at bootstrap). */
export const getWorkspace = cache(async (userId: string) => {
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.ownerId, userId)).limit(1);
  if (!ws) throw new HttpError(500, "Workspace missing — run pnpm bootstrap");
  return ws;
});
export function jsonError(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
