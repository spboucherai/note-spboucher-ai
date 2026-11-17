import { handler } from "@/lib/api";
import { inboxCount, listInbox } from "@/lib/inbox/service";
/** GET → captures waiting for triage (newest first). ?count=1 → just the number, for the navigation badge. */
export const GET = handler(async ({ req, ws }) => {
  if (new URL(req.url).searchParams.get("count") === "1") return Response.json({ count: await inboxCount(ws.id) });
  return Response.json(await listInbox(ws.id));
});
