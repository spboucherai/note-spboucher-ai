import { HttpError } from "@/lib/errors";
/**
 * A due date: an ISO datetime with offset is kept as it is; a bare ISO date (`2026-11-25`, the form of `taskItem.due`) means "that day"
 * and is stored at 12:00 UTC so that it is the same calendar day in every time zone from UTC−11 to UTC+11.
 */
export function parseDue(v: string | Date | null | undefined): Date | null {
  if (v == null || v === "") return null; if (v instanceof Date) return v;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00.000Z` : v);
  if (isNaN(d.getTime())) throw new HttpError(400, "Invalid due date", "bad_request"); return d;
}
