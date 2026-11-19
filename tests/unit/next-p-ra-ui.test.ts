/**
 * file: tests/unit/next-p-ra-ui.test.ts
 * description: Pure logic behind the P-RA UI fixes: task quick-add grammar (U12: no date read out of a title word, valid times only,
 *   "next <weekday>") and the paging helpers of the trash / archive / search lists (U10). No browser, no database.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTaskInput, nextWeekday } from "../../src/components/tasks/parse";
import { LIST_PAGE_SIZE, MAX_OFFSET, SEARCH_MAX_LIMIT, SEARCH_PAGE_SIZE, flattenPages, nextOffset, parseOffset, searchPaging } from "../../src/lib/paging";

/** Wednesday 18 November 2026, 10:00 local time. */
const NOW = new Date(2026, 10, 18, 10, 0, 0);
const p = (s: string) => parseTaskInput(s, NOW);
/** Local "YYYY-MM-DD HH:mm" of a due date (the parser works in local time). */
const fmt = (d: Date | null) => { if (!d) return null; const z = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const due = (s: string) => fmt(p(s).dueAt);

test("the fixed clock is a Wednesday", () => { assert.equal(NOW.getDay(), 3); });

test("U12: words of a title are never read as a date", () => {
  for (const title of ["Buy sun cream", "Plan 3 days in Paris", "Update sat nav maps", "Read mon oncle review", "Trip lasts 3 days", "Watch the wed episode again", "Plan weekend trip to Quebec", "Book friday night dinner table", "Compare may 5 and june 6 drafts", "Check 3/4 of the proofs today's way", "Pay sun-life invoice", "Sunday-roast recipe draft", "Turn the lights on", "Stand by", "Fix 2026-13-45 parser bug", "Feb 31 does not exist"]) {
    const r = p(title); assert.equal(r.dueAt, null, title); assert.equal(r.title, title, title);
  }
  // an explicit marker does not rescue an abbreviation that is a plain word inside the title
  const r = p("Put on sun cream"); assert.equal(r.dueAt, null); assert.equal(r.title, "Put on sun cream");
});

test("U12: self-explanatory phrases and marked dates are read anywhere", () => {
  assert.deepEqual([p("Call Marc tomorrow about the grant").title, due("Call Marc tomorrow about the grant")], ["Call Marc about the grant", "2026-11-19 17:00"]);
  assert.deepEqual([p("Review today the proofs").title, due("Review today the proofs")], ["Review the proofs", "2026-11-18 18:00"]);
  assert.deepEqual([p("Review in 3 days the draft").title, due("Review in 3 days the draft")], ["Review the draft", "2026-11-21 17:00"]);
  assert.equal(due("Review in a week"), "2026-11-25 17:00"); assert.equal(due("Renew passport in two months"), "2027-01-18 17:00");
  assert.deepEqual([p("Lunch on friday with Bob").title, due("Lunch on friday with Bob")], ["Lunch with Bob", "2026-11-20 17:00"]);
  assert.deepEqual([p("Report due fri for the dean").title, due("Report due fri for the dean")], ["Report for the dean", "2026-11-20 17:00"]);
  assert.deepEqual([p("Send by nov 30 the abstract").title, due("Send by nov 30 the abstract")], ["Send the abstract", "2026-11-30 17:00"]);
  assert.deepEqual([p("Pay rent due tomorrow").title, due("Pay rent due tomorrow")], ["Pay rent", "2026-11-19 17:00"]);
  assert.deepEqual([p("Renew 2026-12-01 licence").title, due("Renew 2026-12-01 licence")], ["Renew licence", "2026-12-01 17:00"]);
  assert.equal(due("Tidy up this weekend the garage"), "2026-11-21 17:00"); assert.equal(due("Close books end of month please"), "2026-11-30 17:00"); assert.equal(due("Ship end of the week"), "2026-11-20 17:00");
  assert.equal(due("Plan next month budget"), "2026-12-18 17:00");
});

test("U12: a bare date counts only as the last words, or (full names and calendar dates) the first words", () => {
  assert.deepEqual([p("Call Marc friday").title, due("Call Marc friday")], ["Call Marc", "2026-11-20 17:00"]);
  assert.deepEqual([p("Pay rent fri").title, due("Pay rent fri")], ["Pay rent", "2026-11-20 17:00"]);
  assert.deepEqual([p("Buy cream sun").title, due("Buy cream sun")], ["Buy cream", "2026-11-22 17:00"]);
  assert.deepEqual([p("Call mom on sun").title, due("Call mom on sun")], ["Call mom", "2026-11-22 17:00"]);
  assert.deepEqual([p("Submit abstract nov 15").title, due("Submit abstract nov 15")], ["Submit abstract", "2027-11-15 17:00"], "already past this year: next year");
  assert.deepEqual([p("Submit abstract november 30th, 2026").title, due("Submit abstract november 30th, 2026")], ["Submit abstract", "2026-11-30 17:00"]);
  assert.equal(due("Submit abstract 15 dec"), "2026-12-15 17:00"); assert.equal(due("Submit abstract 12/15"), "2026-12-15 17:00"); assert.equal(due("Submit abstract 15/12/2026"), "2026-12-15 17:00");
  assert.deepEqual([p("Monday call Marc").title, due("Monday call Marc")], ["call Marc", "2026-11-23 17:00"]);
  assert.deepEqual([p("Dec 1 renew licence").title, due("Dec 1 renew licence")], ["renew licence", "2026-12-01 17:00"]);
  assert.deepEqual([p("Clean garage weekend").title, due("Clean garage weekend")], ["Clean garage", "2026-11-21 17:00"]);
  assert.equal(due("Sun cream buy"), null, "an abbreviation opening the text is a word"); assert.equal(due("Mon oncle review"), null);
  assert.equal(due("wednesday"), "2026-11-25 17:00", "the same weekday is next week's, never today"); assert.equal(p("wednesday").title, "wednesday", "a title is never empty");
});

test("U12: 'next <weekday>' is the weekday of next calendar week; a bare weekday is the coming one", () => {
  assert.equal(due("Call Marc friday"), "2026-11-20 17:00"); assert.equal(due("Call Marc next friday"), "2026-11-27 17:00");
  assert.equal(due("Call Marc sunday"), "2026-11-22 17:00"); assert.equal(due("Call Marc next sunday"), "2026-11-29 17:00");
  assert.equal(due("Call Marc monday"), "2026-11-23 17:00"); assert.equal(due("Call Marc next monday"), "2026-11-23 17:00", "the coming Monday already is next week's");
  assert.equal(due("Call Marc next tue"), "2026-11-24 17:00"); assert.equal(due("next week plan sprint"), "2026-11-23 17:00");
  assert.equal(p("Call Marc next friday").title, "Call Marc");
  const sunday = new Date(2026, 10, 22, 9, 0); assert.equal(fmt(nextWeekday(sunday, 1)), "2026-11-23 00:00"); assert.equal(fmt(nextWeekday(sunday, 0)), "2026-11-29 00:00");
  const monday = new Date(2026, 10, 16, 9, 0); assert.equal(fmt(nextWeekday(monday, 1)), "2026-11-23 00:00"); assert.equal(fmt(parseTaskInput("x monday", monday).dueAt), "2026-11-23 17:00");
});

test("U12: times are validated (0–23 h, 0–59 min, 1–12 with am/pm); an invalid one stays in the title", () => {
  for (const title of ["Meet at 99", "Meet at 24", "Meet at 9:75", "Meet 13pm", "Meet 0am", "Meet at 12:60pm"]) { const r = p(title); assert.equal(r.dueAt, null, title); assert.equal(r.title, title, title); }
  assert.deepEqual([p("Meet at 23").title, due("Meet at 23")], ["Meet", "2026-11-18 23:00"]);
  assert.deepEqual([p("Meet at 0:05").title, due("Meet at 0:05")], ["Meet", "2026-11-19 00:05"], "already past today: tomorrow");
  assert.equal(due("Meet at 14:30"), "2026-11-18 14:30"); assert.equal(due("Meet 9am"), "2026-11-19 09:00"); assert.equal(due("Meet 12am tomorrow"), "2026-11-19 00:00"); assert.equal(due("Meet 12pm tomorrow"), "2026-11-19 12:00");
  assert.deepEqual([p("Call Marc tomorrow at 9").title, due("Call Marc tomorrow at 9")], ["Call Marc", "2026-11-19 09:00"]);
  assert.deepEqual([p("Call Marc fri at 2:30 pm").title, due("Call Marc fri at 2:30 pm")], ["Call Marc", "2026-11-20 14:30"], "the time is removed first, so the date still closes the text");
  assert.deepEqual([p("Call Marc tomorrow at 99").title, due("Call Marc tomorrow at 99")], ["Call Marc at 99", "2026-11-19 17:00"]);
});

test("quick-add keeps priority, project and the documented examples working", () => {
  const a = p("Call Marc tomorrow !high #thesis"); assert.deepEqual([a.title, fmt(a.dueAt), a.priority, a.project], ["Call Marc", "2026-11-19 17:00", "high", "thesis"]);
  const b = p("Send abstract to JIMF nov 30 !high #thesis"); assert.deepEqual([b.title, fmt(b.dueAt), b.priority, b.project], ["Send abstract to JIMF", "2026-11-30 17:00", "high", "thesis"]);
  const c = p("Buy sun cream p2 #home"); assert.deepEqual([c.title, c.dueAt, c.priority, c.project], ["Buy sun cream", null, "medium", "home"]);
  assert.equal(p("Review !!").priority, "medium"); assert.equal(p("Review !!!").priority, "high"); assert.equal(p("Review !").priority, "low"); assert.equal(p("Review !med").priority, "medium");
  assert.equal(p("Replace p10 filter").priority, null); assert.equal(p("Replace p10 filter").title, "Replace p10 filter");
  assert.equal(p("   ").title, ""); assert.equal(p("   ").dueAt, null);
});

test("U10: ?offset= is a plain bounded integer; absent means 0", () => {
  assert.equal(parseOffset(null), 0); assert.equal(parseOffset(undefined), 0); assert.equal(parseOffset(""), 0); assert.equal(parseOffset("0"), 0); assert.equal(parseOffset("100"), 100); assert.equal(parseOffset(String(MAX_OFFSET)), MAX_OFFSET);
  for (const bad of ["-1", "1.5", "1e3", "abc", " 5", "5 ", "0x10", String(MAX_OFFSET + 1), "9999999", "١٢"]) assert.equal(parseOffset(bad), null, bad);
});

test("U10: the next offset is the number of rows loaded, until a page comes back short", () => {
  const full = Array.from({ length: LIST_PAGE_SIZE }, (_v, i) => ({ id: `a${i}` })); const short = [{ id: "z" }];
  assert.equal(nextOffset([]), undefined); assert.equal(nextOffset([[]]), undefined); assert.equal(nextOffset([short]), undefined);
  assert.equal(nextOffset([full]), LIST_PAGE_SIZE); assert.equal(nextOffset([full, full]), 2 * LIST_PAGE_SIZE); assert.equal(nextOffset([full, short]), undefined);
  assert.equal(nextOffset([[1, 2], [3, 4]], 2), 4); assert.equal(nextOffset([[1, 2], [3]], 2), undefined);
  assert.deepEqual(flattenPages([[{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]]).map((r) => r.id), ["a", "b", "c"], "a row shifted into the next page by an insertion is listed once");
  assert.deepEqual(flattenPages(undefined), []);
});

test("U10: search asks for a higher limit until the cap, then says the list is truncated", () => {
  assert.deepEqual(searchPaging(12, SEARCH_PAGE_SIZE), { more: false, capped: false, nextLimit: 80 });
  assert.deepEqual(searchPaging(40, SEARCH_PAGE_SIZE), { more: true, capped: false, nextLimit: 80 });
  assert.deepEqual(searchPaging(80, 80), { more: true, capped: false, nextLimit: 120 });
  assert.deepEqual(searchPaging(97, SEARCH_MAX_LIMIT), { more: false, capped: false, nextLimit: SEARCH_MAX_LIMIT });
  assert.deepEqual(searchPaging(SEARCH_MAX_LIMIT, SEARCH_MAX_LIMIT), { more: false, capped: true, nextLimit: SEARCH_MAX_LIMIT });
  assert.equal(SEARCH_MAX_LIMIT % SEARCH_PAGE_SIZE, 0);
});
