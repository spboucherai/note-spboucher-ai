import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { QUERY_SOURCES, runQuery } from "@/lib/knowledge/query";
/**
 * POST /api/query { source, databaseId?, viewId?, pageId?, filter?, limit? } → `{source, columns, rows, total, limit, table, resolvedAt}`.
 * Read-only (POST because the body is a query): resolves a `queryView` / `chart` block at display time. Safe to repeat.
 */
export const POST = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({ source: z.enum(QUERY_SOURCES), databaseId: uuid.nullable().optional(), viewId: uuid.nullable().optional(), pageId: uuid.nullable().optional(), limit: z.number().int().min(1).max(500).optional(),
    filter: z.object({ tag: z.string().max(60).optional(), section: z.string().max(40).optional(), status: z.string().max(40).optional(), parentId: uuid.optional(), text: z.string().max(200).optional(), dueBefore: z.string().max(40).optional(), dueAfter: z.string().max(40).optional() }).optional() }));
  return Response.json(await runQuery(ws.id, b));
});
