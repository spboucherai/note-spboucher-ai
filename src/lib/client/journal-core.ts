/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/client/journal-core.ts
 * Description      : pure logic of the offline mutation journal (no IndexedDB,
 *                    no fetch, no DOM) — what request an entry becomes, how a
 *                    new entry is merged into the queue (coalescing +
 *                    de-duplication), how a server answer is classified, and
 *                    the bounds of the offline image queue. Unit-tested in
 *                    tests/unit/next-p-offline.test.ts; the browser side is
 *                    src/lib/client/journal.ts.
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
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

export type JournalKind = "page.create" | "page.update" | "page.trash" | "page.restore" | "page.tags" | "task.create" | "task.update" | "task.delete" | "upload";
export interface JournalEntry {
  /** Order of replay (IndexedDB auto-increment). */
  seq?: number;
  /** Stable id of the mutation — sent as the Idempotency-Key on every attempt. */
  id: string;
  kind: JournalKind;
  /** Client-chosen uuid of the page / task / attachment the mutation is about. */
  entityId: string;
  body: Record<string, unknown>;
  createdAt: number; attempts: number; lastError?: string;
  /** pending = will be replayed; failed = the server refused it (4xx): kept for the owner to retry or discard, later entries go on. */
  state: "pending" | "failed";
}
/** One image added offline: 10 MB. All queued images together: 100 MB. Above the bound the upload is refused with a clear message. */
export const IMAGE_MAX = 10 * 1024 * 1024, BLOBS_MAX = 100 * 1024 * 1024;
export const canQueueImage = (f: { type: string; size: number }, queuedBytes: number): { ok: true } | { ok: false; reason: string } =>
  !f.type.startsWith("image/") ? { ok: false, reason: "Only images can be added offline; other files need a connection." }
    : f.size > IMAGE_MAX ? { ok: false, reason: `This image is too large to keep offline (${(f.size / 1048576).toFixed(1)} MB; limit 10 MB).` }
      : queuedBytes + f.size > BLOBS_MAX ? { ok: false, reason: "The offline image queue is full (100 MB). Reconnect to send what is waiting." } : { ok: true };

export interface JournalRequest { method: "POST" | "PATCH" | "PUT" | "DELETE"; url: string; json?: unknown; /** multipart upload of the queued blob */ upload?: boolean }
/** The HTTP request an entry is replayed as. Creates carry the client id, so a repeat answers the stored row (never a duplicate). */
export function requestOf(e: Pick<JournalEntry, "kind" | "entityId" | "body">): JournalRequest {
  const id = e.entityId;
  switch (e.kind) {
    case "page.create": return { method: "POST", url: "/api/pages", json: { ...e.body, id } };
    case "page.update": return { method: "PATCH", url: `/api/pages/${id}`, json: e.body };
    case "page.trash": return { method: "DELETE", url: `/api/pages/${id}` };
    case "page.restore": return { method: "POST", url: `/api/pages/${id}?action=restore` };
    case "page.tags": return { method: "PUT", url: `/api/pages/${id}/tags`, json: { tags: e.body.tags ?? [] } };
    case "task.create": return { method: "POST", url: "/api/tasks", json: { ...e.body, id } };
    case "task.update": return { method: "PATCH", url: `/api/tasks/${id}`, json: e.body };
    case "task.delete": return { method: "DELETE", url: `/api/tasks/${id}` };
    case "upload": return { method: "POST", url: "/api/attachments", upload: true };
  }
}
const CREATE_PAGE_KEYS = new Set(["title", "parentId", "section", "icon"]);
const CREATE_TASK_KEYS = new Set(["title", "status", "priority", "dueAt", "project", "pageId", "blockId"]);
/**
 * Merge a new mutation into the pending queue. Returns the entry to write (`put`: an updated existing entry, or the new one) or
 * `skip` when the queue already holds it. Rules — only the LAST pending entry of the same entity may absorb the new one, so the order
 * of effects is never changed:
 *   create of an id already queued → skipped (de-duplication);
 *   update after update → one entry with the merged body; tags after tags → the newer list;
 *   update after a not-yet-sent create → folded into the create when every key is accepted by the create route;
 *   trash after restore / restore after trash → appended (the server journal keeps both).
 */
export function mergeIntoQueue(queue: JournalEntry[], next: JournalEntry): { put: JournalEntry } | { skip: true } {
  const same = queue.filter((e) => e.entityId === next.entityId && e.state === "pending");
  if ((next.kind === "page.create" || next.kind === "task.create" || next.kind === "upload") && queue.some((e) => e.entityId === next.entityId && e.kind === next.kind)) return { skip: true };
  const last = same[same.length - 1]; if (!last) return { put: next };
  const merged = (body: Record<string, unknown>): { put: JournalEntry } => ({ put: { ...last, body } });
  if (next.kind === "page.update" && last.kind === "page.update") return merged({ ...last.body, ...next.body });
  if (next.kind === "task.update" && last.kind === "task.update") return merged({ ...last.body, ...next.body });
  if (next.kind === "page.tags" && last.kind === "page.tags") return merged(next.body);
  if (next.kind === "page.update" && last.kind === "page.create" && last.attempts === 0 && Object.keys(next.body).every((k) => CREATE_PAGE_KEYS.has(k))) return merged({ ...last.body, ...next.body });
  if (next.kind === "task.update" && last.kind === "task.create" && last.attempts === 0 && Object.keys(next.body).every((k) => CREATE_TASK_KEYS.has(k))) return merged({ ...last.body, ...next.body });
  return { put: next };
}
export type Verdict = "done" | "retry" | "failed";
/**
 * What to do with an entry after an attempt. `retry` stops the replay (order is kept; the same entry is sent again later with the same
 * idempotency key); `failed` parks the entry for the owner and lets the following ones go on; `done` removes it.
 *   network error / timeout (0), 5xx, 401 (sign-in needed), 408, 425, 429 → retry;
 *   404/410 on a deletion → done (already gone); 409 `conflict` and every other 4xx → failed.
 */
export function classify(kind: JournalKind, status: number): Verdict {
  if (status >= 200 && status < 300) return "done";
  if (status === 0 || status >= 500 || status === 401 || status === 408 || status === 425 || status === 429) return "retry";
  if ((status === 404 || status === 410) && (kind === "page.trash" || kind === "task.delete")) return "done";
  return "failed";
}
const TITLES: Record<JournalKind, string> = { "page.create": "New note", "page.update": "Note changes", "page.trash": "Move to trash", "page.restore": "Restore from trash", "page.tags": "Tags", "task.create": "New task", "task.update": "Task changes", "task.delete": "Delete task", upload: "Image upload" };
/** Human label of an entry for the "what is waiting" inspector. */
export function describe(e: Pick<JournalEntry, "kind" | "body">): string {
  const b = e.body as Record<string, any>; const base = TITLES[e.kind];
  if (e.kind === "page.update") { const k = Object.keys(b); const what = k.map((x) => (x === "pinned" ? (b.pinned ? "pin" : "unpin") : x === "archived" ? (b.archived ? "archive" : "unarchive") : x === "parentId" || x === "section" || x === "position" ? "move" : x === "title" ? "rename" : x)); return `${[...new Set(what)].join(", ") || "update"}${typeof b.title === "string" ? ` “${b.title}”` : ""}`.replace(/^./, (c) => c.toUpperCase()); }
  if (e.kind === "task.update") return b.status === "done" ? "Complete task" : b.status === "todo" ? "Reopen task" : base;
  if (e.kind === "page.tags") return `Tags: ${(b.tags as string[] | undefined)?.map((t) => `#${t}`).join(" ") || "none"}`;
  if (typeof b.title === "string" && b.title) return `${base} “${b.title}”`;
  if (e.kind === "upload" && typeof b.name === "string") return `${base} ${b.name}`;
  return base;
}
