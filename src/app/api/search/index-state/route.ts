import { handler } from "@/lib/api";
import { indexStats } from "@/lib/search";
import { enqueue, QUEUES } from "@/lib/jobs";
import { audit } from "@/lib/audit";
export const GET = handler(async ({ ws }) => Response.json(await indexStats(ws.id)));
/** POST → rebuild the whole index (re-chunk + re-embed changed content; unchanged hashes are skipped). */
export const POST = handler(async ({ ws, user }) => { await enqueue(QUEUES.reindexAll, { workspaceId: ws.id }); await audit(user.id, "search.reindex"); return Response.json({ ok: true }); });
