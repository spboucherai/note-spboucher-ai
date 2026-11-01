import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { getDatabase, updateDatabase, queryRows } from "@/lib/databases/service";
import { exportCsv } from "@/lib/databases/csv";
import { audit } from "@/lib/audit";
/** GET by database id OR host page id. ?format=csv[&viewId=] exports the rows. */
export const GET = handler(async ({ ws, params, req }) => {
  const d = await getDatabase(ws.id, params.id); const u = new URL(req.url);
  if (u.searchParams.get("format") === "csv") {
    const view = d.views.find((v) => v.id === u.searchParams.get("viewId")); const r = await queryRows(d.id, d.properties, { filter: view?.config.filter ?? null, sorts: view?.config.sorts ?? [], limit: 1000 });
    return new Response(exportCsv(d.properties, r.rows, view?.config.hidden ?? []), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${d.name.replace(/[^\w.-]+/g, "_") || "database"}.csv"` } });
  }
  return Response.json(d);
});
export const PATCH = handler(async ({ ws, params, req, user }) => {
  const b = await parseBody(req, z.object({ name: z.string().max(500).optional(), description: z.string().max(2000).nullable().optional(), icon: z.string().max(16).nullable().optional(), isTemplate: z.boolean().optional() }));
  const d = await updateDatabase(ws.id, params.id, b); await audit(user.id, "database.update", { type: "database", id: d.id }, { keys: Object.keys(b) });
  return Response.json(d);
});
