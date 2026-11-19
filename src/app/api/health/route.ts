import { sql } from "@/db";
import { configProblems } from "@/lib/auth/config";
import { serverVersion } from "@/lib/meta";
import { pgIso } from "@/lib/pg-values";
export const dynamic = "force-dynamic";
/** Public liveness probe (mld heal). Booleans and a version only — nothing about the content or the owner. */
export async function GET() {
  try {
    const [r] = await sql`select now() as now, (select count(*) from pg_extension where extname='vector') as vec, (select (value->>'at')::timestamptz from settings where key = 'worker.heartbeat') as beat`;
    const worker = r.beat ? Date.now() - new Date(r.beat).getTime() < 120_000 : false;
    return Response.json({ ok: true, db: true, pgvector: Number(r.vec) > 0, worker, passkeys: configProblems().length === 0, time: pgIso(r.now), version: serverVersion() }, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ ok: false, db: false }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
