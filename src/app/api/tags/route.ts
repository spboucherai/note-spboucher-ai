import { handler } from "@/lib/api";
import { listTags } from "@/lib/inbox/service";
export const GET = handler(async ({ ws }) => Response.json(await listTags(ws.id)));
