import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { chat, sse } from "@/lib/ai/chat";
export const maxDuration = 600;
export const POST = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({ conversationId: z.string().uuid().nullable().optional(), message: z.string().min(1).max(60_000), pageId: z.string().uuid().nullable().optional(), model: z.string().max(80).nullable().optional(), task: z.enum(["chat", "quick", "write", "reason", "deep", "code", "extract", "longctx", "agent", "judge"]).nullable().optional(), useWorkspace: z.boolean().optional(), images: z.array(z.object({ mime: z.string(), dataBase64: z.string() })).max(4).optional(), scopePageIds: z.array(z.string().uuid()).max(50).optional() }));
  return sse(chat(ws.id, b, req.signal), req.signal);
});
