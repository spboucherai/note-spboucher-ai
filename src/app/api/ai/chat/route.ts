import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { chat, sse, CHAT_MODES } from "@/lib/ai/chat";
export const maxDuration = 600;
/**
 * POST → SSE stream of ChatEvent. `clientId` identifies one send: repeating it after a lost connection replays the stored answer instead
 * of calling (and paying) the provider again. `confirmExpensive` is required for expensive classes (the stream answers
 * `needs_confirmation` otherwise, having written and sent nothing).
 */
export const POST = handler(async ({ req, ws }) => {
  const b = await parseBody(req, z.object({
    conversationId: z.string().uuid().nullable().optional(), clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().optional(),
    message: z.string().trim().min(1).max(60_000), mode: z.enum(CHAT_MODES).nullable().optional(), pageId: z.string().uuid().nullable().optional(), model: z.string().max(80).nullable().optional(),
    task: z.enum(["chat", "quick", "write", "reason", "deep", "code", "extract", "longctx", "agent", "judge"]).nullable().optional(), useWorkspace: z.boolean().optional(), confirmExpensive: z.boolean().optional(),
    images: z.array(z.object({ mime: z.string().regex(/^image\/(png|jpeg|webp|gif)$/), dataBase64: z.string().max(8_000_000) })).max(4).optional(), scopePageIds: z.array(z.string().uuid()).max(50).optional(),
  }));
  return sse(chat(ws.id, b, req.signal), req.signal);
});
