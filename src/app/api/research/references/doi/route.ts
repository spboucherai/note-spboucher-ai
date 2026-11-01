import { z } from "zod";
import { handler, parseBody, uuid, HttpError } from "@/lib/api";
import { lookupDoi, addByDoi } from "@/lib/research/references";
import { audit } from "@/lib/audit";
export const maxDuration = 60;
/** GET ?doi=… → Crossref metadata preview (not saved) */
export const GET = handler(async ({ req }) => { const doi = new URL(req.url).searchParams.get("doi"); if (!doi) throw new HttpError(400, "doi missing"); return Response.json(await lookupDoi(doi)); });
/** POST { doi, pageId } → creates (or links) a doi_verified reference */
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, z.object({ doi: z.string().min(5).max(200), pageId: uuid.nullable().optional() }));
  const r = await addByDoi(ws.id, b.doi, b.pageId ?? null);
  await audit(user.id, "reference.doi", { type: "reference", id: r.id }, { doi: r.doi });
  return Response.json(r, { status: 201 });
});
