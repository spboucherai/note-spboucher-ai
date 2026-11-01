import { handler } from "@/lib/api";
import { listDatabases } from "@/lib/databases/service";
/** All databases of the workspace (relation pickers, template chooser). */
export const GET = handler(async ({ ws }) => Response.json(await listDatabases(ws.id)));
