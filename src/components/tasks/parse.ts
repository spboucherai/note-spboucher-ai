/** Natural-language quick-add parser for tasks: "Call Marc tomorrow !high #thesis", "Submit abstract nov 15", "Review in 3 days", "next monday". */
import { addDays, addWeeks, addMonths, nextDay, startOfDay, setHours, setMinutes, isValid, parse, type Day } from "date-fns";

export interface ParsedTask { title: string; dueAt: Date | null; priority: "low" | "medium" | "high" | null; project: string | null }
const DAYS: Record<string, Day> = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const MONTHS: Record<string, number> = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const DAY_RE = Object.keys(DAYS).sort((a, b) => b.length - a.length).join("|");
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

/** Default due time is 17:00 local so "today" is not immediately overdue. */
const at = (d: Date, h = 17) => setMinutes(setHours(startOfDay(d), h), 0);

export function parseTaskInput(input: string, now = new Date()): ParsedTask {
  let s = ` ${input.trim()} `; let dueAt: Date | null = null; let priority: ParsedTask["priority"] = null; let project: string | null = null;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => { const m = s.match(re); if (m) { fn(m); s = s.replace(re, " "); } };
  // priority: !high / !low / !medium / !!! / !! / ! / p1 p2 p3
  take(/\s!(high|medium|med|low)\b/i, (m) => { const v = m[1].toLowerCase(); priority = v === "med" ? "medium" : (v as ParsedTask["priority"]); });
  take(/\s(!{1,3})(?=\s)/, (m) => { priority = m[1].length === 3 ? "high" : m[1].length === 2 ? "medium" : "low"; });
  take(/\s[pP]([123])\b/, (m) => { priority = m[1] === "1" ? "high" : m[1] === "2" ? "medium" : "low"; });
  // project: #name
  take(/\s#([\p{L}\p{N}_-]{1,40})/u, (m) => { project = m[1]; });
  // explicit time "at 9", "at 14:30", "9am", "3pm"
  let hour: number | null = null; let minute = 0;
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (m) => { hour = Number(m[1]) % 12 + (m[3].toLowerCase() === "pm" ? 12 : 0); minute = Number(m[2] ?? 0); });
  if (hour == null) take(/\sat\s+(\d{1,2})(?::(\d{2}))?\b/i, (m) => { hour = Number(m[1]); minute = Number(m[2] ?? 0); });
  // relative
  take(/\s(today|tonight)\b/i, () => { dueAt = at(now, 18); });
  if (!dueAt) take(/\s(tomorrow|tmr|tmrw)\b/i, () => { dueAt = at(addDays(now, 1)); });
  if (!dueAt) take(/\s(?:in\s+)?(\d+|a|an|one|two|three|four|five|six|seven)\s+(day|days|week|weeks|month|months)\b/i, (m) => { const n = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }[m[1].toLowerCase()] ?? Number(m[1]); const u = m[2].toLowerCase(); dueAt = at(u.startsWith("day") ? addDays(now, n) : u.startsWith("week") ? addWeeks(now, n) : addMonths(now, n)); });
  if (!dueAt) take(new RegExp(`\\snext\\s+(${DAY_RE})\\b`, "i"), (m) => { dueAt = at(nextDay(now, DAYS[m[1].toLowerCase()])); });
  if (!dueAt) take(/\snext\s+week\b/i, () => { dueAt = at(nextDay(now, 1)); });
  if (!dueAt) take(/\snext\s+month\b/i, () => { dueAt = at(addMonths(startOfDay(now), 1)); });
  if (!dueAt) take(/\s(?:this\s+)?weekend\b/i, () => { dueAt = at(nextDay(now, 6)); });
  if (!dueAt) take(/\s(?:end\s+of\s+(?:the\s+)?)(week|month)\b/i, (m) => { dueAt = m[1].toLowerCase() === "week" ? at(nextDay(now, 5)) : at(addDays(addMonths(startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), 1), -1)); });
  if (!dueAt) take(new RegExp(`\\s(?:on\\s+)?(${DAY_RE})\\b`, "i"), (m) => { dueAt = at(nextDay(now, DAYS[m[1].toLowerCase()])); });
  // absolute: "nov 15", "15 nov", "november 15th", "2026-11-15", "11/15", "15/11/2026"
  if (!dueAt) take(new RegExp(`\\s(?:on\\s+)?(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i"), (m) => { dueAt = at(monthDay(MONTHS[m[1].toLowerCase()], Number(m[2]), m[3] ? Number(m[3]) : null, now)); });
  if (!dueAt) take(new RegExp(`\\s(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\.?(?:,?\\s+(\\d{4}))?\\b`, "i"), (m) => { dueAt = at(monthDay(MONTHS[m[2].toLowerCase()], Number(m[1]), m[3] ? Number(m[3]) : null, now)); });
  if (!dueAt) take(/\s(\d{4}-\d{2}-\d{2})\b/, (m) => { const d = parse(m[1], "yyyy-MM-dd", now); if (isValid(d)) dueAt = at(d); });
  if (!dueAt) take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => { const a = Number(m[1]), b = Number(m[2]); const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null; const d = a > 12 ? monthDay(b - 1, a, y, now) : monthDay(a - 1, b, y, now); if (isValid(d)) dueAt = at(d); });
  if (dueAt && hour != null) dueAt = setMinutes(setHours(startOfDay(dueAt), hour), minute);
  if (!dueAt && hour != null) { let d = setMinutes(setHours(startOfDay(now), hour), minute); if (d < now) d = addDays(d, 1); dueAt = d; }
  const title = s.replace(/\s+/g, " ").replace(/\s+(on|by|due)\s*$/i, "").trim();
  return { title: title || input.trim(), dueAt, priority, project };
}
function monthDay(month: number, day: number, year: number | null, now: Date) {
  const d = new Date(year ?? now.getFullYear(), month, day);
  if (year == null && d < startOfDay(now)) d.setFullYear(d.getFullYear() + 1);
  return d;
}
