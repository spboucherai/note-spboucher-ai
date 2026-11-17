"use client";
import { api, ApiError, newKey } from "./api";
import { deleteOutbox, listOutbox, putOutbox, type OutboxItem } from "./offline";
import { uploadFile } from "@/components/editor/Editor";

/**
 * Outbox for quick captures. A capture is written to the device first, then sent. Its id IS the Idempotency-Key, and uploaded attachment ids
 * are recorded as they succeed, so a replay after a timeout, a reload or a day offline creates exactly one note and no duplicate file.
 */
let running: Promise<void> | null = null;
const changed = () => window.dispatchEvent(new CustomEvent("note:outbox-changed"));

export async function enqueueCapture(body: OutboxItem["body"], files: File[] = []): Promise<{ sent: boolean; pageId?: string; error?: string }> {
  const item: OutboxItem = { id: newKey(), kind: "capture", body, files: files.length ? files : undefined, uploadedIds: [], createdAt: Date.now(), attempts: 0 };
  let stored = true; try { await putOutbox(item); } catch { stored = false; } // no IndexedDB (private mode): send directly, report failures to the caller
  changed();
  const r = await send(item);
  if (r.sent || !stored) return r;
  return { sent: false, error: r.error };
}
async function send(item: OutboxItem): Promise<{ sent: boolean; pageId?: string; error?: string; fatal?: boolean }> {
  try {
    const ids = [...(item.uploadedIds ?? [])];
    for (const f of (item.files ?? []).slice(ids.length)) { const up = await uploadFile(f); ids.push(up.id); item.uploadedIds = ids; await putOutbox(item).catch(() => {}); }
    const r = await api<{ id: string }>("/api/capture", { method: "POST", json: { ...item.body, ...(ids.length ? { attachmentIds: ids } : {}) }, idempotencyKey: item.id, timeoutMs: 20_000 });
    await deleteOutbox(item.id); changed(); window.dispatchEvent(new CustomEvent("note:captured", { detail: r }));
    return { sent: true, pageId: r.id };
  } catch (e) {
    const err = e as ApiError; const fatal = err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 409 && err.status !== 429;
    item.attempts += 1; item.lastError = err.message; await putOutbox(item).catch(() => {}); changed();
    return { sent: false, error: err.message, fatal };
  }
}
/** Send everything that is waiting, oldest first, one at a time. Safe to call as often as you like. */
export function flushOutbox(): Promise<void> {
  if (running) return running;
  running = (async () => {
    for (const item of await listOutbox()) { if (!navigator.onLine) break; const r = await send(item); if (!r.sent && !r.fatal) break; /* network trouble: stop, keep order */ }
  })().finally(() => { running = null; });
  return running;
}
export async function outboxState() { const items = await listOutbox(); return { waiting: items.length, failed: items.filter((i) => i.attempts > 0 && i.lastError).length, items }; }
export async function discardOutboxItem(id: string) { await deleteOutbox(id); changed(); }
