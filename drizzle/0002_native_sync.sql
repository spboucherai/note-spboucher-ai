-- 0002_native_sync — change feed for native clients (SP Notes macOS / iOS). Additive: one column on pages and attachments, one table,
-- one sequence, three trigger functions. Every write to a page or an attachment, whatever code path made it (editor save, import, agent,
-- inbox triage, trash, restore, tags), gets the next value of one workspace-wide sequence; permanent deletions leave a tombstone.
-- The sequence is taken under a transaction-level advisory lock, so revisions become visible in commit order: a client that has seen
-- revision N has seen every change numbered ≤ N. Rollback: 0002_native_sync.down.sql.
CREATE SEQUENCE IF NOT EXISTS "sync_rev_seq" AS bigint;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE "sync_tombstones" (
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rev" bigint NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_tombstones_kind_id_pk" PRIMARY KEY("kind","id")
);--> statement-breakpoint
UPDATE "pages" SET "rev" = nextval('sync_rev_seq');--> statement-breakpoint
UPDATE "attachments" SET "rev" = nextval('sync_rev_seq');--> statement-breakpoint
CREATE INDEX "pages_rev_idx" ON "pages" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE INDEX "attachments_rev_idx" ON "attachments" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE INDEX "sync_tombstones_rev_idx" ON "sync_tombstones" USING btree ("workspace_id","rev");--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_bump_rev() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- opening a note (last_opened_at) is not a change; a caller that sets rev itself (tag trigger below) is respected
    IF (to_jsonb(NEW) - 'last_opened_at' - 'rev' - 'tsv') = (to_jsonb(OLD) - 'last_opened_at' - 'rev' - 'tsv') THEN RETURN NEW; END IF;
  ELSE
    DELETE FROM sync_tombstones WHERE kind = TG_ARGV[0] AND id = NEW.id;
  END IF;
  PERFORM pg_advisory_xact_lock(778201);
  NEW.rev := nextval('sync_rev_seq');
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_tombstone() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(778201);
  INSERT INTO sync_tombstones (id, kind, workspace_id, rev) VALUES (OLD.id, TG_ARGV[0], OLD.workspace_id, nextval('sync_rev_seq'))
    ON CONFLICT (kind, id) DO UPDATE SET rev = excluded.rev, deleted_at = now();
  RETURN OLD;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_touch_page_tags() RETURNS trigger AS $$
DECLARE pid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN pid := OLD.page_id; ELSE pid := NEW.page_id; END IF;
  PERFORM pg_advisory_xact_lock(778201);
  UPDATE pages SET rev = nextval('sync_rev_seq') WHERE id = pid;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER pages_sync_rev BEFORE INSERT OR UPDATE ON "pages" FOR EACH ROW EXECUTE FUNCTION sync_bump_rev('page');--> statement-breakpoint
CREATE TRIGGER attachments_sync_rev BEFORE INSERT OR UPDATE ON "attachments" FOR EACH ROW EXECUTE FUNCTION sync_bump_rev('attachment');--> statement-breakpoint
CREATE TRIGGER pages_sync_tombstone AFTER DELETE ON "pages" FOR EACH ROW EXECUTE FUNCTION sync_tombstone('page');--> statement-breakpoint
CREATE TRIGGER attachments_sync_tombstone AFTER DELETE ON "attachments" FOR EACH ROW EXECUTE FUNCTION sync_tombstone('attachment');--> statement-breakpoint
CREATE TRIGGER page_tags_sync_touch AFTER INSERT OR DELETE ON "page_tags" FOR EACH ROW EXECUTE FUNCTION sync_touch_page_tags();
