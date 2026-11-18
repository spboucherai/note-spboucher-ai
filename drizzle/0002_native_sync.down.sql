-- Rollback of 0002_native_sync (schema only; then delete the migration row:
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795046400000;)
-- Content tables are untouched: only the change-feed bookkeeping (rev columns, tombstones, triggers) is removed. Native clients then
-- cannot synchronise until the migration is applied again; nothing they hold locally is lost.
BEGIN;
DROP TRIGGER IF EXISTS page_tags_sync_touch ON "page_tags";
DROP TRIGGER IF EXISTS attachments_sync_tombstone ON "attachments";
DROP TRIGGER IF EXISTS pages_sync_tombstone ON "pages";
DROP TRIGGER IF EXISTS attachments_sync_rev ON "attachments";
DROP TRIGGER IF EXISTS pages_sync_rev ON "pages";
DROP FUNCTION IF EXISTS sync_touch_page_tags();
DROP FUNCTION IF EXISTS sync_tombstone();
DROP FUNCTION IF EXISTS sync_bump_rev();
DROP TABLE IF EXISTS "sync_tombstones";
DROP INDEX IF EXISTS "pages_rev_idx";
DROP INDEX IF EXISTS "attachments_rev_idx";
ALTER TABLE "pages" DROP COLUMN IF EXISTS "rev";
ALTER TABLE "attachments" DROP COLUMN IF EXISTS "rev";
DROP SEQUENCE IF EXISTS "sync_rev_seq";
COMMIT;
