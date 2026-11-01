/** Shared (client-safe) types of the database engine. Values are keyed by property id in database_rows.values. */
export const PROPERTY_TYPES = ["title", "text", "number", "date", "checkbox", "status", "select", "multi_select", "url", "file", "relation", "rollup", "formula", "created_time", "last_edited_time", "ai"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const COMPUTED_TYPES = new Set<PropertyType>(["rollup", "formula", "created_time", "last_edited_time"]);
export const READONLY_TYPES = new Set<PropertyType>(["rollup", "formula", "created_time", "last_edited_time", "ai"]);
export const VIEW_TYPES = ["table", "board", "calendar", "gallery", "timeline", "list"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];
export const AGGREGATES = ["count", "count_values", "sum", "avg", "min", "max", "unique", "show"] as const;
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
  [k: string]: unknown;
}
export interface View { id: string; databaseId: string; name: string; type: ViewType; config: ViewConfig; position: number; isDefault: boolean }
export interface Database { id: string; pageId: string; name: string; description: string | null; icon: string | null; isTemplate: boolean; templateOf: string | null; properties: Property[]; views: View[] }
export interface RelationRef { rowId: string; pageId: string; title: string; icon?: string | null }
export interface RowOut { id: string; pageId: string; title: string; icon: string | null; values: Record<string, unknown>; position: number; createdAt: string; updatedAt: string }
export interface FileRef { id: string; url: string; name: string; mime?: string }
export interface QueryInput { viewId?: string; filter?: FilterGroup | null; sorts?: Sort[]; search?: string; limit?: number; offset?: number }
export interface QueryResult { rows: RowOut[]; total: number; limit: number; offset: number }
export interface AiPending { pending: true; at: string }
export const isError = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v && typeof (v as any).error === "string";
export const isPending = (v: unknown): v is AiPending => typeof v === "object" && v !== null && (v as any).pending === true;
