import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { importBibtex } from "@/lib/research/references";
import { audit } from "@/lib/audit";
export const maxDuration = 120;
/** POST multipart (file=.bib, pageId) or JSON { text, pageId } */
export const POST = handler(async ({ req, ws, user }) => {
  let text = ""; let pageId: string | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData(); const f = form.get("file"); const t = form.get("text"); pageId = (form.get("pageId") as string) || null;
    if (f instanceof File) { if (f.size > 20 * 1024 * 1024) throw new HttpError(413, "BibTeX file too large (max 20 MB)"); text = await f.text(); } else if (typeof t === "string") text = t;
  } else { const b = await parseBody(req, z.object({ text: z.string().min(1).max(20_000_000), pageId: uuid.nullable().optional() })); text = b.text; pageId = b.pageId ?? null; }
  if (!text.trim()) throw new HttpError(400, "No BibTeX content");
  if (pageId && !/^[0-9a-f-]{36}$/.test(pageId)) throw new HttpError(400, "Invalid pageId");
  const res = await importBibtex(ws.id, text, pageId);
  await audit(user.id, "reference.import", { type: "page", id: pageId ?? "library" }, { created: res.created.length, skipped: res.skipped.length });
  return Response.json({ created: res.created, skipped: res.skipped, parsed: res.parsed });
});
