-- Rollback of 0001_v2_passkeys_inbox (schema only; run inside a transaction, then delete the migration row:
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794934314619;)
-- Content tables are untouched; pages.inbox_at / capture_kind are dropped, so pages still waiting in the inbox simply become ordinary notes.
BEGIN;
DROP TABLE IF EXISTS "inbox_actions";
DROP TABLE IF EXISTS "idempotency_keys";
DROP TABLE IF EXISTS "auth_enrollments";
DROP INDEX IF EXISTS "pages_inbox_idx";
ALTER TABLE "pages" DROP COLUMN IF EXISTS "inbox_at", DROP COLUMN IF EXISTS "capture_kind";
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "credential_id", DROP COLUMN IF EXISTS "label", DROP COLUMN IF EXISTS "verified_at", DROP COLUMN IF EXISTS "revoked_reason", DROP COLUMN IF EXISTS "prev_token_hash", DROP COLUMN IF EXISTS "prev_valid_until";
ALTER TABLE "webauthn_challenges" DROP COLUMN IF EXISTS "expires_at", DROP COLUMN IF EXISTS "session_id", DROP COLUMN IF EXISTS "enrollment_id";
ALTER TABLE "webauthn_credentials" DROP COLUMN IF EXISTS "aaguid";
COMMIT;
