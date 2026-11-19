-- 0004_next_ai — SP Note Next Generation, AI workstream (SPEC §3.5, §4.9–§4.14). Additive only: new nullable columns on ai_providers and
-- ai_models, two seeded provider rows, five new tables. Nothing existing is renamed, retyped or dropped, and the measured routing data
-- (ai_models.probes / benchmark) is not touched. Independent of 0003 (no object of 0003 is referenced). Rollback: 0004_next_ai.down.sql.
ALTER TABLE "ai_providers" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'openai_compatible' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN IF NOT EXISTS "base_url" text;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN IF NOT EXISTS "key_env" text;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN IF NOT EXISTS "label" text;--> statement-breakpoint
UPDATE "ai_providers" SET "kind" = 'openai', "key_env" = 'OPENAI_API_KEY', "label" = 'OpenAI API' WHERE "id" = 'openai';--> statement-breakpoint
UPDATE "ai_providers" SET "kind" = 'anthropic', "key_env" = 'ANTHROPIC_API_KEY', "label" = 'Anthropic API' WHERE "id" = 'anthropic';--> statement-breakpoint
INSERT INTO "ai_providers" ("id", "name", "kind", "base_url", "key_env", "label") VALUES
  ('openai', 'OpenAI', 'openai', NULL, 'OPENAI_API_KEY', 'OpenAI API'),
  ('anthropic', 'Anthropic', 'anthropic', NULL, 'ANTHROPIC_API_KEY', 'Anthropic API'),
  ('openrouter', 'OpenRouter', 'openai_compatible', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 'OpenRouter'),
  ('maclustr', 'MacLustr LLM', 'openai_compatible', 'https://llm.spboucher.ai/v1', 'MACLUSTR_LLM_API_KEY', 'MacLustr')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "creator" text;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "route" text;--> statement-breakpoint
UPDATE "ai_models" SET "route" = "provider" WHERE "route" IS NULL;--> statement-breakpoint
UPDATE "ai_models" SET "creator" = "provider" WHERE "creator" IS NULL AND "provider" IN ('openai', 'anthropic');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_models_provider_idx" ON "ai_models" USING btree ("provider");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_synopses" (
	"page_id" uuid NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"synopsis" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"cost_usd" double precision,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_synopses_page_id_level_pk" PRIMARY KEY("page_id","level")
);--> statement-breakpoint
ALTER TABLE "ai_synopses" ADD CONSTRAINT "ai_synopses_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_synopses" ADD CONSTRAINT "ai_synopses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_suggestions" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"suggestions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"cost_usd" double precision,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "inbox_suggestions" ADD CONSTRAINT "inbox_suggestions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_suggestions" ADD CONSTRAINT "inbox_suggestions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audio_transcripts" (
	"attachment_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"engine" text,
	"model" text,
	"language" text,
	"duration" double precision,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"summary" jsonb,
	"want_summary" boolean DEFAULT false NOT NULL,
	"error" text,
	"cost_usd" double precision,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD CONSTRAINT "audio_transcripts_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD CONSTRAINT "audio_transcripts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_property_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"database_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"task" text DEFAULT 'custom' NOT NULL,
	"model" text,
	"provider" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"output_hash" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "ai_property_runs" ADD CONSTRAINT "ai_property_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_runs" ADD CONSTRAINT "ai_property_runs_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_runs" ADD CONSTRAINT "ai_property_runs_property_id_database_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."database_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_runs" ADD CONSTRAINT "ai_property_runs_row_id_database_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."database_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_property_runs_db_idx" ON "ai_property_runs" USING btree ("database_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_property_runs_cell_idx" ON "ai_property_runs" USING btree ("row_id","property_id","created_at");
