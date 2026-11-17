import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { lookupDoi, addByDoi, findByDoi } from "@/lib/research/references";
import { audit } from "@/lib/audit";
export const maxDuration = 60;
const dupOf = (d: { id: string; citeKey: string; title: string; pageId: string | null } | null) => (d ? { id: d.id, citeKey: d.citeKey, title: d.title, pageId: d.pageId } : null);
/**
 * GET ?doi=… → Crossref metadata preview (nothing saved) + `duplicate` when the DOI is already in the library (then Crossref is not called).
 * Errors carry a stable `code`: invalid_doi (fix the input), doi_not_found (Crossref does not know it), crossref_unreachable (retry later).
 */
export const GET = handler(async ({ req, ws }) => {
  const doi = new URL(req.url).searchParams.get("doi"); if (!doi) throw new HttpError(400, "doi missing", "invalid_doi");
  const dup = await findByDoi(ws.id, doi);
  if (dup) return Response.json({ doi: dup.doi, title: dup.title, authors: dup.authors ?? [], year: dup.year, journal: dup.journal, entryType: dup.entryType, citeKey: dup.citeKey, duplicate: dupOf(dup) });
  return Response.json({ ...(await lookupDoi(doi)), duplicate: null });
});
/** POST { doi, pageId } → 201 with the new doi_verified reference, or 200 { …reference, duplicate: true } when it was already stored (nothing created). */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ doi: z.string().min(5).max(200), pageId: uuid.nullable().optional() }));
  const r = await addByDoi(ws.id, b.doi, b.pageId ?? null);
  if (!r.duplicate || r.linked) await audit(user.id, r.duplicate ? "reference.link" : "reference.doi", { type: "reference", id: r.reference.id }, { doi: r.reference.doi });
  return Response.json({ ...r.reference, duplicate: r.duplicate, linked: r.linked }, { status: r.duplicate ? 200 : 201 });
});
