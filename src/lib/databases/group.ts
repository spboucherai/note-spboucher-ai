/**
 * File: src/lib/databases/group.ts
 * Description: grouping keys shared by the SQL engine, its JavaScript fallback and the client (client-safe). A database can be grouped
 *   by a select, status or checkbox property; the key of a row is the option id, "true" / "false", or "__none" (no value, or a value
 *   that is no longer an option). Groups follow the option order, "no value" last.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import type { Property, OptionColor } from "./types";
export const GROUPABLE = new Set<string>(["select", "status", "checkbox"]);
export const NONE = "__none";
export function groupKeyOf(p: Property, v: unknown): string {
  if (p.type === "checkbox") return v != null && v !== false && v !== "" && v !== 0 ? "true" : "false";
  return typeof v === "string" && (p.config.options ?? []).some((o) => o.id === v) ? v : NONE;
}
export function groupOrder(p: Property, key: string): number {
  if (p.type === "checkbox") return key === "true" ? 1 : 0;
  const i = (p.config.options ?? []).findIndex((o) => o.id === key); return i >= 0 ? i + 1 : (p.config.options ?? []).length + 1;
}
export interface GroupMeta { key: string; label: string; color: OptionColor; value: unknown }
/** Every possible group of a property, in display order (empty ones included: a board shows a column per option). */
export function groupMetas(p: Property): GroupMeta[] {
  if (p.type === "checkbox") return [{ key: "false", label: "Unchecked", color: "gray", value: false }, { key: "true", label: "Checked", color: "green", value: true }];
  return [...(p.config.options ?? []).map((o): GroupMeta => ({ key: o.id, label: o.name, color: o.color, value: o.id })), { key: NONE, label: `No ${p.name}`, color: "gray", value: null }];
}
