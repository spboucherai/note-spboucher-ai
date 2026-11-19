import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { listReferences, createReference } from "@/lib/research/references";
import { audit } from "@/lib/audit";
export const refSchema = z.object({ id: uuid.optional(), pageId: uuid.nullable().optional(), citeKey: z.string().max(120).nullable().optional(), entryType: z.string().max(40).optional(), title: z.string().min(1).max(1000), authors: z.array(z.string().max(200)).max(100).optional(), year: z.number().int().min(1000).max(2100).nullable().optional(), journal: z.string().max(500).nullable().optional(), doi: z.string().max(200).nullable().optional(), url: z.string().max(2000).nullable().optional(), fields: z.record(z.string(), z.unknown()).optional(), verified: z.enum(["user", "doi_verified", "ai_suggested"]).optional(), attachmentId: uuid.nullable().optional() });
/** GET ?pageId=<id> (page references) | no pageId = whole library */
export const GET = handler(async ({ req, ws }) => {
  const pageId = new URL(req.url).searchParams.get("pageId");
  return Response.json(await listReferences(ws.id, { pageId: pageId || null }));
});
export const POST = handler(async ({ req, ws, user }) => {
  const b = await parseBody(req, refSchema);
  const r = await createReference(ws.id, { ...b, verified: b.verified ?? "user" }); // 3.0: a client-chosen `id` makes the call idempotent (the stored reference is returned)
  await audit(user.id, "reference.create", { type: "reference", id: r.id }, { citeKey: r.citeKey });
  return Response.json(r, { status: 201 });
});
