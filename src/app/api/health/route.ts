import { sql } from "@/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try { const [r] = await sql`select now() as now, (select count(*) from pg_extension where extname='vector') as vec`; return Response.json({ ok: true, db: true, pgvector: Number(r.vec) > 0, time: r.now, version: process.env.APP_VERSION ?? "dev" }); }
  catch (e: any) { return Response.json({ ok: false, db: false, error: e.message }, { status: 503 }); }
}
