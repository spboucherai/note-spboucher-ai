/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/databases/types.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

/** Shared (client-safe) types of the database engine. Values are keyed by property id in database_rows.values. */
export const PROPERTY_TYPES = ["title", "text", "number", "date", "checkbox", "status", "select", "multi_select", "url", "file", "relation", "rollup", "formula", "created_time", "last_edited_time", "ai"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const COMPUTED_TYPES = new Set<PropertyType>(["rollup", "formula", "created_time", "last_edited_time"]);
export const READONLY_TYPES = new Set<PropertyType>(["rollup", "formula", "created_time", "last_edited_time", "ai"]);
export const VIEW_TYPES = ["table", "board", "calendar", "gallery", "timeline", "list"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];
/** Rollup aggregates. 3.0 adds (additive): count_unique, empty, not_empty, percent_empty, percent_not_empty, checked, unchecked, percent_checked, percent_unchecked, median, range. */
export const AGGREGATES = ["count", "count_values", "sum", "avg", "min", "max", "unique", "show", "count_unique", "empty", "not_empty", "percent_empty", "percent_not_empty", "checked", "unchecked", "percent_checked", "percent_unchecked", "median", "range"] as const;
export type Aggregate = (typeof AGGREGATES)[number];
export const OPTION_COLORS = ["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink", "teal"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];
export type StatusGroup = "todo" | "in_progress" | "done";

export interface SelectOption { id: string; name: string; color: OptionColor; group?: StatusGroup }
export interface PropertyConfig {
  options?: SelectOption[];
  format?: "number" | "integer" | "percent" | "currency";
  includeTime?: boolean;
  targetDatabaseId?: string; syncedPropertyId?: string; twoWay?: boolean; single?: boolean;
  relationPropertyId?: string; targetPropertyId?: string; aggregate?: Aggregate;
  expression?: string;
  prompt?: string;
  [k: string]: unknown;
}
export interface Property { id: string; databaseId: string; name: string; type: PropertyType; config: PropertyConfig; position: number; width: number | null }

export const FILTER_OPS = ["eq", "neq", "contains", "not_contains", "starts_with", "ends_with", "empty", "not_empty", "gt", "gte", "lt", "lte", "before", "after", "on"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export interface FilterRule { property: string; op: FilterOp; value?: unknown }
export interface FilterGroup { and?: FilterNode[]; or?: FilterNode[] }
export type FilterNode = FilterRule | FilterGroup;
export const isGroup = (n: FilterNode): n is FilterGroup => !("property" in n);
export interface Sort { property: string; dir: "asc" | "desc" }
export interface ViewConfig {
  filter?: FilterGroup | null; sorts?: Sort[]; groupBy?: string | null; hidden?: string[]; order?: string[]; widths?: Record<string, number>;
  dateProperty?: string | null; startProperty?: string | null; endProperty?: string | null; coverProperty?: string | null; scale?: "week" | "month";
  /** 3.0 (additive, per view): collapsed group keys; gallery cover source ("page" = the page cover image, "none", or a file property through coverProperty), card size, cover fit, properties shown on cards; column footer aggregate per property. */
  collapsed?: string[]; cover?: "property" | "page" | "none"; cardSize?: "small" | "medium" | "large"; coverFit?: "cover" | "contain"; cardProps?: string[]; footers?: Record<string, string>;
  [k: string]: unknown;
}
export interface View { id: string; databaseId: string; name: string; type: ViewType; config: ViewConfig; position: number; isDefault: boolean }
export interface Database { id: string; pageId: string; name: string; description: string | null; icon: string | null; isTemplate: boolean; templateOf: string | null; properties: Property[]; views: View[] }
export interface RelationRef { rowId: string; pageId: string; title: string; icon?: string | null }
export interface RowOut { id: string; pageId: string; title: string; icon: string | null; values: Record<string, unknown>; position: number; createdAt: string; updatedAt: string; cover?: string | null }
export interface FileRef { id: string; url: string; name: string; mime?: string }
/** 3.0 additive inputs: `extraFilter` (ANDed with the filter: date window of a calendar, one board column…), `groupBy` (property id: rows ordered by group first, `groups` returned), `aggregates`. */
export interface QueryInput { viewId?: string; filter?: FilterGroup | null; extraFilter?: FilterGroup | null; sorts?: Sort[]; search?: string; limit?: number; offset?: number; groupBy?: string | null; aggregates?: boolean; /** with groupBy: keep the group-first order but skip the per-group counts (windows after the first one) */ skipGroups?: boolean }
export interface NumAgg { sum: number; avg: number; min: number; max: number; count: number }
/** One group of the whole result: `offset` = index of its first row in the returned order. Keys: option id, "true" / "false", or "__none". */
export interface GroupOut { key: string; count: number; offset: number; aggregates: Record<string, NumAgg> }
/** `rows, total, limit, offset` are the 2.x shape; the other fields are additive (3.0). */
export interface QueryResult { rows: RowOut[]; total: number; limit: number; offset: number; engine?: "sql" | "js"; fallback?: string[]; hasMore?: boolean; groups?: GroupOut[]; aggregates?: Record<string, NumAgg> }
/** A reusable preset for new rows (table database_row_templates). */
export interface RowTemplate { id: string; databaseId: string; name: string; icon: string | null; values: Record<string, unknown>; content: unknown | null; position: number; isDefault: boolean; createdAt: string; updatedAt: string }
export interface AiPending { pending: true; at: string }
export const isError = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v && typeof (v as any).error === "string";
export const isPending = (v: unknown): v is AiPending => typeof v === "object" && v !== null && (v as any).pending === true;
