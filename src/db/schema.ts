/**
 * Note SPBoucher AI — relational schema (Drizzle / PostgreSQL 17 + pgvector).
 * Conventions: uuid PKs, timestamptz, soft delete via deleted_at on content tables, jsonb for flexible content.
 */
import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, doublePrecision, index, uniqueIndex, customType, primaryKey, bigint } from "drizzle-orm/pg-core";
import { sql, relations as rel } from "drizzle-orm";

export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() { return "vector(1536)"; },
  toDriver(v: number[]) { return `[${v.join(",")}]`; },
  fromDriver(v: string) { return v.slice(1, -1).split(",").map(Number); },
});
const tsvector = customType<{ data: string }>({ dataType() { return "tsvector"; } });

const ts = (name?: string) => (name ? timestamp(name, { withTimezone: true, mode: "date" }) : timestamp({ withTimezone: true, mode: "date" }));
const created = () => ts().notNull().defaultNow();

// ---------- identity & auth
export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  username: text().notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  preferences: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(), updatedAt: created(),
});
export const sessions = pgTable("sessions", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  userAgent: text("user_agent"), ip: text(),
  createdAt: created(), lastSeenAt: created(),
  expiresAt: ts().notNull(), absoluteExpiresAt: ts("absolute_expires_at").notNull(),
  revokedAt: ts("revoked_at"), mfaPassed: boolean("mfa_passed").notNull().default(false),
  // v2 (passkeys): which credential opened the session, a readable device label, last user-verification time (step-up freshness)
  credentialId: text("credential_id"), label: text(), verifiedAt: ts("verified_at"), revokedReason: text("revoked_reason"),
  prevTokenHash: text("prev_token_hash"), prevValidUntil: ts("prev_valid_until"), // 60 s grace for requests in flight during a token rotation
}, (t) => [index("sessions_user_idx").on(t.userId)]);
export const loginAttempts = pgTable("login_attempts", {
  id: uuid().primaryKey().defaultRandom(),
  ip: text().notNull(), username: text(), success: boolean().notNull(), createdAt: created(),
}, (t) => [index("login_attempts_ip_idx").on(t.ip, t.createdAt)]);
export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: text().primaryKey(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(), counter: bigint({ mode: "number" }).notNull().default(0),
  transports: jsonb().$type<string[]>().default([]), deviceType: text("device_type"), backedUp: boolean("backed_up").default(false),
  label: text(), createdAt: created(), lastUsedAt: ts("last_used_at"), aaguid: text(),
});
/** One row per WebAuthn ceremony: random challenge, single use (deleted when consumed), short expiry, bound to the browser by an HttpOnly cookie holding `id`. */
export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: uuid().primaryKey().defaultRandom(), userId: uuid("user_id"), challenge: text().notNull(), kind: text().notNull(), createdAt: created(),
  expiresAt: ts("expires_at"), sessionId: uuid("session_id"), enrollmentId: uuid("enrollment_id"),
});
/** Enrollment windows opened from the node CLI only (bootstrap = first passkey, recovery = all devices lost). Only the SHA-256 of the one-time token is stored. */
export const authEnrollments = pgTable("auth_enrollments", {
  id: uuid().primaryKey().defaultRandom(), purpose: text().notNull(), // bootstrap | recovery
  tokenHash: text("token_hash").notNull().unique(), revokeExisting: boolean("revoke_existing").notNull().default(false),
  createdAt: created(), expiresAt: ts("expires_at").notNull(), consumedAt: ts("consumed_at"), closedReason: text("closed_reason"),
});
/** Replay protection for mutating API calls: same key + same session → the stored response is returned instead of running the mutation twice. */
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text().primaryKey(), sessionId: text("session_id").notNull(), method: text().notNull(), path: text().notNull(),
  status: integer(), response: jsonb(), createdAt: created(),
}, (t) => [index("idempotency_created_idx").on(t.createdAt)]);

// ---------- workspace & pages
export const workspaces = pgTable("workspaces", {
  id: uuid().primaryKey().defaultRandom(), ownerId: uuid("owner_id").notNull().references(() => users.id),
  name: text().notNull(), slug: text().notNull().unique(), settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(), updatedAt: created(),
});
export const pages = pgTable("pages", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  databaseId: uuid("database_id"), // set when the page is a row page of a database
  type: text().notNull().default("page"), // page | database | research | dashboard
  section: text().notNull().default("notes"), // notes | documents | databases | projects | research
  title: text().notNull().default("Untitled"), icon: text(), cover: text(),
  content: jsonb().$type<Record<string, unknown>>().notNull().default({ type: "doc", content: [] }),
  plainText: text("plain_text").notNull().default(""),
  tsv: tsvector("tsv").generatedAlwaysAs(sql`setweight(to_tsvector('simple', coalesce(title,'')), 'A') || setweight(to_tsvector('simple', coalesce(plain_text,'')), 'B')`),
  properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  position: doublePrecision().notNull().default(0),
  pinned: boolean().notNull().default(false), archived: boolean().notNull().default(false),
  version: integer().notNull().default(1), wordCount: integer("word_count").notNull().default(0),
  createdAt: created(), updatedAt: created(), lastOpenedAt: ts("last_opened_at"), deletedAt: ts("deleted_at"),
  rev: bigint({ mode: "number" }).notNull().default(0), // 2.1: change sequence maintained by the trigger sync_bump_rev (native clients pull "everything after rev N")
  inboxAt: ts("inbox_at"), captureKind: text("capture_kind"), // v2: non-null inbox_at = waiting in the capture inbox; note | tasks | link | photo | file | audio
}, (t) => [index("pages_inbox_idx").on(t.workspaceId, t.inboxAt), index("pages_ws_parent_idx").on(t.workspaceId, t.parentId), index("pages_tsv_idx").using("gin", t.tsv), index("pages_updated_idx").on(t.updatedAt), index("pages_db_idx").on(t.databaseId), index("pages_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`)]);
export const pageVersions = pgTable("page_versions", {
  id: uuid().primaryKey().defaultRandom(), pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  version: integer().notNull(), title: text().notNull(), content: jsonb().notNull(), properties: jsonb().default({}),
  reason: text().notNull().default("autosave"), createdAt: created(), wordCount: integer("word_count").default(0),
}, (t) => [uniqueIndex("page_versions_unique").on(t.pageId, t.version)]);

// ---------- databases
export const databases = pgTable("databases", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }), // the page that hosts the database
  name: text().notNull(), description: text(), icon: text(), isTemplate: boolean("is_template").notNull().default(false),
  templateOf: uuid("template_of"), createdAt: created(), updatedAt: created(), deletedAt: ts("deleted_at"), rev: bigint({ mode: "number" }).notNull().default(0),
});
export const databaseProperties = pgTable("database_properties", {
  id: uuid().primaryKey().defaultRandom(), databaseId: uuid("database_id").notNull().references(() => databases.id, { onDelete: "cascade" }),
  name: text().notNull(), type: text().notNull(), // text number date checkbox status select multi_select url file relation rollup formula created_time last_edited_time ai
  config: jsonb().$type<Record<string, unknown>>().notNull().default({}), position: integer().notNull().default(0), width: integer().default(180),
  createdAt: created(), rev: bigint({ mode: "number" }).notNull().default(0), workspaceId: uuid("workspace_id"), // 3.0: filled by the trigger sync_fill_workspace
}, (t) => [index("db_props_db_idx").on(t.databaseId)]);
export const databaseRows = pgTable("database_rows", {
  id: uuid().primaryKey().defaultRandom(), databaseId: uuid("database_id").notNull().references(() => databases.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  values: jsonb().$type<Record<string, unknown>>().notNull().default({}), position: doublePrecision().notNull().default(0),
  createdAt: created(), updatedAt: created(), deletedAt: ts("deleted_at"), rev: bigint({ mode: "number" }).notNull().default(0), workspaceId: uuid("workspace_id"),
}, (t) => [index("db_rows_db_idx").on(t.databaseId), index("db_rows_values_idx").using("gin", t.values), index("db_rows_db_pos_idx").on(t.databaseId, t.position, t.createdAt)]);
export const databaseViews = pgTable("database_views", {
  id: uuid().primaryKey().defaultRandom(), databaseId: uuid("database_id").notNull().references(() => databases.id, { onDelete: "cascade" }),
  name: text().notNull(), type: text().notNull().default("table"), // table board calendar gallery timeline list
  config: jsonb().$type<Record<string, unknown>>().notNull().default({}), position: integer().notNull().default(0), isDefault: boolean("is_default").notNull().default(false), createdAt: created(), rev: bigint({ mode: "number" }).notNull().default(0), workspaceId: uuid("workspace_id"),
});
export const relationsTable = pgTable("relations", {
  id: uuid().primaryKey().defaultRandom(), propertyId: uuid("property_id").notNull().references(() => databaseProperties.id, { onDelete: "cascade" }),
  fromRowId: uuid("from_row_id").notNull().references(() => databaseRows.id, { onDelete: "cascade" }), toRowId: uuid("to_row_id").notNull().references(() => databaseRows.id, { onDelete: "cascade" }),
  createdAt: created(),
}, (t) => [uniqueIndex("relations_unique").on(t.propertyId, t.fromRowId, t.toRowId), index("relations_to_idx").on(t.toRowId)]);

// ---------- attachments, tags, tasks, links
export const attachments = pgTable("attachments", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }),
  filename: text().notNull(), mime: text().notNull(), size: bigint({ mode: "number" }).notNull(), sha256: text().notNull(), storagePath: text("storage_path").notNull(),
  extractedText: text("extracted_text"), pageCount: integer("page_count"), meta: jsonb().default({}), createdAt: created(), deletedAt: ts("deleted_at"), rev: bigint({ mode: "number" }).notNull().default(0),
}, (t) => [index("attachments_page_idx").on(t.pageId), index("attachments_sha_idx").on(t.sha256)]);
export const tags = pgTable("tags", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text().notNull(), color: text().default("gray"), createdAt: created(),
}, (t) => [uniqueIndex("tags_unique").on(t.workspaceId, t.name)]);
export const pageTags = pgTable("page_tags", { pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }), tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }) }, (t) => [primaryKey({ columns: [t.pageId, t.tagId] })]);
export const tasks = pgTable("tasks", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }), title: text().notNull(), status: text().notNull().default("todo"), priority: text().default("medium"),
  dueAt: ts("due_at"), completedAt: ts("completed_at"), project: text(), createdAt: created(), updatedAt: created(), deletedAt: ts("deleted_at"), rev: bigint({ mode: "number" }).notNull().default(0), blockId: text("block_id"), // 3.0: change feed + anchor of the task in its page (taskItem block id)
}, (t) => [index("tasks_due_idx").on(t.dueAt)]);
/** Journal of inbox triage actions so each one can be undone (page state before + ids of what the action created). */
export const inboxActions = pgTable("inbox_actions", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }), action: text().notNull(),
  before: jsonb().$type<Record<string, unknown>>().notNull().default({}), created: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(), undoneAt: ts("undone_at"),
}, (t) => [index("inbox_actions_ws_idx").on(t.workspaceId, t.createdAt)]);
export const links = pgTable("links", {
  id: uuid().primaryKey().defaultRandom(), fromPageId: uuid("from_page_id").notNull().references(() => pages.id, { onDelete: "cascade" }), toPageId: uuid("to_page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  kind: text().notNull().default("link"), createdAt: created(),
}, (t) => [uniqueIndex("links_unique").on(t.fromPageId, t.toPageId, t.kind), index("links_to_idx").on(t.toPageId)]);
export const knowledgeEdges = pgTable("knowledge_edges", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  fromId: uuid("from_id").notNull(), toId: uuid("to_id").notNull(), fromType: text("from_type").notNull().default("page"), toType: text("to_type").notNull().default("page"),
  kind: text().notNull(), // link | backlink | relation | ai_suggested | concept
  status: text().notNull().default("accepted"), // suggested | accepted | rejected
  confidence: doublePrecision(), rationale: text(), model: text(), createdAt: created(), decidedAt: ts("decided_at"),
  // 3.0 (graph 2.0): typed relations. kind stays the family (link | ai_suggested | relation | cites); relType is the meaning.
  relType: text("rel_type").notNull().default("related"), origin: text().notNull().default("system"), note: text(), validFrom: ts("valid_from"), validTo: ts("valid_to"),
  sourceKind: text("source_kind").notNull().default("page"), targetKind: text("target_kind").notNull().default("page"), sourceBlockId: text("source_block_id"), targetBlockId: text("target_block_id"), updatedAt: created(), rev: bigint({ mode: "number" }).notNull().default(0),
}, (t) => [uniqueIndex("kedges_unique").on(t.fromId, t.toId, t.kind, t.relType), index("kedges_ws_idx").on(t.workspaceId, t.status)]);

/** Rows that no longer exist (permanent deletions), so that a native client that was offline learns about them. Written by triggers only. */
export const syncTombstones = pgTable("sync_tombstones", {
  id: uuid().notNull(), kind: text().notNull(), // page | attachment
  workspaceId: uuid("workspace_id").notNull(), rev: bigint({ mode: "number" }).notNull(), deletedAt: ts("deleted_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.kind, t.id] }), index("sync_tombstones_rev_idx").on(t.workspaceId, t.rev)]);

// ---------- search
export const chunks = pgTable("chunks", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(), // page | attachment | row
  sourceId: uuid("source_id").notNull(), pageId: uuid("page_id"), ordinal: integer().notNull(), blockId: text("block_id"), heading: text(),
  content: text().notNull(), tokenCount: integer("token_count").notNull().default(0), contentHash: text("content_hash").notNull(),
  tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('simple', coalesce(heading,'') || ' ' || content)`),
  createdAt: created(),
}, (t) => [index("chunks_source_idx").on(t.sourceType, t.sourceId), index("chunks_tsv_idx").using("gin", t.tsv), uniqueIndex("chunks_unique").on(t.sourceType, t.sourceId, t.ordinal)]);
export const embeddings = pgTable("embeddings", {
  chunkId: uuid("chunk_id").primaryKey().references(() => chunks.id, { onDelete: "cascade" }),
  model: text().notNull(), version: integer().notNull().default(1), embedding: vector("embedding").notNull(), createdAt: created(),
}, (t) => [index("embeddings_hnsw_idx").using("hnsw", sql`${t.embedding} vector_cosine_ops`)]);
export const indexState = pgTable("index_state", {
  sourceType: text("source_type").notNull(), sourceId: uuid("source_id").notNull(), contentHash: text("content_hash").notNull(), model: text().notNull(), version: integer().notNull().default(1), indexedAt: created(),
}, (t) => [primaryKey({ columns: [t.sourceType, t.sourceId] })]);

// ---------- AI
export const aiProviders = pgTable("ai_providers", {
  id: text().primaryKey(), name: text().notNull(), enabled: boolean().notNull().default(true), lastDiscoveryAt: ts("last_discovery_at"), status: text().default("unknown"), statusDetail: text("status_detail"),
  // NEXT-AI (0004): kind = openai | anthropic | openai_compatible ; key_env = NAME of the environment variable holding the key (never the key)
  kind: text().notNull().default("openai_compatible"), baseUrl: text("base_url"), keyEnv: text("key_env"), label: text(),
});
export const aiModels = pgTable("ai_models", {
  id: text().primaryKey(), provider: text().notNull().references(() => aiProviders.id), displayName: text("display_name"),
  category: text().notNull().default("text"), available: boolean().notNull().default(true), enabled: boolean().notNull().default(true),
  contextWindow: integer("context_window"), maxOutput: integer("max_output"),
  inputPrice: doublePrecision("input_price"), cachedPrice: doublePrecision("cached_price"), outputPrice: doublePrecision("output_price"), pricingSource: text("pricing_source"),
  probes: jsonb().$type<Record<string, { status: string; detail?: string; ms?: number }>>().default({}),
  benchmark: jsonb().$type<Record<string, unknown>>().default({}), // summary.json aggregate for this model
  capabilities: jsonb().default({}), notes: jsonb().$type<string[]>().default([]), discoveredAt: ts("discovered_at"), probedAt: ts("probed_at"), benchmarkedAt: ts("benchmarked_at"), createdAt: created(), updatedAt: created(),
  // NEXT-AI (0004): creator = who made the model (anthropic, openai, google, meta, …) ; route = provider id the calls go through
  creator: text(), route: text(),
}, (t) => [index("ai_models_provider_idx").on(t.provider)]);
export const aiConversations = pgTable("ai_conversations", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  title: text().notNull().default("New conversation"), pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }), model: text(), routing: text().default("auto"),
  pinned: boolean().notNull().default(false), createdAt: created(), updatedAt: created(), deletedAt: ts("deleted_at"),
}, (t) => [index("ai_conv_ws_idx").on(t.workspaceId, t.updatedAt)]);
export const aiMessages = pgTable("ai_messages", {
  id: uuid().primaryKey().defaultRandom(), conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  role: text().notNull(), content: text().notNull(), model: text(), provider: text(),
  sources: jsonb().$type<{ chunkId: string; pageId: string; title: string; excerpt: string; score: number }[]>().default([]),
  usage: jsonb().default({}), costUsd: doublePrecision("cost_usd"), latencyMs: integer("latency_ms"), ttftMs: integer("ttft_ms"), meta: jsonb().default({}), createdAt: created(),
}, (t) => [index("ai_msgs_conv_idx").on(t.conversationId, t.createdAt)]);
export const aiExecutions = pgTable("ai_executions", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  agent: text().notNull(), task: text().notNull(), model: text(), status: text().notNull().default("pending"), // pending running awaiting_approval approved rejected completed failed
  scopes: jsonb().$type<string[]>().notNull().default([]), toolsInvoked: jsonb("tools_invoked").$type<{ tool: string; input: unknown; output?: unknown; at: string }[]>().default([]),
  documentsAccessed: jsonb("documents_accessed").$type<string[]>().default([]), proposedChanges: jsonb("proposed_changes").$type<unknown[]>().default([]),
  approvals: jsonb().$type<{ change: number; approved: boolean; at: string }[]>().default([]), outcome: text(), result: text(), error: text(),
  costUsd: doublePrecision("cost_usd").default(0), tokensIn: integer("tokens_in").default(0), tokensOut: integer("tokens_out").default(0),
  createdAt: created(), startedAt: ts("started_at"), finishedAt: ts("finished_at"),
}, (t) => [index("ai_exec_ws_idx").on(t.workspaceId, t.createdAt)]);
export const aiUsage = pgTable("ai_usage", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id"), provider: text().notNull(), model: text().notNull(), task: text().notNull(),
  inputTokens: integer("input_tokens").notNull().default(0), outputTokens: integer("output_tokens").notNull().default(0), cachedTokens: integer("cached_tokens").default(0), reasoningTokens: integer("reasoning_tokens").default(0),
  costUsd: doublePrecision("cost_usd"), latencyMs: integer("latency_ms"), ttftMs: integer("ttft_ms"), ok: boolean().notNull().default(true), error: text(), refId: uuid("ref_id"), createdAt: created(),
}, (t) => [index("ai_usage_created_idx").on(t.createdAt)]);
export const aiComparisons = pgTable("ai_comparisons", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  prompt: text().notNull(), models: jsonb().$type<string[]>().notNull(), results: jsonb().$type<unknown[]>().notNull().default([]), createdAt: created(),
});

// ---------- NEXT-AI (migration 0004_next_ai) — one contiguous block: AI caches and logs. See docs/next/API-NEXT-AI.md.
/** Semantic zoom level 1: AI synopsis of a page, valid while `content_hash` matches the page (title + Markdown). */
export const aiSynopses = pgTable("ai_synopses", {
  pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }), level: integer().notNull().default(1),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  contentHash: text("content_hash").notNull(), synopsis: text().notNull(), model: text().notNull(), provider: text().notNull(), costUsd: doublePrecision("cost_usd"), generatedAt: ts("generated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.pageId, t.level] })]);
/** Smart inbox: validated AI suggestions for one capture, valid while `content_hash` matches. Suggestions only — nothing here is applied. */
export const inboxSuggestions = pgTable("inbox_suggestions", {
  pageId: uuid("page_id").primaryKey().references(() => pages.id, { onDelete: "cascade" }), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  contentHash: text("content_hash").notNull(), suggestions: jsonb().$type<Record<string, unknown>>().notNull().default({}), model: text().notNull(), provider: text().notNull(), costUsd: doublePrecision("cost_usd"), generatedAt: ts("generated_at").notNull().defaultNow(),
});
/** Voice notes: one transcript per audio attachment. status = pending | done | failed. transcript = [{t: seconds, text}]. */
export const audioTranscripts = pgTable("audio_transcripts", {
  attachmentId: uuid("attachment_id").primaryKey().references(() => attachments.id, { onDelete: "cascade" }), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  status: text().notNull().default("pending"), engine: text(), model: text(), language: text(), duration: doublePrecision(),
  transcript: jsonb().$type<{ t: number; text: string }[]>().notNull().default([]), text: text().notNull().default(""),
  summary: jsonb().$type<{ text: string; decisions: string[]; tasks: string[]; model: string; at: string } | null>(), wantSummary: boolean("want_summary").notNull().default(false),
  error: text(), costUsd: doublePrecision("cost_usd"), requestedAt: ts("requested_at").notNull().defaultNow(), startedAt: ts("started_at"), finishedAt: ts("finished_at"),
});
/** Smart database properties: one row per computation of an AI cell. status = queued | running | done | failed | skipped. */
export const aiPropertyRuns = pgTable("ai_property_runs", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  databaseId: uuid("database_id").notNull().references(() => databases.id, { onDelete: "cascade" }), propertyId: uuid("property_id").notNull().references(() => databaseProperties.id, { onDelete: "cascade" }),
  rowId: uuid("row_id").notNull().references(() => databaseRows.id, { onDelete: "cascade" }),
  status: text().notNull().default("queued"), trigger: text().notNull().default("manual"), task: text().notNull().default("custom"), model: text(), provider: text(),
  inputTokens: integer("input_tokens").notNull().default(0), outputTokens: integer("output_tokens").notNull().default(0), costUsd: doublePrecision("cost_usd"), outputHash: text("output_hash"), error: text(),
  createdAt: created(), startedAt: ts("started_at"), finishedAt: ts("finished_at"),
}, (t) => [index("ai_property_runs_db_idx").on(t.databaseId, t.createdAt), index("ai_property_runs_cell_idx").on(t.rowId, t.propertyId, t.createdAt)]);
// ---------- end NEXT-AI

// ---------- NEXT-P-DB (migration 0005_next_productivity): Databases Next Generation
/** Reusable presets for new rows of a database: property values (keyed by property id) + the body of the row page. */
export const databaseRowTemplates = pgTable("database_row_templates", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  databaseId: uuid("database_id").notNull().references(() => databases.id, { onDelete: "cascade" }),
  name: text().notNull(), icon: text(), values: jsonb().$type<Record<string, unknown>>().notNull().default({}), content: jsonb().$type<unknown>(),
  position: integer().notNull().default(0), isDefault: boolean("is_default").notNull().default(false), createdAt: created(), updatedAt: created(),
}, (t) => [index("db_row_templates_db_idx").on(t.databaseId, t.position)]);
/** Undo / redo journal of bulk row actions. kind = update | delete | duplicate; data holds what is needed to revert and to re-apply. */
export const databaseRowOps = pgTable("database_row_ops", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  databaseId: uuid("database_id").notNull().references(() => databases.id, { onDelete: "cascade" }),
  kind: text().notNull(), data: jsonb().$type<Record<string, unknown>>().notNull().default({}), rowCount: integer("row_count").notNull().default(0), createdAt: created(), undoneAt: ts("undone_at"),
}, (t) => [index("db_row_ops_db_idx").on(t.databaseId, t.createdAt)]);
// ---------- end NEXT-P-DB

// ---------- research
export const researchReferences = pgTable("references", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }), citeKey: text("cite_key").notNull(), entryType: text("entry_type").notNull().default("article"),
  title: text().notNull(), authors: jsonb().$type<string[]>().default([]), year: integer(), journal: text(), doi: text(), url: text(), bibtex: text(), fields: jsonb().default({}),
  verified: text().notNull().default("user"), // user | doi_verified | ai_suggested
  attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "set null" }), createdAt: created(), updatedAt: created(), deletedAt: ts("deleted_at"), rev: bigint({ mode: "number" }).notNull().default(0),
}, (t) => [uniqueIndex("references_key_unique").on(t.workspaceId, t.citeKey)]);
export const experiments = pgTable("experiments", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }), name: text().notNull(), status: text().notNull().default("planned"),
  params: jsonb().default({}), metrics: jsonb().default({}), datasetRef: text("dataset_ref"), repoUrl: text("repo_url"), notes: text(), startedAt: ts("started_at"), finishedAt: ts("finished_at"), createdAt: created(), updatedAt: created(),
});

// ---------- ops
export const auditLogs = pgTable("audit_logs", {
  id: uuid().primaryKey().defaultRandom(), userId: uuid("user_id"), action: text().notNull(), targetType: text("target_type"), targetId: text("target_id"), detail: jsonb().default({}), ip: text(), createdAt: created(),
}, (t) => [index("audit_created_idx").on(t.createdAt)]);
export const backupJobs = pgTable("backup_jobs", {
  id: uuid().primaryKey().defaultRandom(), kind: text().notNull().default("full"), status: text().notNull().default("running"), path: text(), sizeBytes: bigint("size_bytes", { mode: "number" }), sha256: text(), offsite: boolean().default(false), error: text(), startedAt: created(), finishedAt: ts("finished_at"),
});
export const dashboardLayouts = pgTable("dashboard_layouts", {
  id: uuid().primaryKey().defaultRandom(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), name: text().notNull().default("Home"),
  widgets: jsonb().$type<{ id: string; type: string; size: string; config?: Record<string, unknown> }[]>().notNull().default([]), isDefault: boolean("is_default").notNull().default(true), updatedAt: created(),
});
export const settings = pgTable("settings", { key: text().primaryKey(), value: jsonb().notNull(), updatedAt: created() });

export const pagesRelations = rel(pages, ({ many, one }) => ({ versions: many(pageVersions), tags: many(pageTags), workspace: one(workspaces, { fields: [pages.workspaceId], references: [workspaces.id] }) }));
export const databasesRelations = rel(databases, ({ many }) => ({ properties: many(databaseProperties), rows: many(databaseRows), views: many(databaseViews) }));

// ---------- 3.0 « Next Generation » (migration 0003_next_foundation): journal, concepts, insights, canvas
/** Events journal: one row per real event, written by the service layer next to the mutation (src/lib/events/service.ts). */
export const knowledgeEvents = pgTable("knowledge_events", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  at: ts().notNull().defaultNow(), kind: text().notNull(), pageId: uuid("page_id"), entityKind: text("entity_kind"), entityId: text("entity_id"),
  actor: text().notNull().default("user"), // user | agent | ai | system
  device: text(), summary: text().notNull().default(""), data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index("kevents_page_idx").on(t.pageId, t.at)]);
export const concepts = pgTable("concepts", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text().notNull(), description: text(), origin: text().notNull().default("user"), status: text().notNull().default("accepted"), model: text(),
  createdAt: created(), updatedAt: created(), decidedAt: ts("decided_at"), rev: bigint({ mode: "number" }).notNull().default(0),
});
export const pageConcepts = pgTable("page_concepts", {
  pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }), conceptId: uuid("concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
  origin: text().notNull().default("user"), status: text().notNull().default("accepted"), confidence: doublePrecision(), blockId: text("block_id"), model: text(), createdAt: created(), decidedAt: ts("decided_at"),
}, (t) => [primaryKey({ columns: [t.pageId, t.conceptId] })]);
export const knowledgeInsights = pgTable("knowledge_insights", {
  id: uuid().primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text().notNull(), // contradiction | open_question | cluster | recurring_topic | duplicate
  status: text().notNull().default("suggested"), // suggested | accepted | dismissed
  title: text().notNull(), detail: text().notNull().default(""), data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  origin: text().notNull().default("system"), model: text(), fingerprint: text(), createdAt: created(), decidedAt: ts("decided_at"),
});
export const canvases = pgTable("canvases", {
  pageId: uuid("page_id").primaryKey().references(() => pages.id, { onDelete: "cascade" }), workspaceId: uuid("workspace_id"),
  data: jsonb().$type<Record<string, unknown>>().notNull(), version: integer().notNull().default(1), rev: bigint({ mode: "number" }).notNull().default(0), createdAt: created(), updatedAt: created(),
});
