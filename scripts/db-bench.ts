/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : scripts/db-bench.ts
 * Description      : server-side benchmark of the database query engine on the
 *                    seeded database ("BENCH 20k rows", see db-seed-bench.ts).
 *                    Each scenario runs the 2.x path (`queryRowsJs`: load +
 *                    hydrate every row, then filter / sort / slice in
 *                    JavaScript) and the 3.0 SQL engine (`queryRows`) with the
 *                    same input, R times each (default 9) after one warm-up,
 *                    and reports median / p95 in milliseconds — measured
 *                    in-process (no HTTP, no auth), real numbers only. Usage:
 *                    `tsx scripts/db-bench.ts [--runs 9] [--json out.json]`.
 * Module           : scripts
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

import "./db-one-connection";
import "../tests/helpers/testdb";
import fs from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema, sql } from "../src/db/index";
import { getDatabase } from "../src/lib/databases/service";
import { queryRows } from "../src/lib/databases/engine";
import { queryRowsJs } from "../src/lib/databases/query";
import type { QueryInput } from "../src/lib/databases/types";

const args = process.argv.slice(2); const RUNS = Number(args[args.indexOf("--runs") + 1] && args.includes("--runs") ? args[args.indexOf("--runs") + 1] : 9); const out = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const NAME = args.includes("--name") ? args[args.indexOf("--name") + 1] : "BENCH 20k rows";
const [w] = await db.select().from(schema.workspaces).limit(1);
const [pg] = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.workspaceId, w.id), eq(schema.pages.title, NAME), eq(schema.pages.type, "database"), isNull(schema.pages.deletedAt)));
if (!pg) throw new Error(`"${NAME}" missing: run tsx scripts/db-seed-bench.ts first`);
const d = await getDatabase(w.id, pg.id); const p = Object.fromEntries(d.properties.map((x) => [x.name, x.id]));
const [{ n }] = await sql`select count(*)::int as n from database_rows where database_id = ${d.id} and deleted_at is null`;
const stat = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))]; return { median: Math.round(q(0.5) * 10) / 10, p95: Math.round(q(0.95) * 10) / 10, min: Math.round(s[0] * 10) / 10 }; };
async function time(fn: () => Promise<{ total: number; rows: unknown[]; engine?: string }>) { await fn(); const ms: number[] = []; let last: any; for (let i = 0; i < RUNS; i++) { const t = performance.now(); last = await fn(); ms.push(performance.now() - t); } return { ...stat(ms), total: last.total, returned: last.rows.length, engine: last.engine ?? "js-2.x" }; }
const scenarios: { name: string; before: QueryInput; after: QueryInput }[] = [
  { name: "first page, default order", before: { limit: 500 }, after: { limit: 100 } },
  { name: "first page, same window as 2.x (500 rows)", before: { limit: 500 }, after: { limit: 500 } },
  { name: "filter: Status = doing AND Estimate > 100", before: { limit: 500, filter: { and: [{ property: p.Status, op: "eq", value: "doing" }, { property: p.Estimate, op: "gt", value: 100 }] } }, after: { limit: 100, filter: { and: [{ property: p.Status, op: "eq", value: "doing" }, { property: p.Estimate, op: "gt", value: 100 }] } } },
  { name: "filter: Owner contains \"mat\" (pushdown existed in 2.x)", before: { limit: 500, filter: { and: [{ property: p.Owner, op: "contains", value: "mat" }] } }, after: { limit: 100, filter: { and: [{ property: p.Owner, op: "contains", value: "mat" }] } } },
  { name: "sort: Cost descending", before: { limit: 500, sorts: [{ property: p.Cost, dir: "desc" }] }, after: { limit: 100, sorts: [{ property: p.Cost, dir: "desc" }] } },
  { name: "sort: Due ascending, then title", before: { limit: 500, sorts: [{ property: p.Due, dir: "asc" }, { property: p.Name, dir: "asc" }] }, after: { limit: 100, sorts: [{ property: p.Due, dir: "asc" }, { property: p.Name, dir: "asc" }] } },
  { name: "filter + sort (Tags contains research, Due before 2027, by Estimate desc)", before: { limit: 500, filter: { and: [{ property: p.Tags, op: "contains", value: "t0" }, { property: p.Due, op: "before", value: "2027-01-01" }] }, sorts: [{ property: p.Estimate, dir: "desc" }] }, after: { limit: 100, filter: { and: [{ property: p.Tags, op: "contains", value: "t0" }, { property: p.Due, op: "before", value: "2027-01-01" }] }, sorts: [{ property: p.Estimate, dir: "desc" }] } },
  { name: "search \"zephyr 12\"", before: { limit: 500, search: "zephyr 12" }, after: { limit: 100, search: "zephyr 12" } },
  { name: "deep window (offset 19 900)", before: { limit: 100, offset: Math.max(0, n - 100) }, after: { limit: 100, offset: Math.max(0, n - 100) } },
  { name: "grouped by Status: window + whole-database counts and sums", before: { limit: 500 }, after: { limit: 100, groupBy: p.Status } },
  { name: "sort on a formula (JavaScript fallback in 3.0)", before: { limit: 500, sorts: [{ property: p.Score, dir: "desc" }] }, after: { limit: 100, sorts: [{ property: p.Score, dir: "desc" }] } },
];
const results = [];
for (const s of scenarios) {
  const before = await time(() => queryRowsJs(d.id, d.properties, s.before)); const after = await time(() => queryRows(d.id, d.properties, s.after));
  results.push({ scenario: s.name, before, after, speedup: Math.round((before.median / after.median) * 10) / 10 });
  console.log(`${s.name.padEnd(74)} 2.x ${String(before.median).padStart(8)} ms (p95 ${before.p95})   3.0 ${String(after.median).padStart(7)} ms (p95 ${after.p95}) [${after.engine}]   ×${results[results.length - 1].speedup}   total ${after.total}`);
}
const report = { at: new Date().toISOString(), database: NAME, rows: n, runs: RUNS, node: process.version, results };
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
await sql.end();
process.exit(0); // the job queue opened by the page service keeps the event loop alive
