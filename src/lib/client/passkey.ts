"use client";
import { startAuthentication, startRegistration, browserSupportsWebAuthn, platformAuthenticatorIsAvailable, WebAuthnError } from "@simplewebauthn/browser";

export interface PasskeySupport { webauthn: boolean; platform: boolean; secure: boolean }
export async function passkeySupport(): Promise<PasskeySupport> {
  const secure = typeof window !== "undefined" && window.isSecureContext;
  const webauthn = secure && browserSupportsWebAuthn();
  const platform = webauthn ? await platformAuthenticatorIsAvailable().catch(() => false) : false;
  return { webauthn, platform, secure };
}
/** What the platform calls its local verification — wording only; the site never learns which method was used. */
export function localUnlockName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "Face ID";
  if (/Macintosh/.test(ua)) return "Touch ID";
  if (/Android/.test(ua)) return "fingerprint or screen lock";
  if (/Windows/.test(ua)) return "Windows Hello";
  return "your passkey";
}
async function post(url: string, json?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json ?? {}), credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error ?? `HTTP ${res.status}`) as Error & { code?: string; status?: number }; e.code = data.code; e.status = res.status; throw e; }
  return data;
}
/** Human sentence for a failed ceremony. `cancelled` = the user dismissed the sheet or it timed out (not an error worth shouting about). */
export function describePasskeyError(e: unknown): { message: string; cancelled: boolean } {
  const err = e as Error & { code?: string; name?: string };
  if (err instanceof WebAuthnError || err?.name === "NotAllowedError" || err?.name === "AbortError") {
    if (err.name === "NotAllowedError" || err.name === "AbortError" || (err as any).code === "ERROR_CEREMONY_ABORTED") return { message: "Cancelled. Nothing was changed.", cancelled: true };
    if ((err as any).code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return { message: "This device already holds a passkey for this site.", cancelled: false };
    if (err.name === "SecurityError") return { message: "This address is not allowed to use passkeys (wrong domain or not HTTPS).", cancelled: false };
    return { message: err.message || "The passkey request failed on this device.", cancelled: false };
  }
  return { message: err?.message || "Something went wrong.", cancelled: false };
}
export async function signIn(next?: string | null): Promise<{ next: string }> {
  const { options } = await post("/api/auth/login/options");
  const response = await startAuthentication({ optionsJSON: options });
  return post("/api/auth/login/verify", { response, next: next ?? undefined });
}
export async function stepUp(): Promise<void> {
  const { options } = await post("/api/auth/reauth/options");
  const response = await startAuthentication({ optionsJSON: options });
  await post("/api/auth/reauth/verify", { response });
}
export async function addPasskey(label: string): Promise<{ label: string }> {
  const { options } = await post("/api/auth/passkeys/options");
  const response = await startRegistration({ optionsJSON: options });
  return post("/api/auth/passkeys/verify", { response, label });
}
export async function enrollOptions(token: string) { return post("/api/auth/enroll/options", { token }); }
export async function enrollFinish(token: string, options: any, label: string) {
  const response = await startRegistration({ optionsJSON: options });
  return post("/api/auth/enroll/verify", { token, response, label });
}
/** Run `fn`; when the server answers `reauth_required`, ask for the passkey once and run it again. */
export async function withFreshAuth<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e: any) { if (e?.code !== "reauth_required") throw e; await stepUp(); return fn(); }
}
