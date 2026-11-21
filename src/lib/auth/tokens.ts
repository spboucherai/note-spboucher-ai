/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/auth/tokens.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-18
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

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
  const native = s.match(/^SPNotes\/[\d.]+ \((Macintosh|iPhone|iPad)/); if (native) return `SP Notes · ${native[1] === "Macintosh" ? "Mac" : native[1]}`;
  const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Macintosh|Mac OS X/.test(s) ? "Mac" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "Device";
  const br = /Edg\//.test(s) ? "Edge" : /CriOS|Chrome\//.test(s) ? "Chrome" : /FxiOS|Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "Browser";
  return `${br} · ${os}`;
}
