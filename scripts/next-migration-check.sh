#!/bin/bash
# Up / down / up check of migration 0003 on a throw-away COPY of the scratch database (never touches the scratch database itself,
# never production). Run from the worktree:  bash scripts/next-migration-check.sh
set -euo pipefail
export PATH=/opt/homebrew/bin:$PATH
cd "$(dirname "$0")/.."; case "$(pwd)" in */apps/note-spboucher-ai*) echo "Refusing to run inside the production directory." >&2; exit 1;; esac; set -a; . ./.env; set +a
SRC="${DATABASE_URL##*/}"; SRC="${SRC%%\?*}"; case "$SRC" in *_dev|*_test|*_scratch) ;; *) echo "Refusing: $SRC is not a scratch database." >&2; exit 1;; esac
ROLE=$(psql -d $SRC -Atc "select pg_catalog.pg_get_userbyid(datdba) from pg_database where datname='$SRC'")
C="${SRC}_migcheck_scratch"
dropdb --if-exists $C; createdb -O "$ROLE" $C
pg_dump $SRC | psql -q -d $C >/dev/null 2>&1
# back to the 0002 state if the source is already migrated
if [ "$(psql -d $C -Atc "select count(*) from drizzle.__drizzle_migrations where created_at = 1795132800000")" = "1" ]; then
  psql -q -d $C -v ON_ERROR_STOP=1 -f drizzle/0003_next_foundation.down.sql >/dev/null; psql -q -d $C -c "delete from drizzle.__drizzle_migrations where created_at = 1795132800000"; fi
psql -q -d $C -v ON_ERROR_STOP=1 <<'SQL'
delete from sync_tombstones;
insert into pages (id, workspace_id, title) select gen_random_uuid(), id, 'mig page' from workspaces limit 1;
insert into page_versions (page_id, version, title, content) select id, 1, title, content from pages where title = 'mig page' limit 1;
insert into tasks (workspace_id, title) select id, 'mig task' from workspaces limit 1;
insert into pages (id, workspace_id, title, type) select gen_random_uuid(), id, 'mig db', 'database' from workspaces limit 1;
insert into databases (workspace_id, page_id, name) select workspace_id, id, 'mig db' from pages where title = 'mig db' limit 1;
insert into database_properties (database_id, name, type) select id, 'p', 'text' from databases where name = 'mig db';
insert into database_views (database_id, name) select id, 'v' from databases where name = 'mig db';
insert into database_rows (database_id, page_id) select d.id, d.page_id from databases d where name = 'mig db';
insert into knowledge_edges (workspace_id, from_id, to_id, kind) select workspace_id, id, id, 'ai_suggested' from pages where title = 'mig page' limit 1;
insert into knowledge_edges (workspace_id, from_id, to_id, kind) select workspace_id, id, id, 'link' from pages where title = 'mig page' limit 1;
SQL
norm() { pg_dump -s --no-owner --no-privileges $C | grep -v -E '^(--|SET |SELECT pg_catalog|\\restrict|\\unrestrict|$)'; }
norm > /tmp/mig_0_before.sql
psql -d $C -Atc "select 'rows before: pages='||(select count(*) from pages)||' tasks='||(select count(*) from tasks)||' edges='||(select count(*) from knowledge_edges)||' versions='||(select count(*) from page_versions)"
DATABASE_URL="${DATABASE_URL%/*}/$C" node_modules/.bin/tsx src/db/migrate.ts
norm > /tmp/mig_1_up.sql
echo "--- after UP"
psql -d $C -At <<'SQL'
select 'events '||kind||' n='||count(*)||' backfilled='||bool_and((data->>'backfilled')::bool) from knowledge_events group by kind order by 1;
select 'pages='||(select count(*) from pages)||' page.created events='||(select count(*) from knowledge_events where kind='page.created');
select 'tasks rev>0: '||bool_and(rev>0) from tasks;
select 'db children ws+rev: '||bool_and(workspace_id is not null and rev>0) from (select workspace_id, rev from database_properties union all select workspace_id, rev from database_views union all select workspace_id, rev from database_rows) x;
select 'edge '||kind||' origin='||origin||' rel='||rel_type||' rev>0='||(rev>0) from knowledge_edges where from_id = to_id order by kind;
select 'user triggers='||count(*) from pg_trigger where not tgisinternal;
-- triggers live: insert / cascade delete
insert into database_views (database_id, name) select id, 'v2' from databases where name = 'mig db';
select 'new view ws filled='||(workspace_id is not null)||' rev>0='||(rev>0) from database_views where name='v2';
delete from pages where title = 'mig db';
select 'tombstones after cascade: '||string_agg(kind||'='||n, ', ' order by kind) from (select kind, count(*) n from sync_tombstones group by kind) t;
SQL
echo "--- DOWN"
psql -q -d $C -v ON_ERROR_STOP=1 -f drizzle/0003_next_foundation.down.sql
psql -q -d $C -c "delete from drizzle.__drizzle_migrations where created_at = 1795132800000"
norm > /tmp/mig_2_down.sql
if diff -q /tmp/mig_0_before.sql /tmp/mig_2_down.sql >/dev/null; then echo "schema after DOWN == schema before UP (pg_dump -s identical, $(wc -l < /tmp/mig_0_before.sql) lines)"; else echo "SCHEMA DIFF:"; diff /tmp/mig_0_before.sql /tmp/mig_2_down.sql | head -40; fi
psql -d $C -Atc "select 'rows after down: pages='||(select count(*) from pages)||' tasks='||(select count(*) from tasks)||' edges='||(select count(*) from knowledge_edges)||' versions='||(select count(*) from page_versions)||' tombstone kinds='||coalesce((select string_agg(distinct kind, ',') from sync_tombstones),'none')"
echo "--- UP again (re-apply after a rollback)"
DATABASE_URL="${DATABASE_URL%/*}/$C" node_modules/.bin/tsx src/db/migrate.ts
norm > /tmp/mig_3_up2.sql
diff -q /tmp/mig_1_up.sql /tmp/mig_3_up2.sql >/dev/null && echo "schema after 2nd UP == schema after 1st UP" || { echo "UP DIFF"; diff /tmp/mig_1_up.sql /tmp/mig_3_up2.sql | head -20; }
dropdb $C; echo "copy dropped"
