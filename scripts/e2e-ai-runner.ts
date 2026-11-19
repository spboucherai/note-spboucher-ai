/**
 * File: scripts/e2e-ai-runner.ts
 * Description: test-only stand-in for the worker PROCESS on a scratch database whose connection limit cannot hold web + worker + tests:
 *   it takes the queued runs of smart database properties (`ai_property_runs.status = 'queued'`) and executes them with the real
 *   handler of the worker (`handleAiProperty`: routing, model call, cost, run log, cell write) over ONE connection. Only the pg-boss
 *   dispatch is bypassed. With `--fake-url <url>` it first registers the local fake model server as provider "e2epdb" (key read from
 *   FAKE_LLM_KEY_E2EPDB) and removes it on exit. Prints "ready" when it polls. Stop it with SIGTERM. Never for production.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
import "./db-one-connection";
import "../tests/helpers/testdb";
import { asc, eq } from "drizzle-orm";
import { db, schema, sql } from "../src/db/index";
import { handleAiProperty } from "../src/worker/handlers/ai-property";

const args = process.argv.slice(2); const fakeUrl = args.includes("--fake-url") ? args[args.indexOf("--fake-url") + 1] : null; let stop = false;
if (fakeUrl) {
  if (!process.env.FAKE_LLM_KEY_E2EPDB) throw new Error("FAKE_LLM_KEY_E2EPDB missing");
  await sql`insert into ai_providers (id, name, kind, base_url, key_env, label, enabled) values ('e2epdb', 'Fake e2epdb', 'openai_compatible', ${fakeUrl}, 'FAKE_LLM_KEY_E2EPDB', 'Fake e2epdb', true) on conflict (id) do update set base_url = excluded.base_url, key_env = excluded.key_env, enabled = true`;
  for (const m of ["echo", "err-500"]) await sql`insert into ai_models (id, provider, display_name, category, available, enabled, capabilities, input_price, output_price, context_window, creator, route) values (${"e2epdb:" + m}, 'e2epdb', ${m}, 'text', true, true, '{"structured_output": true}'::jsonb, 1, 2, 100000, 'unknown', 'e2epdb') on conflict (id) do nothing`;
}
const bye = async () => { stop = true; };
process.on("SIGTERM", bye); process.on("SIGINT", bye);
console.log("ready");
const R = schema.aiPropertyRuns;
while (!stop) {
  const queued = await db.select({ id: R.id, rowId: R.rowId, propertyId: R.propertyId, workspaceId: R.workspaceId }).from(R).where(eq(R.status, "queued")).orderBy(asc(R.createdAt)).limit(20);
  for (const r of queued) { if (stop) break; try { await handleAiProperty({ rowId: r.rowId, propertyId: r.propertyId, workspaceId: r.workspaceId, runId: r.id }); } catch (e) { console.error("run failed", (e as Error)?.message); } }
  if (!queued.length) await new Promise((r) => setTimeout(r, 300));
}
if (fakeUrl) { await sql`delete from ai_models where provider = 'e2epdb'`; await sql`delete from ai_providers where id = 'e2epdb'`; }
await sql.end({ timeout: 2 }); process.exit(0);
