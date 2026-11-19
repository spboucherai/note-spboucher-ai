-- Rollback of 0005_next_productivity (schema only; then delete the migration row:
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795305600000;)
-- Removes the row templates and the bulk-action undo journal added by 0005, and the default-order index. Databases, properties, views,
-- rows and pages are not modified: rows created from a template keep their values and body; a bulk action already applied stays applied
-- (only the possibility to undo it is lost).
BEGIN;
DROP INDEX IF EXISTS "db_rows_db_pos_idx";
DROP TABLE IF EXISTS "database_row_ops";
DROP TABLE IF EXISTS "database_row_templates";
COMMIT;
