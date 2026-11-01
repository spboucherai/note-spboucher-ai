import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { duplicateDatabase } from "@/lib/databases/service";
import { audit } from "@/lib/audit";
export const POST = handler(async ({ ws, params, req, user }) => {
  const b = await parseBody(req, z.object({ withRows: z.boolean().optional(), title: z.string().max(500).optional(), asTemplate: z.boolean().optional(), parentId: z.string().uuid().nullable().optional() }));
  const d = await duplicateDatabase(ws.id, params.id, b); await audit(user.id, "database.duplicate", { type: "database", id: params.id }, { to: d.id, withRows: !!b.withRows });
  return Response.json(d, { status: 201 });
});
