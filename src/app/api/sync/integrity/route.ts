import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { handler } from "@/lib/api";
import { db, schema } from "@/db";
import { stableJson, INTEGRITY_ALGORITHM } from "@/lib/stable-json";
export const dynamic = "force-dynamic";
/**
 * GET /api/sync/integrity — content fingerprints of every page of the workspace (any state: live, inbox, archived, trash), for a client
 * that keeps a local replica (the web app offline-first, the native apps) and wants to verify it on demand.
 * → { algorithm: "sha256-stable-json-1", count, pages: [{ id, version, hash }] } where `hash` is the SHA-256 (hex) of the canonical JSON
 * of `content` (object keys sorted, see src/lib/stable-json.ts). Compare a hash only when the versions are equal: a different version
 * just means the replica is behind and a normal GET /api/sync will fix it. Read-only; nothing is marked as opened. Added in 3.0 (additive).
 */
export const GET = handler(async ({ ws }) => {
  const rows = await db.select({ id: schema.pages.id, version: schema.pages.version, content: schema.pages.content }).from(schema.pages).where(eq(schema.pages.workspaceId, ws.id));
  return Response.json({ algorithm: INTEGRITY_ALGORITHM, count: rows.length, pages: rows.map((r) => ({ id: r.id, version: r.version, hash: createHash("sha256").update(stableJson(r.content)).digest("hex") })) });
});
