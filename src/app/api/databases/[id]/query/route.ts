import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { getDatabase, queryRows } from "@/lib/databases/service";
import { exportCsv } from "@/lib/databases/csv";
const rule = z.object({ property: z.string(), op: z.string(), value: z.unknown().optional() });
const group: z.ZodType<any> = z.lazy(() => z.object({ and: z.array(z.union([rule, group])).optional(), or: z.array(z.union([rule, group])).optional() }));
/** POST { viewId?, filter?, sorts?, search?, limit?, offset? } — explicit fields override the view's config. */
export const POST = handler(async ({ ws, params, req }) => {
  const b = await parseBody(req, z.object({ viewId: z.string().uuid().optional(), filter: group.nullable().optional(), sorts: z.array(z.object({ property: z.string(), dir: z.enum(["asc", "desc"]) })).optional(), search: z.string().max(200).optional(), limit: z.number().int().min(1).max(1000).optional(), offset: z.number().int().min(0).optional() }));
  const d = await getDatabase(ws.id, params.id); const v = d.views.find((x) => x.id === b.viewId);
  return Response.json(await queryRows(d.id, d.properties, { ...b, filter: b.filter === undefined ? (v?.config.filter ?? null) : b.filter, sorts: b.sorts ?? v?.config.sorts ?? [] }));
});
/** GET ?format=csv&viewId= */
export const GET = handler(async ({ ws, params, req }) => {
  const u = new URL(req.url); const d = await getDatabase(ws.id, params.id); const v = d.views.find((x) => x.id === u.searchParams.get("viewId"));
  const r = await queryRows(d.id, d.properties, { filter: v?.config.filter ?? null, sorts: v?.config.sorts ?? [], search: u.searchParams.get("q") ?? undefined, limit: 1000 });
  if (u.searchParams.get("format") === "csv") return new Response(exportCsv(d.properties, r.rows, v?.config.hidden ?? []), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${(v ? `${d.name}-${v.name}` : d.name).replace(/[^\w.-]+/g, "_")}.csv"` } });
  return Response.json(r);
});
