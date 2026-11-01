"use client";
export async function api<T = any>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, { ...rest, headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) }, body: json !== undefined ? JSON.stringify(json) : rest.body, credentials: "same-origin" });
  if (res.status === 401) { if (typeof window !== "undefined") window.location.href = `/login?next=${encodeURIComponent(location.pathname)}`; throw new Error("Unauthenticated"); }
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body as T;
}
/** Consume a server-sent events stream (data: JSON lines, [DONE] terminator). */
export async function sse(url: string, json: unknown, onEvent: (ev: any) => void, signal?: AbortSignal) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json), signal, credentials: "same-origin" });
  if (res.status === 401) { window.location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
  if (!res.ok || !res.body) { let msg = `HTTP ${res.status}`; try { msg = (await res.json()).error ?? msg; } catch {} onEvent({ type: "error", message: msg }); return; }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2); if (!line.startsWith("data: ")) continue; const data = line.slice(6); if (data === "[DONE]") return; try { onEvent(JSON.parse(data)); } catch {} }
  }
}
