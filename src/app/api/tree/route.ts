import { handler } from "@/lib/api";
import { listTree } from "@/lib/pages/service";
export const GET = handler(async ({ ws }) => Response.json(await listTree(ws.id)));
