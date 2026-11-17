import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
/** 256-bit random token, base64url. Only its SHA-256 is ever stored. */
export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export function safeEqualHex(a: string, b: string) { const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex"); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); }
/** Only same-site relative paths are accepted as post-login destinations. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login") || next.startsWith("/enroll") || next.startsWith("/api/")) return "/";
  return next;
}
export function clientIp(h: Headers) { return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "0.0.0.0").trim(); }
/** Short human label for a session/passkey from the User-Agent (no fingerprinting, just "Safari · iPhone"). */
export function deviceLabel(ua: string | null | undefined): string {
  const s = ua ?? ""; if (!s) return "Unknown device";
  const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Macintosh|Mac OS X/.test(s) ? "Mac" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "Device";
  const br = /Edg\//.test(s) ? "Edge" : /CriOS|Chrome\//.test(s) ? "Chrome" : /FxiOS|Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "Browser";
  return `${br} · ${os}`;
}
