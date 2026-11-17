import { z } from "zod";
import { handler, parseBody, uuid } from "@/lib/api";
import { pageTags, setPageTags } from "@/lib/inbox/service";
import { getPage } from "@/lib/pages/service";
export const GET = handler(async ({ ws, params }) => { const id = uuid.parse(params.id); await getPage(ws.id, id, { includeDeleted: true }); return Response.json(await pageTags(id)); });
/** PUT { tags: string[] } → replaces the page's tags (created on the fly, lower-cased, max 20). */
export const PUT = handler(async ({ req, ws, params }) => { const id = uuid.parse(params.id); const { tags } = await parseBody(req, z.object({ tags: z.array(z.string().max(60)).max(20) })); return Response.json(await setPageTags(ws.id, id, tags)); });
