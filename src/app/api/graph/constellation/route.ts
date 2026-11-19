import { handler } from "@/lib/api";
import { buildConstellation } from "@/lib/graph/constellation";
export const dynamic = "force-dynamic";
/**
 * GET /api/graph/constellation[?refresh=1] → the Thought Constellation: every embedded page with a 2-D position computed from the
 * real embeddings (deterministic PCA over the page-level mean vectors, cached until the embeddings change), its cluster, project and
 * tags, plus the accepted page ↔ page links. No model is called. `stats.embedded = 0` ⇒ no point (the client shows an empty state).
 * See docs/next/API-NEXT.md §4.3 « Constellation ».
 */
export const GET = handler(async ({ req, ws }) => Response.json(await buildConstellation(ws.id, { refresh: new URL(req.url).searchParams.get("refresh") === "1" })));
