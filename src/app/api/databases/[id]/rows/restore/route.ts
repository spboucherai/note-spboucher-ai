import { z } from "zod";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { handler, parseBody, uuid } from "@/lib/api";
import { ensureDatabase } from "@/lib/databases/service";
import { restorePage } from "@/lib/pages/service";
import { audit } from "@/lib/audit";

/**
 * POST { ids: [rowId] } — undo a row deletion (the "Undo" action of the delete toast).
 * Deleting a row soft-deletes both the row and its page; this brings both back. Rows of another database are ignored.
 */
export const POST = handler(async ({ ws, params, req, user }) => {
  const body = await parseBody(req, z.object({ ids: z.array(uuid).min(1).max(500) }));
  const database = await ensureDatabase(ws.id, params.id);
  const rows = await db
    .select({ id: schema.databaseRows.id, pageId: schema.databaseRows.pageId })
    .from(schema.databaseRows)
    .where(and(eq(schema.databaseRows.databaseId, database.id), inArray(schema.databaseRows.id, body.ids), isNotNull(schema.databaseRows.deletedAt)));
  if (rows.length) {
    await db.update(schema.databaseRows).set({ deletedAt: null }).where(inArray(schema.databaseRows.id, rows.map((r) => r.id)));
    for (const r of rows) await restorePage(ws.id, r.pageId);
  }
  await audit(user.id, "database.row.restore", { type: "database", id: database.id }, { count: rows.length });
  return Response.json({ ok: true, restored: rows.length });
});
