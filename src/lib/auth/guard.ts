import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, type SessionUser } from "./session";
import { allowedOrigins } from "./config";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { cache } from "react";

import { HttpError } from "@/lib/errors";
export { HttpError };

/** For route handlers: 401 without a valid session. Also enforces same-origin on mutating requests. */
export async function requireUser(req?: Request): Promise<SessionUser> {
  if (req && !["GET", "HEAD", "OPTIONS"].includes(req.method)) await assertSameOrigin();
  const s = await getSession();
  if (!s) throw new HttpError(401, "Sign-in required", "unauthenticated");
  return s;
}
/** Sensitive actions: the passkey must have been verified in the last 5 minutes (step-up). The client reacts to code `reauth_required`. */
export function requireFresh(user: SessionUser) {
  if (!user.fresh) throw new HttpError(403, "Confirm with your passkey to continue", "reauth_required");
}
/** For server components/pages (the proxy already gates; this is the authoritative check next to the data). */
export async function requireUserPage(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
/**
 * CSRF: every mutating request must come from one of our exact origins. Browsers always send Origin on cross-origin and on same-origin
 * POST/PATCH/PUT/DELETE fetches; Sec-Fetch-Site is checked too when present. A request with neither header is refused.
 */
export async function assertSameOrigin() {
  const h = await headers();
  const sfs = h.get("sec-fetch-site");
  if (sfs && sfs !== "same-origin") throw new HttpError(403, "Cross-site request blocked", "csrf");
  const origin = h.get("origin");
  if (origin) { if (!allowedOrigins().includes(origin)) throw new HttpError(403, "Origin mismatch", "csrf"); return; }
  if (sfs !== "same-origin") throw new HttpError(403, "Missing Origin header", "csrf");
}
/** The single owner workspace (created at bootstrap). */
export const getWorkspace = cache(async (userId: string) => {
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.ownerId, userId)).limit(1);
  if (!ws) throw new HttpError(500, "Workspace missing — run pnpm bootstrap");
  return ws;
});
export function jsonError(e: unknown, requestId?: string) {
  const h: Record<string, string> = { "cache-control": "no-store" }; if (requestId) h["x-request-id"] = requestId;
  if (e instanceof HttpError) return Response.json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.extra ?? {}) }, { status: e.status, headers: h });
  return Response.json({ error: "Internal error", ...(requestId ? { requestId } : {}) }, { status: 500, headers: h });
}
