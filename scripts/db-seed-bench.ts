/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : scripts/db-seed-bench.ts
 * Description      : seeds the benchmark database of Databases Next Generation
 *                    — one database "BENCH 20k rows" with N rows (default 20
 *                    000) of deterministic data over every stored value type,
 *                    plus saved views (table, filtered + sorted table, grouped
 *                    table, board, calendar, timeline, gallery, list). Pages
 *                    and rows are inserted in batches straight into the scratch
 *                    database (never production: the name must end in _dev /
 *                    _test / _scratch). Usage: `tsx scripts/db-seed-bench.ts
 *                    [rows] [--reset] [--drop] [--name "Title"]`. Prints the
 *                    ids as JSON.
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
import { and, eq, isNull } from "drizzle-orm";
import { db, schema, sql } from "../src/db/index";
import { createPage } from "../src/lib/pages/service";
import { ensureDatabase, createProperty, createView, updateView, getDatabase } from "../src/lib/databases/service";

const args = process.argv.slice(2); const N = Number(args.find((a) => /^\d+$/.test(a)) ?? 20000); const reset = args.includes("--reset") || args.includes("--drop");
const NAME = args.includes("--name") ? args[args.indexOf("--name") + 1] : "BENCH 20k rows";
// mulberry32: the same rows on every run
let seed = 20261119; const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const WORDS = ["atlas", "beacon", "cinder", "delta", "ember", "fjord", "garnet", "harbor", "iris", "juniper", "kestrel", "lumen", "meridian", "nimbus", "onyx", "prairie", "quartz", "raven", "sierra", "tundra", "umbra", "vertex", "willow", "xenon", "yarrow", "zephyr"];
const OWNERS = ["Simon", "Erika", "Mathieu", "Guillaume", "Paul", "Camille", "Noah", "Léa"];

const [w] = await db.select().from(schema.workspaces).limit(1); if (!w) throw new Error("workspace missing: pnpm run bootstrap");
const [old] = await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.workspaceId, w.id), eq(schema.pages.title, NAME), eq(schema.pages.type, "database"), isNull(schema.pages.deletedAt)));
if (old && !reset) { const d = await getDatabase(w.id, old.id); const [{ n }] = await sql`select count(*)::int as n from database_rows where database_id = ${d.id} and deleted_at is null`; console.log(JSON.stringify({ existing: true, pageId: d.pageId, databaseId: d.id, rows: n, views: Object.fromEntries(d.views.map((v) => [v.name, v.id])), properties: Object.fromEntries(d.properties.map((p) => [p.name, p.id])) })); await sql.end(); process.exit(0); }
if (old) { await sql`delete from pages where database_id in (select id from databases where page_id = ${old.id})`; await sql`delete from pages where id = ${old.id}`; }
if (args.includes("--drop")) { console.log(JSON.stringify({ dropped: !!old })); await sql.end(); process.exit(0); } // remove the benchmark database and stop (suites written for a small scratch database: /api/sync first window, knowledge health caps)

const t0 = Date.now();
const page = await createPage(w.id, { title: NAME, type: "database", section: "databases", icon: "🧪" });
const d = await ensureDatabase(w.id, page.id);
const P = async (name: string, type: any, config: any = {}) => createProperty(w.id, d.id, { name, type, config });
const status = await P("Status", "status");
const priority = await P("Priority", "select", { options: [{ id: "low", name: "Low", color: "gray" }, { id: "med", name: "Medium", color: "yellow" }, { id: "high", name: "High", color: "red" }] });
const tags = await P("Tags", "multi_select", { options: ["research", "writing", "data", "review", "admin", "teaching"].map((n, i) => ({ id: `t${i}`, name: n, color: ["blue", "green", "purple", "orange", "gray", "teal"][i] })) });
const estimate = await P("Estimate", "number", { format: "integer" });
const cost = await P("Cost", "number", { format: "currency" });
const due = await P("Due", "date");
const done = await P("Done", "checkbox");
const owner = await P("Owner", "text");
const link = await P("Link", "url");
await P("Created", "created_time");
const score = await P("Score", "formula", { expression: 'prop("Estimate") * 2 + if(prop("Done"), 1, 0)' });

const base = Date.UTC(2026, 0, 1); const B = 1000; let made = 0;
for (let from = 0; from < N; from += B) {
  const n = Math.min(B, N - from); const pages: (typeof schema.pages.$inferInsert)[] = []; const meta: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const k = from + i + 1; const title = `${pick(WORDS)} ${pick(WORDS)} ${String(k).padStart(5, "0")}`; const plain = `Row ${k} of the benchmark database.`;
    pages.push({ workspaceId: w.id, parentId: page.id, databaseId: d.id, section: "databases", type: "page", title, position: k, content: { type: "doc", content: [{ type: "paragraph", attrs: { id: `b${k}` }, content: [{ type: "text", text: plain }] }] }, plainText: plain, wordCount: 6 });
    const v: Record<string, unknown> = { [estimate.id]: Math.floor(rnd() * 200), [cost.id]: Math.round(rnd() * 500000) / 100, [owner.id]: pick(OWNERS), [link.id]: `https://example.org/item/${k}` };
    const s = rnd(); v[status.id] = s < 0.45 ? "todo" : s < 0.8 ? "doing" : "done";
    if (rnd() < 0.9) v[priority.id] = pick(["low", "med", "high"]);
    const ts = [0, 1, 2, 3, 4, 5].filter(() => rnd() < 0.25).map((x) => `t${x}`); if (ts.length) v[tags.id] = ts;
    if (rnd() < 0.85) { const day = new Date(base + Math.floor(rnd() * 700) * 864e5); v[due.id] = day.toISOString().slice(0, 10); }
    if (rnd() < 0.4) v[done.id] = rnd() < 0.7;
    meta.push(v);
  }
  const ins = await db.insert(schema.pages).values(pages).returning({ id: schema.pages.id });
  await db.insert(schema.databaseRows).values(ins.map((p, i) => ({ databaseId: d.id, pageId: p.id, values: meta[i], position: from + i + 1 })));
  made += n;
}
const def = (await getDatabase(w.id, d.id)).views[0];
await updateView(w.id, d.id, def.id, { name: "All rows" });
const V = async (name: string, type: any, config: any) => createView(w.id, d.id, { name, type, config });
await V("Doing, big, by due date", "table", { filter: { and: [{ property: status.id, op: "eq", value: "doing" }, { property: estimate.id, op: "gt", value: 100 }] }, sorts: [{ property: due.id, dir: "desc" }] });
await V("Sorted by cost", "table", { sorts: [{ property: cost.id, dir: "desc" }] });
await V("Grouped by status", "table", { groupBy: status.id });
await V("Board", "board", { groupBy: status.id });
await V("Calendar", "calendar", { dateProperty: due.id });
await V("Timeline", "timeline", { startProperty: due.id, endProperty: due.id, filter: { and: [{ property: priority.id, op: "eq", value: "high" }, { property: estimate.id, op: "gt", value: 190 }] } });
await V("Gallery", "gallery", {});
await V("List", "list", { groupBy: priority.id });
await V("Sorted by formula (JS path)", "table", { sorts: [{ property: score.id, dir: "desc" }] });
const full = await getDatabase(w.id, d.id);
console.log(JSON.stringify({ existing: false, pageId: full.pageId, databaseId: full.id, rows: made, seconds: Math.round((Date.now() - t0) / 100) / 10, views: Object.fromEntries(full.views.map((v) => [v.name, v.id])), properties: Object.fromEntries(full.properties.map((p) => [p.name, p.id])) }));
await sql.end();
process.exit(0); // the job queue opened by the page service keeps the event loop alive
