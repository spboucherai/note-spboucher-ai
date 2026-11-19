import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { createRow, updateRow, deleteRows, reorderRows, listRowsSimple, getDatabase, queryRows } from "@/lib/databases/service";
import { audit } from "@/lib/audit";
import { autoRunForRow } from "@/lib/ai/properties";
const values = z.record(z.string(), z.unknown());
/** GET ?q=&limit= → lightweight refs (relation pickers); ?full=1 → hydrated rows. */
export const GET = handler(async ({ ws, params, req }) => {
  const u = new URL(req.url); const q = u.searchParams.get("q") ?? undefined; const limit = Math.min(500, Number(u.searchParams.get("limit") ?? 50));
  if (u.searchParams.get("full") === "1") { const d = await getDatabase(ws.id, params.id); return Response.json(await queryRows(d.id, d.properties, { search: q, limit, offset: Number(u.searchParams.get("offset") ?? 0) })); }
  return Response.json(await listRowsSimple(ws.id, params.id, q, limit));
});
/** { title?, values?, position?, content? } or { rows: [...] } */
export const POST = handler(async ({ ws, params, req, user }) => {
  const row = z.object({ id: uuid.optional(), pageId: uuid.optional(), title: z.string().max(500).optional(), values: values.optional(), position: z.number().optional(), content: z.any().optional(), icon: z.string().max(16).nullable().optional() });
  const b = await parseBody(req, z.union([z.object({ rows: z.array(row).max(500) }), row.strict()]));
  const inputs = "rows" in b ? b.rows : [b]; const out = []; for (const i of inputs) out.push(await createRow(ws.id, params.id, i));
  for (const r of out) await autoRunForRow(ws.id, params.id, r.id, ["title"]); // NEXT-AI: AI properties with auto-run
  await audit(user.id, "database.row.create", { type: "database", id: params.id }, { count: out.length });
  return Response.json("rows" in b ? out : out[0], { status: 201 });
});
/** { id, values } | { updates: [{ id, values }] } | { order: [ids] } */
export const PATCH = handler(async ({ ws, params, req }) => {
  const b = await parseBody(req, z.object({ id: uuid.optional(), values: values.optional(), updates: z.array(z.object({ id: uuid, values })).max(500).optional(), order: z.array(uuid).max(5000).optional() }));
  if (b.order) { await reorderRows(ws.id, params.id, b.order); return Response.json({ ok: true }); }
  // NEXT-AI: after a row changed, AI properties with auto-run are queued (never when only AI cells changed; never fails the write)
  if (b.updates) { const out = []; for (const u of b.updates) { out.push(await updateRow(ws.id, params.id, u.id, u.values)); await autoRunForRow(ws.id, params.id, u.id, Object.keys(u.values)); } return Response.json(out); }
  if (!b.id) throw new HttpError(400, "id required");
  const row = await updateRow(ws.id, params.id, b.id, b.values ?? {});
  await autoRunForRow(ws.id, params.id, b.id, Object.keys(b.values ?? {}));
  return Response.json(row);
});
/** ?id=… or ?ids=a,b,c */
export const DELETE = handler(async ({ ws, params, req, user }) => {
  const u = new URL(req.url); const ids = [...(u.searchParams.get("ids")?.split(",") ?? []), ...(u.searchParams.get("id") ? [u.searchParams.get("id")!] : [])].map((x) => uuid.parse(x));
  const n = await deleteRows(ws.id, params.id, ids); await audit(user.id, "database.row.delete", { type: "database", id: params.id }, { count: n });
  return Response.json({ ok: true, deleted: n });
});
