import { handler } from "@/lib/api";
import { buildBrief } from "@/lib/knowledge/brief";
export const dynamic = "force-dynamic";
/** GET /api/brief?tz=<IANA zone> → the brief of the day. No model is called; `aiSummary` is the last one explicitly requested (or null). */
export const GET = handler(async ({ req, ws }) => Response.json(await buildBrief(ws.id, { tz: new URL(req.url).searchParams.get("tz") ?? undefined })));
