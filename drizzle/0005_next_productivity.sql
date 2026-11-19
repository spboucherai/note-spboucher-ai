-- 0005_next_productivity — SP Note Next Generation, productivity workstream (Databases Next Generation). Additive only: two new tables
-- and one index. Nothing existing is renamed, retyped or dropped; no existing row is modified. Independent of 0003 / 0004 except for the
-- tables they extend by reference (databases, workspaces). Rollback: 0005_next_productivity.down.sql.
--   database_row_templates  reusable presets for new rows (values + page body), per database
--   database_row_ops        undo / redo journal of bulk row actions (edit, delete, duplicate); rows older than 7 days are purged by the app
--   db_rows_db_pos_idx      (database_id, position, created_at): the default order of a database, read window by window by the SQL engine
CREATE TABLE IF NOT EXISTS "database_row_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"database_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "database_row_templates" ADD CONSTRAINT "database_row_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_row_templates" ADD CONSTRAINT "database_row_templates_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "db_row_templates_db_idx" ON "database_row_templates" USING btree ("database_id","position");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "database_row_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"database_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "database_row_ops" ADD CONSTRAINT "database_row_ops_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_row_ops" ADD CONSTRAINT "database_row_ops_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "db_row_ops_db_idx" ON "database_row_ops" USING btree ("database_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "db_rows_db_pos_idx" ON "database_rows" USING btree ("database_id","position","created_at");
