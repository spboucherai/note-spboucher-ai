CREATE TABLE "auth_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"revoke_existing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"closed_reason" text,
	CONSTRAINT "auth_enrollments_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "inbox_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "capture_kind" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "credential_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "prev_token_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "prev_valid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD COLUMN "enrollment_id" uuid;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD COLUMN "aaguid" text;--> statement-breakpoint
ALTER TABLE "inbox_actions" ADD CONSTRAINT "inbox_actions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_actions" ADD CONSTRAINT "inbox_actions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inbox_actions_ws_idx" ON "inbox_actions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "pages_inbox_idx" ON "pages" USING btree ("workspace_id","inbox_at");--> statement-breakpoint
-- Sessions of the pre-1.1.0 login are dead weight: mark them revoked (kept for the audit trail, never deleted).
UPDATE "sessions" SET "revoked_at" = now(), "revoked_reason" = 'legacy-v1' WHERE "revoked_at" IS NULL;--> statement-breakpoint
-- Challenges are single-use and short-lived; anything left from the old flow is unusable.
DELETE FROM "webauthn_challenges";
--> statement-breakpoint
-- The owner row keeps its identity; the password hash and TOTP secret of the removed login are obsolete credential material and are blanked.
UPDATE "users" SET "password_hash" = '!', "totp_secret" = NULL, "totp_enabled" = false;
