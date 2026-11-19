-- Rollback of 0004_next_ai (schema only; then delete the migration row:
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795219200000;)
-- Removes the AI caches and logs added by 0004 (synopses, inbox suggestions, transcripts, AI-property run log) and the provider/creator
-- columns. Models that belong to the two providers seeded by 0004 are removed first (FK ai_models.provider → ai_providers.id); usage
-- rows (ai_usage) keep their provider/model text and are untouched. Pages, attachments, databases and their rows are not modified:
-- a transcript already written into an `audio` node by the editor stays in the page.
BEGIN;
DROP TABLE IF EXISTS "ai_property_runs";
DROP TABLE IF EXISTS "audio_transcripts";
DROP TABLE IF EXISTS "inbox_suggestions";
DROP TABLE IF EXISTS "ai_synopses";
DROP INDEX IF EXISTS "ai_models_provider_idx";
DELETE FROM "ai_models" WHERE "provider" IN (SELECT "id" FROM "ai_providers" WHERE "kind" = 'openai_compatible');
DELETE FROM "ai_providers" WHERE "kind" = 'openai_compatible';
ALTER TABLE "ai_models" DROP COLUMN IF EXISTS "route";
ALTER TABLE "ai_models" DROP COLUMN IF EXISTS "creator";
ALTER TABLE "ai_providers" DROP COLUMN IF EXISTS "label";
ALTER TABLE "ai_providers" DROP COLUMN IF EXISTS "key_env";
ALTER TABLE "ai_providers" DROP COLUMN IF EXISTS "base_url";
ALTER TABLE "ai_providers" DROP COLUMN IF EXISTS "kind";
COMMIT;
