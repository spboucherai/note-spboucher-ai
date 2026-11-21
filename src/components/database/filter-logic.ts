/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/filter-logic.ts
 * Description      : pure logic of the filter builder (no React): operators
 *                    offered per property family, the reason a rule cannot be
 *                    saved yet, and the saveable part of a draft. Mirrors the
 *                    server validation (`validateFilter`), plus "the value is
 *                    missing".
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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

import type { Property, FilterGroup, FilterNode, FilterRule, FilterOp } from "@/lib/databases/types";
import { isGroup } from "@/lib/databases/types";
import { numberOf } from "@/lib/databases/values";

export const OPS: Record<string, [FilterOp, string][]> = {
  text: [["contains", "contains"], ["not_contains", "does not contain"], ["eq", "is"], ["neq", "is not"], ["starts_with", "starts with"], ["ends_with", "ends with"], ["empty", "is empty"], ["not_empty", "is not empty"]],
  number: [["eq", "="], ["neq", "≠"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["empty", "is empty"], ["not_empty", "is not empty"]],
  date: [["on", "is"], ["before", "is before"], ["after", "is after"], ["gte", "is on or after"], ["lte", "is on or before"], ["empty", "is empty"], ["not_empty", "is not empty"]],
  checkbox: [["eq", "is"]], select: [["eq", "is"], ["neq", "is not"], ["empty", "is empty"], ["not_empty", "is not empty"]], multi: [["contains", "contains"], ["not_contains", "does not contain"], ["empty", "is empty"], ["not_empty", "is not empty"]], file: [["empty", "is empty"], ["not_empty", "is not empty"]],
};
export const kind = (p?: Property) => !p ? "text" : ["number", "rollup"].includes(p.type) ? "number" : ["date", "created_time", "last_edited_time"].includes(p.type) ? "date" : p.type === "checkbox" ? "checkbox" : ["select", "status"].includes(p.type) ? "select" : p.type === "multi_select" ? "multi" : p.type === "relation" ? "multi" : p.type === "file" ? "file" : "text";
export const describeFilter = (f: FilterGroup | null | undefined): number => !f ? 0 : (f.and ?? f.or ?? []).reduce((n, x) => n + (isGroup(x) ? describeFilter(x) : 1), 0);
export const MAX_DEPTH = 2; // root + two nested levels
export const NO_VALUE = new Set<FilterOp>(["empty", "not_empty"]);
/** Why a rule cannot be saved yet, or null. (Client-side mirror of the server validation, plus "the value is missing".) */
export function ruleProblem(r: FilterRule, props: Property[]): string | null {
  const p = props.find((x) => x.id === r.property); if (!p) return "This property no longer exists";
  const k = kind(p); if (!OPS[k].some(([op]) => op === r.op)) return "Choose a condition";
  if (NO_VALUE.has(r.op) || k === "checkbox") return null;
  if (r.value == null || r.value === "") return "Enter a value";
  if (k === "number" && numberOf(r.value) == null) return "Not a number";
  if (k === "date" && r.value !== "today" && Number.isNaN(Date.parse(String(r.value)))) return "Not a date";
  return null;
}
/** The part of a draft that can be saved: complete rules only, empty groups dropped. Null when nothing is left. */
export function validFilter(g: FilterGroup, props: Property[]): FilterGroup | null {
  const key = g.or ? "or" : "and"; const items: FilterNode[] = [];
  for (const n of (g.or ?? g.and ?? [])) { if (isGroup(n)) { const v = validFilter(n, props); if (v) items.push(v); } else if (!ruleProblem(n, props)) items.push(n); }
  return items.length ? ({ [key]: items } as FilterGroup) : null;
}

