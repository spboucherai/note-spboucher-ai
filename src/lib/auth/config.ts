/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/auth/config.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
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

/**
 * Passkey / session configuration (v2). Single owner, WebAuthn only.
 * Env: APP_URL (public origin, required), AUTH_RP_ID (defaults to the APP_URL hostname), AUTH_EXTRA_ORIGINS (comma list, development only).
 * The pre-2026-11 variables WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN / SESSION_SECRET / ACCESS_KEY / ACCESS_PASSWORD_HASH are NOT read anywhere.
 */
const prod = process.env.NODE_ENV === "production";
export const SESSION_COOKIE = prod ? "__Host-note_session" : "note_session";
export const CHALLENGE_COOKIE = prod ? "__Host-note_wa" : "note_wa";
export const RP_NAME = "Note SPBoucher AI";
/** Sliding idle lifetime and hard cap of a session. */
export const SESSION_IDLE_MS = 30 * 86_400_000;
export const SESSION_ABSOLUTE_MS = 90 * 86_400_000;
/** A passkey verification is "fresh" for sensitive actions during this window. */
export const FRESH_MS = 5 * 60_000;
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const ROTATION_GRACE_MS = 60_000;
export const ENROLL_DEFAULT_MIN = 15;
export const ENROLL_MAX_MIN = 60;

export function appOrigin(): string {
  const raw = process.env.APP_URL;
  if (!raw) throw new Error("APP_URL is not set");
  return new URL(raw).origin;
}
/** Exact origins accepted for WebAuthn ceremonies and for mutating requests. */
export function allowedOrigins(): string[] {
  const out = [appOrigin()];
  if (!prod) for (const o of (process.env.AUTH_EXTRA_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) { try { out.push(new URL(o).origin); } catch { /* ignored */ } }
  return [...new Set(out)];
}
/** RP ID: the registrable host the passkeys are scoped to. Must equal or be a parent domain of the origin host. */
export function rpId(): string {
  const host = new URL(appOrigin()).hostname;
  const id = (process.env.AUTH_RP_ID ?? "").trim() || host;
  if (id !== host && !host.endsWith(`.${id}`)) throw new Error(`AUTH_RP_ID "${id}" is not a suffix of the APP_URL host "${host}"`);
  return id;
}
/** Problems that make passkeys impossible; surfaced by /api/health (as a boolean) and by the login page. */
export function configProblems(): string[] {
  const p: string[] = [];
  try { const u = new URL(appOrigin()); if (u.protocol !== "https:" && u.hostname !== "localhost") p.push("APP_URL must be https (passkeys need a secure context; only http://localhost is exempt)."); } catch (e) { p.push((e as Error).message); return p; }
  try { rpId(); } catch (e) { p.push((e as Error).message); }
  return p;
}
/** Legacy variables still present in the environment (names only, never values). */
export function legacyEnvPresent(): string[] {
  return ["ACCESS_KEY", "ACCESS_PASSWORD_HASH", "SESSION_SECRET", "WEBAUTHN_RP_ID", "WEBAUTHN_ORIGIN", "OWNER_INITIAL_PASSWORD"].filter((k) => Boolean(process.env[k]));
}
export const cookieBase = { httpOnly: true, secure: prod, sameSite: "lax" as const, path: "/" };
