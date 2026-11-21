/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/databases/values.ts
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

/** Client-safe value helpers: display strings, formula typing, parsing. */
import { nanoid } from "nanoid";
import type { Property, SelectOption, RelationRef, FileRef, OptionColor } from "./types";
import { isError, isPending } from "./types";
import { toDate, type FVal } from "./formula";

export const newId = () => nanoid(8);
export const optionOf = (p: Property, id: unknown): SelectOption | undefined => (p.config.options ?? []).find((o) => o.id === id || o.name === id);
export const isEmpty = (v: unknown): boolean => v == null || v === "" || (Array.isArray(v) && v.length === 0) || isPending(v) || isError(v);
export const numberOf = (v: unknown): number | null => { if (typeof v === "number") return Number.isFinite(v) ? v : null; if (typeof v === "boolean") return v ? 1 : 0; if (typeof v === "string" && v.trim() !== "") { const n = Number(v.replace(/[\s,$%]/g, "")); return Number.isNaN(n) ? null : n; } return null; };
export const dateOf = (v: unknown): Date | null => (typeof v === "string" || typeof v === "number" || v instanceof Date ? toDate(v) : null);
// 3.0: Intl formatters are built once (constructing one per cell made a 20 000-row search spend most of its time here)
const NF: Record<string, Intl.NumberFormat> = { integer: new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0, useGrouping: false }), percent: new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 }), currency: new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 }), plain: new Intl.NumberFormat("en-CA", { maximumFractionDigits: 6, useGrouping: false }), grouped: new Intl.NumberFormat("en-CA", { maximumFractionDigits: 6, useGrouping: true }) };
const DF = { date: new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }), time: new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }) };
export function fmtNumber(n: number | null, format?: string): string {
  if (n == null) return "";
  switch (format) {
    case "integer": return NF.integer.format(n);
    case "percent": return NF.percent.format(n / 100);
    case "currency": return NF.currency.format(n);
    default: return (Math.abs(n) >= 10000 ? NF.grouped : NF.plain).format(n);
  }
}
export function fmtDateValue(v: unknown, includeTime?: boolean): string {
  const d = dateOf(v); if (!d) return "";
  const hasTime = includeTime || (typeof v === "string" && v.includes("T") && !/T00:00(:00)?/.test(v));
  return (hasTime ? DF.time : DF.date).format(d);
}
export function relativeDate(v: unknown): string {
  const d = dateOf(v); if (!d) return "";
  const days = Math.round((d.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return "today"; if (days === 1) return "tomorrow"; if (days === -1) return "yesterday";
  if (Math.abs(days) < 30) return days > 0 ? `in ${days} d` : `${-days} d ago`;
  const m = Math.round(days / 30); if (Math.abs(m) < 12) return m > 0 ? `in ${m} mo` : `${-m} mo ago`;
  const y = Math.round(days / 365); return y > 0 ? `in ${y} y` : `${-y} y ago`;
}
/** Human/CSV string for any stored or computed value. */
export function displayValue(p: Property, v: unknown): string {
  if (isPending(v)) return "…"; if (isError(v)) return `#ERR ${v.error}`;
  if (v == null || v === "") return "";
  switch (p.type) {
    case "number": return fmtNumber(numberOf(v), p.config.format);
    case "date": case "created_time": case "last_edited_time": return fmtDateValue(v, p.config.includeTime || p.type !== "date");
    case "checkbox": return v ? "Yes" : "No";
    case "select": case "status": return optionOf(p, v)?.name ?? String(v);
    case "multi_select": return (Array.isArray(v) ? v : [v]).map((x) => optionOf(p, x)?.name ?? String(x)).join(", ");
    case "relation": return (Array.isArray(v) ? (v as RelationRef[]) : []).map((r) => r.title).join(", ");
    case "file": return (Array.isArray(v) ? (v as FileRef[]) : []).map((f) => f.name).join(", ");
    case "rollup": return Array.isArray(v) ? v.map((x) => (typeof x === "object" && x && "title" in x ? (x as any).title : String(x))).join(", ") : typeof v === "number" ? (String(p.config.aggregate ?? "").startsWith("percent") ? `${fmtNumber(v)} %` : fmtNumber(v)) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? fmtDateValue(v) : String(v);
    case "formula": return typeof v === "boolean" ? (v ? "true" : "false") : typeof v === "number" ? fmtNumber(v) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? fmtDateValue(v) : String(v);
    default: return Array.isArray(v) ? v.map(String).join(", ") : String(v);
  }
}
/** Typed value for the formula engine. */
export function formulaValue(p: Property, v: unknown): FVal {
  if (v == null || isPending(v) || isError(v)) return null;
  switch (p.type) {
    case "number": return numberOf(v);
    case "date": case "created_time": case "last_edited_time": return dateOf(v);
    case "checkbox": return Boolean(v);
    case "select": case "status": return optionOf(p, v)?.name ?? String(v);
    case "multi_select": return (Array.isArray(v) ? v : [v]).map((x) => optionOf(p, x)?.name ?? String(x));
    case "relation": return (Array.isArray(v) ? (v as RelationRef[]) : []).map((r) => r.title);
    case "file": return (Array.isArray(v) ? (v as FileRef[]) : []).map((f) => f.name);
    case "rollup": return Array.isArray(v) ? v.map((x) => (typeof x === "object" && x && "title" in x ? (x as any).title : (x as FVal))) : (v as FVal);
    case "formula": return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? dateOf(v) : (v as FVal);
    default: return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : String(v);
  }
}
/** Sort key (null last). */
export function sortKey(p: Property, v: unknown): number | string | null {
  if (isEmpty(v)) return null;
  switch (p.type) {
    case "number": return numberOf(v);
    case "date": case "created_time": case "last_edited_time": return dateOf(v)?.getTime() ?? null;
    case "checkbox": return v ? 1 : 0;
    case "select": case "status": { const opts = p.config.options ?? []; const i = opts.findIndex((o) => o.id === v); return i >= 0 ? i : opts.length; }
    case "rollup": case "formula": return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : displayValue(p, v).toLowerCase();
    default: return displayValue(p, v).toLowerCase();
  }
}
/** Parse a free-text (CSV/import) value into the stored shape; may append new options to p.config.options. */
export function parseValue(p: Property, raw: string): unknown {
  const s = raw.trim(); if (!s) return null;
  switch (p.type) {
    case "number": return numberOf(s);
    case "checkbox": return /^(true|yes|y|1|x|✓|oui)$/i.test(s);
    case "date": { const d = toDate(s); return d ? (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : d.toISOString()) : null; }
    case "select": case "status": return ensureOption(p, s).id;
    case "multi_select": return s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean).map((x) => ensureOption(p, x).id);
    case "url": case "text": case "title": case "ai": return s;
    default: return s;
  }
}
export function ensureOption(p: Property, name: string): SelectOption {
  const opts = (p.config.options ??= []); const f = opts.find((o) => o.name.toLowerCase() === name.toLowerCase()); if (f) return f;
  const o: SelectOption = { id: newId(), name, color: pickColor(opts.length) }; opts.push(o); return o;
}
const PALETTE: OptionColor[] = ["blue", "green", "yellow", "orange", "red", "purple", "pink", "teal", "gray"];
export const pickColor = (i: number): OptionColor => PALETTE[i % PALETTE.length];
export const titleProp = (props: Property[]) => props.find((p) => p.type === "title");
export const sortedProps = (props: Property[]) => [...props].sort((a, b) => (a.type === "title" ? -1 : b.type === "title" ? 1 : a.position - b.position));
