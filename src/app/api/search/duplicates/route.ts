import { handler } from "@/lib/api";
import { findDuplicates } from "@/lib/search";
export const GET = handler(async ({ req, ws }) => Response.json(await findDuplicates(ws.id, Number(new URL(req.url).searchParams.get("threshold") ?? 0.93))));
