import { handler, HttpError } from "@/lib/api";
import { importCsv } from "@/lib/databases/csv";
import { audit } from "@/lib/audit";
/** multipart: file=<csv>. 3.0 (audit D4): a body that is not multipart, an empty file or a file without a header row → 400 (was 500). */
export const POST = handler(async ({ ws, params, req, user }) => {
  const form = await req.formData().catch(() => { throw new HttpError(400, "A multipart/form-data body with a `file` field is expected", "bad_request"); });
  const file = form.get("file"); if (!(file instanceof File)) throw new HttpError(400, "file missing", "bad_request");
  if (file.size > 20 * 1024 * 1024) throw new HttpError(413, "CSV too large (max 20 MB)");
  const text = await file.text(); if (!text.trim()) throw new HttpError(400, "The CSV file is empty", "bad_csv");
  const r = await importCsv(ws.id, params.id, text); await audit(user.id, "database.import", { type: "database", id: params.id }, r);
  return Response.json(r, { status: 201 });
});
