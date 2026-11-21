/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/client/api.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

"use client";
export class ApiError extends Error { constructor(message: string, public status: number, public code?: string, public body?: any) { super(message); } }
export const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
let redirecting = false;
/** Session ended (expired, revoked, locked elsewhere): go to the sign-in page and come back to the same screen afterwards. Local drafts stay on the device. */
export function toLogin() {
  if (typeof window === "undefined" || redirecting) return; redirecting = true;
  const next = window.location.pathname + window.location.search + window.location.hash;
  window.location.assign(`/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`);
}
/**
 * JSON fetch helper. Every mutating call carries an Idempotency-Key (generated here, or supplied by the offline outbox so a replay
 * after a timeout cannot create a second page/row) and an x-request-id for correlation with the server log.
 */
export async function api<T = any>(url: string, init: RequestInit & { json?: unknown; idempotencyKey?: string | false; timeoutMs?: number } = {}): Promise<T> {
  const { json, idempotencyKey, timeoutMs, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase(); const mutating = method !== "GET" && method !== "HEAD";
  const headers: Record<string, string> = { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...((rest.headers as Record<string, string>) ?? {}) };
  if (mutating && idempotencyKey !== false && method === "POST") headers["idempotency-key"] = idempotencyKey || newKey();
  else if (mutating && typeof idempotencyKey === "string") headers["idempotency-key"] = idempotencyKey;
  headers["x-request-id"] = newKey();
  const ctl = timeoutMs ? new AbortController() : null; const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  let res: Response;
  try { res = await fetch(url, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body, credentials: "same-origin", signal: ctl?.signal ?? rest.signal }); }
  catch (e: any) { throw new ApiError(e?.name === "AbortError" ? "Request timed out" : "Network unreachable", 0, "network"); }
  finally { if (timer) clearTimeout(timer); }
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await res.json().catch(() => null) : await res.text();
  if (res.status === 401) { toLogin(); throw new ApiError("Sign-in required", 401, "unauthenticated"); }
  if (!res.ok) throw new ApiError((body && body.error) || `HTTP ${res.status}`, res.status, body?.code, body);
  return body as T;
}
/** Consume a server-sent events stream (data: JSON lines, [DONE] terminator). */
export async function sse(url: string, json: unknown, onEvent: (ev: any) => void, signal?: AbortSignal) {
  let res: Response;
  try { res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-request-id": newKey() }, body: JSON.stringify(json), signal, credentials: "same-origin" }); }
  catch (e: any) { if (e?.name !== "AbortError") onEvent({ type: "error", message: "Network unreachable — nothing was sent twice; try again.", code: "network" }); return; }
  if (res.status === 401) { toLogin(); return; }
  if (!res.ok || !res.body) { let msg = `HTTP ${res.status}`; let code: string | undefined; try { const j = await res.json(); msg = j.error ?? msg; code = j.code; } catch {} onEvent({ type: "error", message: msg, code }); return; }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2); if (!line.startsWith("data: ")) continue; const data = line.slice(6); if (data === "[DONE]") return; try { onEvent(JSON.parse(data)); } catch {} }
    }
  } catch (e: any) { if (e?.name !== "AbortError") onEvent({ type: "error", message: "Connection lost while the answer was streaming.", code: "network" }); }
}
