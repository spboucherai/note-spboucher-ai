import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { sse } from "@/lib/ai/chat";
import { researchAI, RESEARCH_FEATURES } from "@/lib/research/ai";
export const maxDuration = 300;
/** POST { feature, pageId, referenceIds?, attachmentIds?, text?, instruction?, question?, latex?, language?, model? } → SSE (meta | text | result | done | error). Output is AI-generated and never written anywhere by this route. */
export const POST = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({ feature: z.enum(RESEARCH_FEATURES), pageId: uuid, referenceIds: z.array(uuid).max(50).optional(), attachmentIds: z.array(uuid).max(20).optional(), text: z.string().max(200_000).optional(), instruction: z.string().max(4000).optional(), question: z.string().max(4000).optional(), latex: z.string().max(20_000).optional(), language: z.enum(["fr", "en"]).nullable().optional(), model: z.string().max(80).nullable().optional() }));
  return sse(researchAI(ws.id, b, req.signal), req.signal);
});
