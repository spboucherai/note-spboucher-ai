"use client";
/**
 * file: src/lib/client/replica.ts
 * description: the device replica of the workspace (SPEC §10, web offline-first). Fed by GET /api/sync?kinds=task with the same cursor
 *   rules as the native apps: whole pages (content included, every state), attachment metadata, tasks, tombstones. Reads fall back to it
 *   when the network fails; the offline app (src/components/offline/OfflineApp.tsx) reads nothing else. Also: the integrity check
 *   (content hash of every replica page vs GET /api/sync/integrity) with repair of the pages that differ.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { api } from "./api";
import { getMeta, idbAll, idbBatch, idbClear, idbCount, idbGet, idbPut, setMeta } from "./offline";
import { stableJson, INTEGRITY_ALGORITHM } from "@/lib/stable-json";

export interface RPage {
  id: string; parentId: string | null; databaseId: string | null; type: string; section: string; title: string; icon: string | null; cover: string | null;
  content: any; properties: Record<string, unknown> | null; position: number; pinned: boolean; archived: boolean; version: number; wordCount: number;
  createdAt: string; updatedAt: string; lastOpenedAt: string | null; deletedAt: string | null; inboxAt: string | null; captureKind: string | null; rev: number; tags: string[];
  /** created on this device and not yet confirmed by the server (version 0 until then) */
  local?: boolean;
}
export interface RTask { id: string; pageId: string | null; blockId: string | null; title: string; status: string; priority: string; dueAt: string | null; completedAt: string | null; project: string | null; createdAt: string; updatedAt: string; deletedAt: string | null; rev: number; local?: boolean }
export interface RAttachment { id: string; pageId: string | null; filename: string; mime: string; size: number; sha256: string | null; pageCount: number | null; createdAt: string; deletedAt: string | null; rev: number }
export interface SyncInfo { cursor: number; lastSync: string | null; lastError: string | null; workspace: { id: string; name: string } | null; user: { displayName: string } | null; pages: number; tasks: number; attachments: number }
interface Feed { cursor: number; head: number; more: boolean; reset: boolean; serverTime: string; workspace: { id: string; name: string }; user?: { displayName: string }; pages: RPage[]; attachments: RAttachment[]; tombstones: { id: string; kind: string; rev: number }[]; tags: { name: string; color: string }[]; entities?: { task?: RTask[] } }

const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("note:replica-changed")); };
export const getReplicaPage = (id: string) => idbGet<RPage>("pages", id).catch(() => undefined);
export const putReplicaPage = (p: RPage) => idbPut("pages", p).then(changed).catch(() => {});
export const listReplicaPages = () => idbAll<RPage>("pages").catch(() => [] as RPage[]);
export const getReplicaTask = (id: string) => idbGet<RTask>("tasks", id).catch(() => undefined);
export const putReplicaTask = (t: RTask) => idbPut("tasks", t).then(changed).catch(() => {});
export const listReplicaTasks = () => idbAll<RTask>("tasks").catch(() => [] as RTask[]);
/** Patch one replica page in place (no-op when the page is not on the device). */
export async function patchReplicaPage(id: string, patch: Partial<RPage>) { const p = await getReplicaPage(id); if (!p) return; await putReplicaPage({ ...p, ...patch }); }

let pulling: Promise<{ pages: number; tasks: number; attachments: number; tombstones: number }> | null = null;
/**
 * Bring the replica up to date: read the change feed from the stored cursor until `more` is false. Each window is written in one
 * transaction per store and the cursor is saved after it, so an interruption (closed tab, lost network) resumes where it stopped and
 * never skips a revision. `reset: true` (server restored from an older backup) or another workspace → the replica starts again from zero.
 */
export function pullReplica(): Promise<{ pages: number; tasks: number; attachments: number; tombstones: number }> {
  if (pulling) return pulling;
  pulling = (async () => {
    const n = { pages: 0, tasks: 0, attachments: 0, tombstones: 0 };
    try {
      let cursor = (await getMeta<number>("cursor")) ?? 0; const ws = await getMeta<{ id: string }>("workspace");
      for (let guard = 0; guard < 2000; guard++) {
        const r = await api<Feed>(`/api/sync?since=${cursor}&limit=200&kinds=task`, { timeoutMs: 30_000 });
        if (r.reset || (ws && r.workspace && ws.id !== r.workspace.id && cursor > 0)) { await idbClear("pages"); await idbClear("tasks"); await idbClear("attachments"); cursor = 0; await setMeta("cursor", 0); await setMeta("workspace", r.workspace); if (r.reset) continue; }
        // rows created on this device and still waiting in the journal keep their local flag until the journal confirms them
        if (r.pages.length) await idbBatch("pages", r.pages);
        if (r.attachments.length) await idbBatch("attachments", r.attachments);
        const tasks = r.entities?.task ?? []; if (tasks.length) await idbBatch("tasks", tasks);
        for (const kind of ["page", "attachment", "task"] as const) { const ids = r.tombstones.filter((t) => t.kind === kind).map((t) => t.id); if (ids.length) await idbBatch(kind === "page" ? "pages" : kind === "task" ? "tasks" : "attachments", [], ids); }
        n.pages += r.pages.length; n.attachments += r.attachments.length; n.tasks += tasks.length; n.tombstones += r.tombstones.length;
        cursor = r.cursor; await setMeta("cursor", cursor); await setMeta("workspace", r.workspace); if (r.user) await setMeta("user", r.user); await setMeta("tags", r.tags);
        if (!r.more) break;
      }
      await setMeta("lastSync", new Date().toISOString()); await setMeta("lastError", null);
      try { localStorage.setItem("note-sync-state", "1"); } catch { /* storage disabled */ }
      return n;
    } catch (e: any) { await setMeta("lastError", e?.message ?? "Sync failed"); throw e; }
    finally { changed(); }
  })().finally(() => { pulling = null; });
  return pulling;
}
export async function syncInfo(): Promise<SyncInfo> {
  const [cursor, lastSync, lastError, workspace, user, pages, tasks, attachments] = await Promise.all([getMeta<number>("cursor"), getMeta<string>("lastSync"), getMeta<string | null>("lastError"), getMeta<{ id: string; name: string }>("workspace"), getMeta<{ displayName: string }>("user"), idbCount("pages").catch(() => 0), idbCount("tasks").catch(() => 0), idbCount("attachments").catch(() => 0)]);
  return { cursor: cursor ?? 0, lastSync: lastSync ?? null, lastError: lastError ?? null, workspace: workspace ?? null, user: user ?? null, pages, tasks, attachments };
}
export interface ReplicaTreeNode { id: string; parentId: string | null; title: string; icon: string | null; type: string; section: string; pinned: boolean; updatedAt: string; inboxAt: string | null; position: number; createdAt: string; local?: boolean }
/** The page tree as GET /api/tree returns it (live pages, no database rows, not archived), in the same order — from the replica. */
export async function replicaTree(): Promise<ReplicaTreeNode[]> {
  const pages = await listReplicaPages();
  return pages.filter((p) => !p.deletedAt && !p.databaseId && !p.archived).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
    .map((p) => ({ id: p.id, parentId: p.parentId, title: p.title, icon: p.icon, type: p.type, section: p.section, pinned: p.pinned, updatedAt: p.updatedAt, inboxAt: p.inboxAt, position: p.position, createdAt: p.createdAt, local: p.local }));
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const contentHash = (content: unknown) => sha256Hex(stableJson(content));
export interface IntegrityReport { at: string; algorithm: string; checked: number; ok: number; stale: number; mismatched: string[]; missingLocal: number; extraLocal: number; repaired: number; localOnly: number }
/**
 * Integrity check, on demand: the sha256 of the canonical JSON of every replica page is compared with the server's, page by page.
 *  - same version, different hash → the device copy is damaged: it is fetched again and replaced (`repaired`);
 *  - different version, or a page the device does not have / the server no longer has → the replica is simply behind (`stale`,
 *    `missingLocal`, `extraLocal`): a normal sync is run and those are counted, not treated as damage;
 *  - pages created on this device and not yet sent are left alone (`localOnly`).
 */
export async function verifyIntegrity(): Promise<IntegrityReport> {
  const server = await api<{ algorithm: string; pages: { id: string; version: number; hash: string }[] }>("/api/sync/integrity", { timeoutMs: 60_000 });
  if (server.algorithm !== INTEGRITY_ALGORITHM) throw new Error("The server uses another integrity algorithm; update the app.");
  const local = await listReplicaPages(); const byId = new Map(local.map((p) => [p.id, p])); const seen = new Set<string>();
  const rep: IntegrityReport = { at: new Date().toISOString(), algorithm: server.algorithm, checked: 0, ok: 0, stale: 0, mismatched: [], missingLocal: 0, extraLocal: 0, repaired: 0, localOnly: 0 };
  for (const s of server.pages) {
    seen.add(s.id); const p = byId.get(s.id); if (!p) { rep.missingLocal++; continue; }
    rep.checked++;
    if (p.version !== s.version) { rep.stale++; continue; }
    if ((await contentHash(p.content)) === s.hash) rep.ok++; else rep.mismatched.push(s.id);
  }
  for (const p of local) if (!seen.has(p.id)) { if (p.local) rep.localOnly++; else rep.extraLocal++; }
  for (const id of rep.mismatched) {
    try { const fresh = await api<RPage>(`/api/pages/${id}`); const cur = byId.get(id)!; await putReplicaPage({ ...cur, title: fresh.title, content: fresh.content, properties: fresh.properties, version: fresh.version, updatedAt: fresh.updatedAt }); rep.repaired++; } catch { /* stays listed as mismatched */ }
  }
  await setMeta("integrity", rep); changed();
  return rep;
}
