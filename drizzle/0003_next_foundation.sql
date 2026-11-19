-- 0003_next_foundation — SP Note Next Generation, data foundation (SPEC §3.1–§3.4). Additive only. Rollback: 0003_next_foundation.down.sql.
--
--  1. Entity change feed: `rev` + the 0002 triggers (sync_bump_rev / sync_tombstone, unchanged) extended to tasks, databases,
--     database_properties, database_views, database_rows, knowledge_edges, references, concepts; canvases get their own pair of
--     trigger functions because their key is page_id. The three database child tables and canvases have no workspace column of their
--     own: a nullable `workspace_id` is added and filled by a BEFORE INSERT trigger from the parent row, so that (a) the feed is one
--     indexed range scan per table and (b) a tombstone can still name the workspace when the parent was deleted by a cascade.
--  2. Events journal `knowledge_events`, back-filled ONLY with page.created (pages.created_at) and page.version (page_versions),
--     both flagged data.backfilled = true.
--  3. Knowledge graph 2.0: typed relations on knowledge_edges, concepts, page_concepts, knowledge_insights.
--  4. Canvas: one row per page of type 'canvas'.
--  5. tasks.block_id (anchor of a task in a document).
ALTER TABLE "tasks" ADD COLUMN "rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "block_id" text;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "database_properties" ADD COLUMN "rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "database_properties" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "database_views" ADD COLUMN "rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "database_views" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "database_rows" ADD COLUMN "rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "database_rows" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "references" ADD COLUMN "rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "rel_type" text DEFAULT 'related' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "origin" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "valid_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "valid_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "source_kind" text DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "target_kind" text DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "source_block_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "target_block_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "knowledge_edges" SET "origin" = 'ai' WHERE "kind" = 'ai_suggested';--> statement-breakpoint
-- several typed relations may join the same two nodes (A supports B, A extends B): the type becomes part of the uniqueness
DROP INDEX IF EXISTS "kedges_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "kedges_unique" ON "knowledge_edges" USING btree ("from_id","to_id","kind","rel_type");--> statement-breakpoint
CREATE INDEX "kedges_to_idx" ON "knowledge_edges" USING btree ("to_id");--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"origin" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"rev" bigint DEFAULT 0 NOT NULL
);--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_name_unique" ON "concepts" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE TABLE "page_concepts" (
	"page_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"confidence" double precision,
	"block_id" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "page_concepts_page_id_concept_id_pk" PRIMARY KEY("page_id","concept_id")
);--> statement-breakpoint
ALTER TABLE "page_concepts" ADD CONSTRAINT "page_concepts_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_concepts" ADD CONSTRAINT "page_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_concepts_concept_idx" ON "page_concepts" USING btree ("concept_id");--> statement-breakpoint
CREATE TABLE "knowledge_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin" text DEFAULT 'system' NOT NULL,
	"model" text,
	"fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "knowledge_insights" ADD CONSTRAINT "knowledge_insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kinsights_ws_idx" ON "knowledge_insights" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kinsights_fingerprint_unique" ON "knowledge_insights" USING btree ("workspace_id","fingerprint");--> statement-breakpoint
CREATE TABLE "canvases" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"data" jsonb DEFAULT '{"format":"spn-canvas-1","nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"rev" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "knowledge_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"page_id" uuid,
	"entity_kind" text,
	"entity_id" text,
	"actor" text DEFAULT 'user' NOT NULL,
	"device" text,
	"summary" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);--> statement-breakpoint
ALTER TABLE "knowledge_events" ADD CONSTRAINT "knowledge_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kevents_ws_at_idx" ON "knowledge_events" USING btree ("workspace_id","at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "kevents_page_idx" ON "knowledge_events" USING btree ("page_id","at" DESC);--> statement-breakpoint
CREATE INDEX "kevents_kind_idx" ON "knowledge_events" USING btree ("workspace_id","kind","at" DESC);--> statement-breakpoint
-- workspace of the child rows that have none of their own
UPDATE "database_properties" x SET "workspace_id" = d."workspace_id" FROM "databases" d WHERE d."id" = x."database_id";--> statement-breakpoint
UPDATE "database_views" x SET "workspace_id" = d."workspace_id" FROM "databases" d WHERE d."id" = x."database_id";--> statement-breakpoint
UPDATE "database_rows" x SET "workspace_id" = d."workspace_id" FROM "databases" d WHERE d."id" = x."database_id";--> statement-breakpoint
-- every existing row enters the feed once
UPDATE "tasks" SET "rev" = nextval('sync_rev_seq');--> statement-breakpoint
UPDATE "databases" SET "rev" = nextval('sync_rev_seq');--> statement-breakpoint
UPDATE "database_properties" SET "rev" = nextval('sync_rev_seq');--> statement-breakpoint
UPDATE "database_views" SET "rev" = nextval('sync_rev_seq');--> statement-breakpoint
UPDATE "database_rows" SET "rev" = nextval('sync_rev_seq');--> statement-breakpoint
UPDATE "references" SET "rev" = nextval('sync_rev_seq');--> statement-breakpoint
UPDATE "knowledge_edges" SET "rev" = nextval('sync_rev_seq');--> statement-breakpoint
CREATE INDEX "tasks_rev_idx" ON "tasks" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE INDEX "databases_rev_idx" ON "databases" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE INDEX "db_props_rev_idx" ON "database_properties" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE INDEX "db_views_rev_idx" ON "database_views" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE INDEX "db_rows_rev_idx" ON "database_rows" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE INDEX "references_rev_idx" ON "references" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE INDEX "kedges_rev_idx" ON "knowledge_edges" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE INDEX "concepts_rev_idx" ON "concepts" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE INDEX "canvases_rev_idx" ON "canvases" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE INDEX "tasks_page_idx" ON "tasks" USING btree ("page_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_fill_workspace() RETURNS trigger AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    IF TG_ARGV[0] = 'database' THEN SELECT d.workspace_id INTO NEW.workspace_id FROM databases d WHERE d.id = NEW.database_id;
    ELSE SELECT p.workspace_id INTO NEW.workspace_id FROM pages p WHERE p.id = NEW.page_id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
-- canvases are keyed by page_id: same rules as sync_bump_rev / sync_tombstone, with that key
CREATE OR REPLACE FUNCTION sync_bump_rev_canvas() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'rev') = (to_jsonb(OLD) - 'rev') THEN RETURN NEW; END IF;
  ELSE
    DELETE FROM sync_tombstones WHERE kind = 'canvas' AND id = NEW.page_id;
  END IF;
  PERFORM pg_advisory_xact_lock(778201);
  NEW.rev := nextval('sync_rev_seq');
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_tombstone_canvas() RETURNS trigger AS $$
BEGIN
  IF OLD.workspace_id IS NULL THEN RETURN OLD; END IF;
  PERFORM pg_advisory_xact_lock(778201);
  INSERT INTO sync_tombstones (id, kind, workspace_id, rev) VALUES (OLD.page_id, 'canvas', OLD.workspace_id, nextval('sync_rev_seq'))
    ON CONFLICT (kind, id) DO UPDATE SET rev = excluded.rev, deleted_at = now();
  RETURN OLD;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER db_props_fill_ws BEFORE INSERT ON "database_properties" FOR EACH ROW EXECUTE FUNCTION sync_fill_workspace('database');--> statement-breakpoint
CREATE TRIGGER db_views_fill_ws BEFORE INSERT ON "database_views" FOR EACH ROW EXECUTE FUNCTION sync_fill_workspace('database');--> statement-breakpoint
CREATE TRIGGER db_rows_fill_ws BEFORE INSERT ON "database_rows" FOR EACH ROW EXECUTE FUNCTION sync_fill_workspace('database');--> statement-breakpoint
CREATE TRIGGER canvases_fill_ws BEFORE INSERT ON "canvases" FOR EACH ROW EXECUTE FUNCTION sync_fill_workspace('page');--> statement-breakpoint
CREATE TRIGGER tasks_sync_rev BEFORE INSERT OR UPDATE ON "tasks" FOR EACH ROW EXECUTE FUNCTION sync_bump_rev('task');--> statement-breakpoint
CREATE TRIGGER databases_sync_rev BEFORE INSERT OR UPDATE ON "databases" FOR EACH ROW EXECUTE FUNCTION sync_bump_rev('database');--> statement-breakpoint
CREATE TRIGGER db_props_sync_rev BEFORE INSERT OR UPDATE ON "database_properties" FOR EACH ROW EXECUTE FUNCTION sync_bump_rev('database_property');--> statement-breakpoint
CREATE TRIGGER db_views_sync_rev BEFORE INSERT OR UPDATE ON "database_views" FOR EACH ROW EXECUTE FUNCTION sync_bump_rev('database_view');--> statement-breakpoint
CREATE TRIGGER db_rows_sync_rev BEFORE INSERT OR UPDATE ON "database_rows" FOR EACH ROW EXECUTE FUNCTION sync_bump_rev('database_row');--> statement-breakpoint
CREATE TRIGGER references_sync_rev BEFORE INSERT OR UPDATE ON "references" FOR EACH ROW EXECUTE FUNCTION sync_bump_rev('reference');--> statement-breakpoint
CREATE TRIGGER kedges_sync_rev BEFORE INSERT OR UPDATE ON "knowledge_edges" FOR EACH ROW EXECUTE FUNCTION sync_bump_rev('edge');--> statement-breakpoint
CREATE TRIGGER concepts_sync_rev BEFORE INSERT OR UPDATE ON "concepts" FOR EACH ROW EXECUTE FUNCTION sync_bump_rev('concept');--> statement-breakpoint
CREATE TRIGGER canvases_sync_rev BEFORE INSERT OR UPDATE ON "canvases" FOR EACH ROW EXECUTE FUNCTION sync_bump_rev_canvas();--> statement-breakpoint
CREATE TRIGGER tasks_sync_tombstone AFTER DELETE ON "tasks" FOR EACH ROW EXECUTE FUNCTION sync_tombstone('task');--> statement-breakpoint
CREATE TRIGGER databases_sync_tombstone AFTER DELETE ON "databases" FOR EACH ROW EXECUTE FUNCTION sync_tombstone('database');--> statement-breakpoint
CREATE TRIGGER db_props_sync_tombstone AFTER DELETE ON "database_properties" FOR EACH ROW WHEN (OLD.workspace_id IS NOT NULL) EXECUTE FUNCTION sync_tombstone('database_property');--> statement-breakpoint
CREATE TRIGGER db_views_sync_tombstone AFTER DELETE ON "database_views" FOR EACH ROW WHEN (OLD.workspace_id IS NOT NULL) EXECUTE FUNCTION sync_tombstone('database_view');--> statement-breakpoint
CREATE TRIGGER db_rows_sync_tombstone AFTER DELETE ON "database_rows" FOR EACH ROW WHEN (OLD.workspace_id IS NOT NULL) EXECUTE FUNCTION sync_tombstone('database_row');--> statement-breakpoint
CREATE TRIGGER references_sync_tombstone AFTER DELETE ON "references" FOR EACH ROW EXECUTE FUNCTION sync_tombstone('reference');--> statement-breakpoint
CREATE TRIGGER kedges_sync_tombstone AFTER DELETE ON "knowledge_edges" FOR EACH ROW EXECUTE FUNCTION sync_tombstone('edge');--> statement-breakpoint
CREATE TRIGGER concepts_sync_tombstone AFTER DELETE ON "concepts" FOR EACH ROW EXECUTE FUNCTION sync_tombstone('concept');--> statement-breakpoint
CREATE TRIGGER canvases_sync_tombstone AFTER DELETE ON "canvases" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_canvas();--> statement-breakpoint
-- the only two back-fills of the journal (SPEC §3.2); everything else is recorded from now on, as it happens
INSERT INTO "knowledge_events" ("workspace_id","at","kind","page_id","entity_kind","entity_id","actor","summary","data")
  SELECT p."workspace_id", p."created_at", 'page.created', p."id", 'page', p."id"::text, 'system', p."title", jsonb_build_object('backfilled', true, 'section', p."section", 'type', p."type") FROM "pages" p;--> statement-breakpoint
INSERT INTO "knowledge_events" ("workspace_id","at","kind","page_id","entity_kind","entity_id","actor","summary","data")
  SELECT p."workspace_id", v."created_at", 'page.version', v."page_id", 'page_version', v."id"::text, 'system', v."title", jsonb_build_object('backfilled', true, 'version', v."version", 'reason', v."reason") FROM "page_versions" v JOIN "pages" p ON p."id" = v."page_id";
