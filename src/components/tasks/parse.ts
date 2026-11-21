/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/tasks/parse.ts
 * Description      : Natural-language quick-add parser for tasks: "Call Marc
 *                    tomorrow !high #thesis", "Submit abstract nov 15", "Review
 *                    in 3 days", "next monday". A date is read only where it
 *                    cannot be mistaken for a word of the title (see the rules
 *                    above `parseTaskInput`).
 * Module           : components
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

import { addDays, addWeeks, addMonths, nextDay, startOfDay, startOfWeek, setHours, setMinutes, type Day } from "date-fns";

export interface ParsedTask { title: string; dueAt: Date | null; priority: "low" | "medium" | "high" | null; project: string | null }
const FULL_DAYS: Record<string, Day> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
/** Abbreviations that are not English words: accepted after a marker anywhere, or bare at the very end. */
const SHORT_DAYS: Record<string, Day> = { mon: 1, tue: 2, tues: 2, thu: 4, thur: 4, thurs: 4, fri: 5 };
/** Abbreviations that are also plain words ("sun cream", "sat nav", "wed"): only at the very end, marker or not. */
const WORD_DAYS: Record<string, Day> = { sun: 0, sat: 6, wed: 3 };
const DAYS: Record<string, Day> = { ...FULL_DAYS, ...SHORT_DAYS, ...WORD_DAYS };
const MONTHS: Record<string, number> = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const alt = (o: Record<string, unknown>) => Object.keys(o).sort((a, b) => b.length - a.length).join("|");
const MONTH_RE = alt(MONTHS);

/** Default due time is 17:00 local so "today" is not immediately overdue. */
const at = (d: Date, h = 17) => setMinutes(setHours(startOfDay(d), h), 0);
/** A real calendar day (no 31 February rolling into March), or null. `year == null` → this year, or next year when already past. */
function monthDay(month: number, day: number, year: number | null, now: Date): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(year ?? now.getFullYear(), month, day);
  if (year == null && d < startOfDay(now)) d.setFullYear(d.getFullYear() + 1);
  return d.getMonth() === month && d.getDate() === day ? d : null;
}
/**
 * "next <weekday>" = that weekday in the NEXT calendar week (weeks start on Monday), whereas a bare "<weekday>" is the first one strictly
 * after today. On Wednesday 18 Nov: "friday" → 20 Nov, "next friday" → 27 Nov; "monday" and "next monday" both → 23 Nov (the coming
 * Monday already belongs to next week).
 */
export function nextWeekday(now: Date, day: Day): Date { return addDays(addWeeks(startOfWeek(now, { weekStartsOn: 1 }), 1), (day + 6) % 7); }

/** Where a date phrase may stand: "any" = anywhere in the text, "end" = last words only, "edges" = last words or first words. */
type Where = "any" | "end" | "edges";
interface Rule { body: string; marked: Where; bare: Where; resolve: (m: string[], now: Date) => Date | null }
const weekday = (m: string[], now: Date) => at(nextDay(now, DAYS[m[1].toLowerCase()]));
const RULES: Rule[] = [
  // self-explanatory phrases: recognised anywhere, with or without "due / on / by" in front
  { body: "(?:today|tonight)", marked: "any", bare: "any", resolve: (_m, now) => at(now, 18) },
  { body: "(?:tomorrow|tmrw|tmr)", marked: "any", bare: "any", resolve: (_m, now) => at(addDays(now, 1)) },
  { body: `in\\s+(\\d{1,3}|${alt(NUMBERS)})\\s+(day|week|month)s?`, marked: "any", bare: "any", resolve: (m, now) => { const n = NUMBERS[m[1].toLowerCase()] ?? Number(m[1]); const u = m[2].toLowerCase(); return at(u === "day" ? addDays(now, n) : u === "week" ? addWeeks(now, n) : addMonths(now, n)); } },
  { body: `next\\s+(${alt(DAYS)})`, marked: "any", bare: "any", resolve: (m, now) => at(nextWeekday(now, DAYS[m[1].toLowerCase()])) },
  { body: "next\\s+week", marked: "any", bare: "any", resolve: (_m, now) => at(nextWeekday(now, 1)) },
  { body: "next\\s+month", marked: "any", bare: "any", resolve: (_m, now) => at(addMonths(startOfDay(now), 1)) },
  { body: "this\\s+weekend", marked: "any", bare: "any", resolve: (_m, now) => at(nextDay(now, 6)) },
  { body: "end\\s+of\\s+(?:the\\s+)?(week|month)", marked: "any", bare: "any", resolve: (m, now) => (m[1].toLowerCase() === "week" ? at(nextDay(now, 5)) : at(new Date(now.getFullYear(), now.getMonth() + 1, 0))) },
  { body: "(\\d{4})-(\\d{2})-(\\d{2})", marked: "any", bare: "any", resolve: (m, now) => { const d = monthDay(Number(m[2]) - 1, Number(m[3]), Number(m[1]), now); return d && at(d); } },
  // ambiguous phrases: a marker ("due friday", "on nov 15", "by 11/15") or a position at the edge of the text is required
  { body: `(${alt(FULL_DAYS)})`, marked: "any", bare: "edges", resolve: weekday },
  { body: `(${alt(SHORT_DAYS)})`, marked: "any", bare: "end", resolve: weekday },
  { body: `(${alt(WORD_DAYS)})`, marked: "end", bare: "end", resolve: weekday },
  { body: "weekend", marked: "any", bare: "end", resolve: (_m, now) => at(nextDay(now, 6)) },
  { body: `(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, marked: "any", bare: "edges", resolve: (m, now) => { const d = monthDay(MONTHS[m[1].toLowerCase()], Number(m[2]), m[3] ? Number(m[3]) : null, now); return d && at(d); } },
  { body: `(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\.?(?:,?\\s+(\\d{4}))?`, marked: "any", bare: "edges", resolve: (m, now) => { const d = monthDay(MONTHS[m[2].toLowerCase()], Number(m[1]), m[3] ? Number(m[3]) : null, now); return d && at(d); } },
  { body: "(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{4}|\\d{2}))?", marked: "any", bare: "edges", resolve: (m, now) => { const a = Number(m[1]), b = Number(m[2]); const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null; const d = a > 12 ? monthDay(b - 1, a, y, now) : monthDay(a - 1, b, y, now); return d && at(d); } },
];
const MARK = "(?:due|on|by)\\s+";
/** Every phrase starts after a space and stops before a space (the text is padded), so "sat-nav", "sunny" or "p10" never match. */
const pattern = (r: Rule, marked: boolean, pos: "any" | "end" | "start") => new RegExp(`${pos === "start" ? "^" : ""}\\s${marked ? MARK : ""}${r.body}${pos === "end" ? "(?=\\s*$)" : "(?=\\s)"}`, "i");

/**
 * Grammar. Priority (`!high`, `!!`, `p1`) and project (`#name`) are read anywhere. A time is `9am`, `2:30 pm`, `at 9` or `at 14:30`
 * (hours 0–23, minutes 0–59, 1–12 with am/pm; anything else stays in the title). A date is read, in this order of preference:
 *   1. anywhere when it explains itself — today, tonight, tomorrow, "in 3 days", "next friday", "next week", "this weekend",
 *      "end of month", 2026-11-15 — or when it follows a marker: "due friday", "on nov 15", "by 11/15";
 *   2. as the last words of the text: "Call Marc friday", "Submit abstract nov 15", "Pay rent fri";
 *   3. as the first words (full weekday names and calendar dates only): "Monday call Marc", "Nov 15 submit abstract".
 * So a weekday abbreviation or a number of days inside a title is left alone: "Buy sun cream", "Plan 3 days in Paris" have no due date.
 */
export function parseTaskInput(input: string, now = new Date()): ParsedTask {
  let s = ` ${input.trim()} `; let dueAt: Date | null = null; let priority: ParsedTask["priority"] = null; let project: string | null = null;
  /** Removes the first match when `fn` accepts it (returns anything but false). */
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void | boolean) => { const m = s.match(re); if (!m || fn(m) === false) return false; s = `${s.slice(0, m.index)} ${s.slice(m.index! + m[0].length)}`.replace(/\s+/g, " "); return true; };
  // priority: !high / !low / !medium / !!! / !! / ! / p1 p2 p3
  take(/\s!(high|medium|med|low)(?=\s)/i, (m) => { const v = m[1].toLowerCase(); priority = v === "med" ? "medium" : (v as ParsedTask["priority"]); });
  take(/\s(!{1,3})(?=\s)/, (m) => { priority = m[1].length === 3 ? "high" : m[1].length === 2 ? "medium" : "low"; });
  take(/\s[pP]([123])(?=\s)/, (m) => { priority = m[1] === "1" ? "high" : m[1] === "2" ? "medium" : "low"; });
  // project: #name
  take(/\s#([\p{L}\p{N}_-]{1,40})/u, (m) => { project = m[1]; });
  // explicit time "at 9", "at 14:30", "9am", "3:15 pm" — out-of-range values ("at 99", "13pm", "at 9:75") are not a time
  let hour: number | null = null; let minute = 0;
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, (m) => { const h = Number(m[1]), mi = Number(m[2] ?? 0); if (h < 1 || h > 12 || mi > 59) return false; hour = (h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0); minute = mi; });
  if (hour == null) take(/\sat\s+(\d{1,2})(?::(\d{2}))?(?=\s)/i, (m) => { const h = Number(m[1]), mi = Number(m[2] ?? 0); if (h > 23 || mi > 59) return false; hour = h; minute = mi; });
  // date: marked or self-explanatory phrases anywhere, then a phrase closing the text, then one opening it
  const tryRules = (marked: boolean, pos: "any" | "end" | "start") => { for (const r of RULES) { const w = marked ? r.marked : r.bare; const ok = pos === "any" ? w === "any" : pos === "end" ? w !== "any" : w === "edges"; if (ok && take(pattern(r, marked, pos), (m) => { const d = r.resolve(m, now); if (!d) return false; dueAt = d; })) return true; } return false; };
  const found = tryRules(true, "any") || tryRules(false, "any") || tryRules(true, "end") || tryRules(false, "end") || tryRules(false, "start");
  if (dueAt && hour != null) dueAt = setMinutes(setHours(startOfDay(dueAt), hour), minute);
  if (!dueAt && hour != null) { let d = setMinutes(setHours(startOfDay(now), hour), minute); if (d < now) d = addDays(d, 1); dueAt = d; }
  // a marker left dangling by the removed phrase ("Pay rent due | at 9") goes too — but "Turn the lights on" keeps its last word
  const title = (found || hour != null ? s.replace(/\s+(on|by|due)\s*$/i, "") : s).replace(/\s+/g, " ").trim();
  return { title: title || input.trim(), dueAt, priority, project };
}
