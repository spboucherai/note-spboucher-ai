/**
 * file: tests/e2e/global-teardown.ts
 * description: after the whole run — attachments uploaded by the suites whose page was deleted by a spec's clean-up stay behind as
 *   orphans (`page_id` null), with their text in the search index: a later run then finds them « by meaning ». They are removed here,
 *   limited to the orphans created since this run started (other clients of the scratch instance keep theirs).
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import postgres from "postgres";
import "../helpers/testdb";
export default async function globalTeardown() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} }); // its own connection: the one of the helpers was closed by the global set-up
  const since = new Date(Number(process.env.E2E_STARTED ?? Date.now()));
  try {
    const ids = (await sql`select id from attachments where page_id is null and created_at >= ${since}`).map((r) => r.id as string);
    if (ids.length) { await sql`delete from chunks where source_type = 'attachment' and source_id = any(${ids}::uuid[])`; await sql`delete from index_state where source_type = 'attachment' and source_id = any(${ids}::uuid[])`; await sql`delete from attachments where id = any(${ids}::uuid[])`; await sql`delete from sync_tombstones where id = any(${ids}::uuid[])`; }
    // index entries of pages removed by a spec's clean-up (deleted in SQL, so no un-index job ran)
    await sql`delete from chunks c where c.source_type = 'page' and c.created_at >= ${since} and not exists (select 1 from pages p where p.id = c.source_id)`;
    // index entries whose attachment no longer exists (deleted by a spec's clean-up without its chunks)
    await sql`delete from chunks c where c.source_type = 'attachment' and c.created_at >= ${since} and not exists (select 1 from attachments a where a.id = c.source_id)`;
  } finally { await sql.end(); }
}
