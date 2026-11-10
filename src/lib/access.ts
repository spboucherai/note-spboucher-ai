/**
 * Access gate (single owner, no accounts).
 * Two ways in, both ending with the same long-lived cookie:
 *   1. the shared password on the gate page (argon2id hash in ACCESS_PASSWORD_HASH, base64url-encoded PHC string), POST /api/gate;
 *   2. the bookmark URL /unlock/<ACCESS_KEY> (or ?k=<ACCESS_KEY> on any path).
 * The cookie value is HMAC-SHA256(ACCESS_KEY, "note-access-v1|" + ACCESS_PASSWORD_HASH): rotating either secret revokes every device.
 * Web Crypto only, so this file runs in the proxy and in route handlers alike.
 */
export const ACCESS_COOKIE = process.env.NODE_ENV === "production" ? "__Host-note_access" : "note_access";
export const ACCESS_MAX_AGE = 400 * 86400; // browsers cap cookie lifetime at 400 days
export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: ACCESS_MAX_AGE };

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let memo: { k: string; h: string; token: string } | null = null;

/** Expected cookie value, or null when the gate is not configured (then nobody gets in). */
export async function accessToken(): Promise<string | null> {
  const k = process.env.ACCESS_KEY ?? ""; const h = process.env.ACCESS_PASSWORD_HASH ?? "";
  if (k.length < 32) return null;
  if (memo && memo.k === k && memo.h === h) return memo.token;
  const key = await crypto.subtle.importKey("raw", enc.encode(k), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const token = b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`note-access-v1|${h}`)));
  memo = { k, h, token }; return token;
}
/** Constant-time comparison of two strings (hashes both first so lengths never leak). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i]; return d === 0;
}
export async function hasAccess(cookie: string | undefined | null): Promise<boolean> {
  const t = await accessToken(); return Boolean(t && cookie && (await safeEqual(cookie, t)));
}
export async function isAccessKey(candidate: string): Promise<boolean> {
  const k = process.env.ACCESS_KEY ?? ""; return k.length >= 32 && (await safeEqual(candidate, k));
}
/** Only same-site relative paths are accepted as post-unlock destinations. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/gate") || next.startsWith("/api/") || next.startsWith("/unlock")) return "/";
  return next;
}
export function clientIp(h: Headers) { return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "0.0.0.0").trim(); }
/** Absolute URL for redirects (NextResponse rejects relative Location headers); APP_URL wins over the internal request URL. */
export function absolute(path: string, reqUrl: string): string { return new URL(path, process.env.APP_URL || reqUrl).toString(); }
