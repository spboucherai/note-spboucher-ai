import { handler } from "@/lib/api";
import { syncFeed } from "@/lib/sync/feed";
export const dynamic = "force-dynamic";
/**
 * GET /api/sync?since=<rev>&limit=<n> — change feed for native clients (SP Notes on macOS / iOS), which keep a full local copy.
 *
 * Returns everything whose revision is greater than `since`, oldest first: whole pages (content included, in every state — live, inbox,
 * archived, in the trash), attachment metadata, and tombstones of permanently deleted rows. `cursor` is the revision to send next time;
 * `more: true` means the answer was cut at `limit` and the client should call again at once. `since=0` is a full copy.
 *
 * Revisions come from one sequence taken under an advisory lock (migration 0002), so they are visible in commit order: every change
 * numbered ≤ `head` is committed when `head` is read, and nothing can later appear below a cursor the client already holds.
 * Read-only; nothing is marked as opened.
 *
 * 3.0 — `kinds=task,database,database_property,database_view,database_row,edge,reference,canvas,concept` (or `kinds=all`) adds
 * `"entities": { "<kind>": [ {…row…, "rev": n} ] }`, windowed exactly like pages (same cursor, same cut rule), and the tombstones of
 * those kinds. WITHOUT `kinds` the answer is the 2.x one, byte for byte: same keys in the same order, tombstones of pages and
 * attachments only, and a `head` that ignores the revisions of the new kinds. A cursor is therefore only meaningful for the set of
 * kinds it was obtained with: a client that starts asking for a new kind starts that kind from `since=0`.
 */
export const GET = handler(async ({ req, ws, user }) => Response.json(await syncFeed(ws, user, new URL(req.url).searchParams)));
