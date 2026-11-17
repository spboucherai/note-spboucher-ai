import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { CHALLENGE_COOKIE, CHALLENGE_TTL_MS, cookieBase, configProblems } from "./config";
import { assertSameOrigin, HttpError, jsonError } from "./guard";
import { CeremonyError } from "./webauthn";
import { log, newRequestId } from "@/lib/log";

/** Wrapper for the unauthenticated ceremony routes (sign-in, enrollment): same-origin, config sanity, error mapping, one log line. No bodies logged. */
export function publicRoute(name: string, fn: (req: Request, requestId: string) => Promise<Response>) {
  return async (req: Request) => {
    const requestId = newRequestId(); const t0 = Date.now(); let res: Response;
    try {
      await assertSameOrigin();
      const problems = configProblems(); if (problems.length) throw new HttpError(503, "Passkeys are not configured on this server.", "not_configured");
      res = await fn(req, requestId);
    } catch (e) { res = ceremonyError(e, requestId); }
    res.headers.set("x-request-id", requestId); res.headers.set("cache-control", "no-store");
    log.info({ rid: requestId, route: name, status: res.status, ms: Date.now() - t0 }, "auth");
    return res;
  };
}
export function ceremonyError(e: unknown, requestId?: string): Response {
  if (e instanceof CeremonyError) {
    // Verification details stay in the server log; the browser gets a stable code and a neutral sentence.
    if (e.code === "verification_failed") log.warn({ rid: requestId, code: e.code, detail: e.message.slice(0, 200) }, "webauthn verification failed");
    const msg = e.code === "verification_failed" || e.code === "unknown_credential" ? "This passkey could not be verified." : e.message;
    return Response.json({ error: msg, code: e.code }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (!(e instanceof HttpError)) log.error({ rid: requestId, err: (e as Error)?.name, detail: String((e as Error)?.message ?? e).slice(0, 300) }, "auth route error");
  return jsonError(e, requestId);
}
export const challengeCookie = (id: string) => `${CHALLENGE_COOKIE}=${id}; Path=/; Max-Age=${Math.floor(CHALLENGE_TTL_MS / 1000)}; HttpOnly; SameSite=Strict${cookieBase.secure ? "; Secure" : ""}`;
export const clearChallengeCookie = () => `${CHALLENGE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${cookieBase.secure ? "; Secure" : ""}`;
export async function readChallengeCookie() { return (await cookies()).get(CHALLENGE_COOKIE)?.value ?? null; }
export function json(body: unknown, init: { status?: number; cookies?: string[] } = {}) {
  const h = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of init.cookies ?? []) h.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: h });
}
/** Shape check only — the cryptographic verification is done by SimpleWebAuthn. Bounded sizes so a forged body cannot be huge. */
const b64 = z.string().min(1).max(8192).regex(/^[A-Za-z0-9_-]+$/);
export const authenticationResponseSchema = z.object({ id: b64, rawId: b64, type: z.literal("public-key"), response: z.object({ clientDataJSON: b64, authenticatorData: b64, signature: b64, userHandle: b64.optional().nullable() }).passthrough(), clientExtensionResults: z.record(z.string(), z.unknown()).optional().default({}), authenticatorAttachment: z.string().max(32).optional().nullable() }).passthrough();
export const registrationResponseSchema = z.object({ id: b64, rawId: b64, type: z.literal("public-key"), response: z.object({ clientDataJSON: b64, attestationObject: z.string().min(1).max(65536).regex(/^[A-Za-z0-9_-]+$/), transports: z.array(z.string().max(32)).max(8).optional() }).passthrough(), clientExtensionResults: z.record(z.string(), z.unknown()).optional().default({}), authenticatorAttachment: z.string().max(32).optional().nullable() }).passthrough();
export async function body<T extends z.ZodTypeAny>(req: Request, s: T): Promise<z.infer<T>> {
  const j = await req.json().catch(() => { throw new HttpError(400, "Invalid JSON body"); });
  const r = s.safeParse(j); if (!r.success) throw new HttpError(400, "Malformed request", "bad_request");
  return r.data;
}
