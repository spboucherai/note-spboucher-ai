import { z } from "zod";
import { handler, HttpError } from "@/lib/api";
import { planChat, planAction, CHAT_MODES, ACTION_IDS } from "@/lib/ai/chat";
/**
 * GET ?mode=&pageId=&model=            → ChatPlan   (assistant)
 * GET ?action=&chars=&model=           → ActionPlan (inline action on a selection)
 * GET ?actions=1&chars=                → { [action]: ActionPlan } for the actions offered by the selection sheet
 * Dry run used by the UI to say, BEFORE anything is sent, which provider and model would receive what, and whether the request is an
 * expensive class. Reads the routing tables and the page length only: it never calls a provider and never receives note text.
 */
const q = z.object({ mode: z.enum(CHAT_MODES).optional(), action: z.enum(ACTION_IDS).optional(), actions: z.literal("1").optional(), pageId: z.string().uuid().optional(), model: z.string().max(80).optional(), chars: z.coerce.number().int().min(0).max(2_000_000).optional(), images: z.coerce.number().int().min(0).max(4).optional() });
export const GET = handler(async ({ req, ws }) => {
  const r = q.safeParse(Object.fromEntries(new URL(req.url).searchParams)); if (!r.success) throw new HttpError(400, "Invalid plan request");
  if (r.data.actions) { const ids = ["rewrite", "fix", "translate", "summarize", "expand", "explain", "to_list", "to_tasks", "table", "custom"] as const; const plans = await Promise.all(ids.map((a) => planAction(a, r.data.chars ?? 0, null))); return Response.json(Object.fromEntries(ids.map((a, i) => [a, plans[i].plan]))); }
  if (r.data.action) return Response.json((await planAction(r.data.action, r.data.chars ?? 0, r.data.model ?? null)).plan);
  return Response.json(await planChat(ws.id, { mode: r.data.mode ?? "notes", pageId: r.data.pageId ?? null, model: r.data.model ?? null, message: "x".repeat(Math.min(r.data.chars ?? 0, 60_000)), images: r.data.images }));
});
