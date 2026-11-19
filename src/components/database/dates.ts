/**
 * File: src/components/database/dates.ts
 * Description: date helpers of the calendar and timeline drags: move a stored date value by whole days, or onto a given day, keeping
 *   its shape (a plain `YYYY-MM-DD` stays plain; a date-time keeps its time of day).
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import { dateOf } from "@/lib/databases/values";
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plain = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** The value moved by `days` (negative = earlier). Null when the value is not a date. */
export function shiftDate(v: unknown, days: number): string | null { const d = dateOf(v); if (!d) return null; const n = new Date(d); n.setDate(n.getDate() + days); return plain(v) ? isoDay(n) : n.toISOString(); }
/** The value moved onto `day` (YYYY-MM-DD); an empty value becomes that plain day. */
export function onDay(v: unknown, day: string): string { const d = dateOf(v); if (!d || plain(v)) return day; const [y, m, dd] = day.split("-").map(Number); const n = new Date(d); n.setFullYear(y, m - 1, dd); return n.toISOString(); }
export const dayDiff = (a: Date, b: Date) => Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() - new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) / 864e5);
