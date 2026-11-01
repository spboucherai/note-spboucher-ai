import { handler } from "@/lib/api";
import { researchOverview } from "@/lib/research/overview";
/** GET → working papers tracker (all research pages with status, counts, last activity). */
export const GET = handler(async ({ ws }) => Response.json(await researchOverview(ws.id)));
