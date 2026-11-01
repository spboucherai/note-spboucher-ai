import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { applyTemplate } from "@/lib/databases/templates";
import { audit } from "@/lib/audit";
export const POST = handler(async ({ ws, params, req, user }) => {
  const { template } = await parseBody(req, z.object({ template: z.string().max(50) }));
  const r = await applyTemplate(ws.id, params.id, template); await audit(user.id, "database.template", { type: "database", id: params.id }, r);
  return Response.json(r);
});
