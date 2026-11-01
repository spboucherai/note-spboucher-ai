import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { db, schema } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { getPage, updatePage } from "@/lib/pages/service";
import { audit } from "@/lib/audit";
export const GET = handler(async ({ ws, params, req }) => {
  const id = uuid.parse(params.id); await getPage(ws.id, id, { includeDeleted: true });
  const v = new URL(req.url).searchParams.get("v");
  if (v) { const [row] = await db.select().from(schema.pageVersions).where(and(eq(schema.pageVersions.pageId, id), eq(schema.pageVersions.version, Number(v)))); return Response.json(row ?? null); }
  return Response.json(await db.select({ id: schema.pageVersions.id, version: schema.pageVersions.version, title: schema.pageVersions.title, reason: schema.pageVersions.reason, createdAt: schema.pageVersions.createdAt, wordCount: schema.pageVersions.wordCount }).from(schema.pageVersions).where(eq(schema.pageVersions.pageId, id)).orderBy(desc(schema.pageVersions.version)).limit(200));
});
/** POST { version } → restore that snapshot (current state is saved as a version first). */
export const POST = handler(async ({ ws, params, req, user }) => {
  const id = uuid.parse(params.id); const { version } = await parseBody(req, z.object({ version: z.number().int() }));
  const [row] = await db.select().from(schema.pageVersions).where(and(eq(schema.pageVersions.pageId, id), eq(schema.pageVersions.version, version)));
  if (!row) return Response.json({ error: "Version not found" }, { status: 404 });
  const p = await updatePage(ws.id, id, { title: row.title, content: row.content as any, properties: (row.properties ?? {}) as any }, { versionReason: `restore v${version}` });
  await audit(user.id, "page.restore_version", { type: "page", id }, { version });
  return Response.json({ ok: true, version: p.version });
});
