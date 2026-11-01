import { handler, HttpError } from "@/lib/api";
import { importCsv } from "@/lib/databases/csv";
import { audit } from "@/lib/audit";
/** multipart: file=<csv> */
export const POST = handler(async ({ ws, params, req, user }) => {
  const form = await req.formData(); const file = form.get("file"); if (!(file instanceof File)) throw new HttpError(400, "file missing");
  if (file.size > 20 * 1024 * 1024) throw new HttpError(413, "CSV too large (max 20 MB)");
  const r = await importCsv(ws.id, params.id, await file.text()); await audit(user.id, "database.import", { type: "database", id: params.id }, r);
  return Response.json(r, { status: 201 });
});
