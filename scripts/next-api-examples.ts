/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : scripts/next-api-examples.ts
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

/**
 * DEVELOPMENT ONLY — replays a small scenario against the running scratch instance and records the REAL requests and responses used as
 * examples in docs/next/API-NEXT.md (docs/next/examples.json). Everything it creates is deleted at the end.
 *   bash scripts/next-dev-server.sh start && node_modules/.bin/tsx scripts/next-api-examples.ts && python3 scripts/next-api-doc.py
 */
import "../tests/helpers/testdb";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, like } from "drizzle-orm";
import { db, schema, sql } from "../src/db/index";
import { createSession, ownerRow } from "../src/lib/auth/sessions";
import { ENTITIES, ENTITY_KINDS } from "../src/lib/sync/entities";
import { EVENT_KINDS } from "../src/lib/events/service";
import { NEXT_LIMITS } from "../src/lib/editor/next-nodes";
import { CANVAS_LIMITS } from "../src/lib/canvas/format";
import { REL_TYPES } from "../src/lib/graph/relations";
import { FEATURES } from "../src/lib/meta";

const STARTED = new Date(Date.now() - 2000);
const BASE = (process.env.APP_URL ?? "").replace(/\/$/, ""); const UA = "SPNotes/2.0.0 (Macintosh; Mac OS X 27.0) native";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("loopback only");
const u = await ownerRow(); if (!u) throw new Error("no owner"); const s = await createSession({ userId: u.id, credentialId: null, userAgent: UA, ip: "127.0.0.1" });
const cookie = `__Host-note_session=${s.token}`; const out: Record<string, unknown> = {}; const made = { pages: [] as string[], tasks: [] as string[], refs: [] as string[], atts: [] as string[], concepts: [] as string[] };
const KEEP = ["x-existing", "content-range", "accept-ranges", "content-length", "content-type", "etag", "idempotent-replay"];
async function call(name: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { cookie, "user-agent": UA, ...headers }; if (method !== "GET") h.origin = BASE;
  let payload: any; if (body instanceof FormData) payload = body; else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers: h, body: payload }); const buf = Buffer.from(await r.arrayBuffer()); let json: any; try { json = JSON.parse(buf.toString("utf8")); } catch { json = `<${buf.length} bytes>`; }
  if (name) out[name] = { request: { method, path, ...(body !== undefined && !(body instanceof FormData) ? { body } : {}), ...(Object.keys(headers).length ? { headers } : {}) }, status: r.status, headers: Object.fromEntries(KEEP.filter((k) => r.headers.get(k) && (k !== "content-type" || !String(r.headers.get(k)).includes("json")) && (k !== "content-length" || typeof json === "string")).map((k) => [k, r.headers.get(k)])), body: json };
  return { status: r.status, json };
}
const P = "Exemple ·"; const text = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
try {
  await call("meta", "GET", "/api/meta");
  const head0 = (await call(null, "GET", "/api/sync?kinds=all&limit=1")).json.head as number;
  const mk = async (b: Record<string, unknown>) => { const r = await call(null, "POST", "/api/pages", b); made.pages.push(r.json.id); return r.json; };
  const project = await mk({ title: `${P} Thèse`, section: "projects" });
  const ref = (await call("reference_create", "POST", "/api/research/references", { id: randomUUID(), title: "Generalized autoregressive conditional heteroskedasticity", authors: ["Bollerslev, Tim"], year: 1986, journal: "Journal of Econometrics" })).json; made.refs.push(ref.id);
  const taskId = randomUUID(); made.tasks.push(taskId);
  const b = await mk({ title: `${P} Données`, parentId: project.id, section: "projects", content: { type: "doc", content: [text("Les séries couvrent 2010 à 2025.")] } });
  const a = await mk({ title: `${P} Revue de littérature`, parentId: project.id, section: "projects", content: { type: "doc", content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Volatilité conditionnelle" }] },
    { type: "paragraph", content: [{ type: "text", text: "Le modèle fondateur est " }, { type: "citation", attrs: { refId: ref.id, locator: "p. 309", label: "Bollerslev 1986" } }, { type: "text", text: ". Voir aussi " }, { type: "mention", attrs: { id: b.id, label: "Données" } }, { type: "text", text: "." }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false, taskId, due: "2026-11-25", priority: "high" }, content: [text("Relire la section 2")] }] },
    { type: "callout", attrs: { kind: "decision", icon: "✅" }, content: [text("On retient EGARCH comme référence.")] },
    { type: "mermaid", attrs: { code: "graph LR\n  ARCH --> GARCH --> EGARCH", preview: null, previewHash: null } }] } });
  out.page_create = { request: { method: "POST", path: "/api/pages", body: "(see the document above)" }, status: 201, body: a };
  await call("task_create", "POST", "/api/tasks", { id: randomUUID(), title: "Envoyer le plan au directeur", due: "2026-11-21", priority: "medium", pageId: a.id }).then((r) => made.tasks.push(r.json.id));
  const t2 = (out.task_create as any).body.id as string;
  await call("task_create_again", "POST", "/api/tasks", { id: t2, title: "Envoyer le plan au directeur" });
  await call("task_patch", "PATCH", `/api/tasks/${t2}`, { status: "done" });
  await call("task_get_linked", "GET", `/api/tasks/${taskId}`);
  await call("tasks_list", "GET", `/api/tasks?pageId=${a.id}&done=1`);
  await call("task_delete", "DELETE", `/api/tasks/${t2}`); await call("task_delete_again", "DELETE", `/api/tasks/${t2}`);
  await call("task_bad_page", "POST", "/api/tasks", { title: "x", pageId: randomUUID() });
  await call(null, "PUT", `/api/pages/${a.id}/tags`, { tags: ["garch", "thèse"] }); await call(null, "PUT", `/api/pages/${b.id}/tags`, { tags: ["thèse"] });
  const rel = (await call("relation_create", "POST", "/api/graph/relations", { fromId: b.id, toId: a.id, relType: "supports", note: "Les données appuient la revue", validFrom: "2026-01-01T00:00:00Z" })).json;
  await call("relation_exists", "POST", "/api/graph/relations", { fromId: b.id, toId: a.id, relType: "supports" });
  await call("relation_patch", "PATCH", `/api/graph/relations/${rel.id}`, { relType: "extends", note: null });
  await call("relations_list", "GET", `/api/graph/relations?nodeId=${a.id}&include=cites`);
  const concept = (await call("concept_create", "POST", "/api/concepts", { name: `${P} hétéroscédasticité`, description: "Variance non constante", pageIds: [a.id, b.id] })).json; made.concepts.push(concept.id);
  await call("concept_patch", "PATCH", `/api/concepts/${concept.id}`, { removePages: [b.id] }); await call("concepts_list", "GET", `/api/concepts?pageId=${a.id}`);
  const cv = await mk({ id: randomUUID(), title: `${P} Carte du projet`, type: "canvas", parentId: project.id, section: "projects" });
  await call("canvas_get", "GET", `/api/canvases/${cv.id}`);
  const data = { format: "spn-canvas-1", nodes: [{ id: "n1", kind: "page", x: 0, y: 0, w: 240, h: 120, z: 0, pageId: a.id }, { id: "n2", kind: "text", x: 320, y: 20, w: 200, h: 80, z: 1, text: "Hypothèse H1", color: "#3157d5" }], edges: [{ id: "e1", from: "n1", to: "n2", label: "motive", kind: "arrow" }], viewport: { x: 0, y: 0, zoom: 1 } };
  await call("canvas_put", "PUT", `/api/canvases/${cv.id}`, { data, baseVersion: 1 }); await call("canvas_conflict", "PUT", `/api/canvases/${cv.id}`, { data: { ...data, nodes: [] , edges: [] }, baseVersion: 1 }); await call("canvas_bad", "PUT", `/api/canvases/${cv.id}`, { data: { format: "v0" }, baseVersion: 2 });
  await call("canvas_not_canvas", "GET", `/api/canvases/${a.id}`);
  const dbPage = await mk({ title: `${P} Lectures`, type: "database", section: "databases" }); const prop = (await call(null, "POST", `/api/databases/${dbPage.id}/properties`, { id: randomUUID(), name: "Année", type: "number" })).json;
  const row = (await call("row_create", "POST", `/api/databases/${dbPage.id}/rows`, { id: randomUUID(), pageId: randomUUID(), title: "Engle (1982)", values: { [prop.id]: 1982 } })).json; made.pages.push(row.pageId);
  const form = new FormData(); const bytes = Buffer.from("0123456789".repeat(20)); const attId = randomUUID(); made.atts.push(attId); form.set("file", new Blob([bytes], { type: "audio/mpeg" }), "memo.mp3"); form.set("id", attId); form.set("pageId", a.id); await call("attachment_upload", "POST", "/api/attachments", form);
  await call("file_range", "GET", `/api/files/${attId}`, undefined, { range: "bytes=0-9" }); await call("file_range_416", "GET", `/api/files/${attId}`, undefined, { range: "bytes=500-" });
  const f = (await call("sync_entities", "GET", `/api/sync?kinds=all&since=${head0}&limit=500`)).json;
  (out.sync_entities as any).body = { ...f, pages: `[… ${f.pages.length} pages, same shape as 2.x …]`, entities: Object.fromEntries(Object.entries(f.entities as Record<string, any[]>).map(([k, v]) => [k, v.slice(0, 1).concat(v.length > 1 ? [`… ${v.length - 1} more`] as any : [])])) };
  await call("sync_2x", "GET", `/api/sync?since=${f.head}&limit=5`); await call("sync_bad_kinds", "GET", "/api/sync?kinds=task,unicorn");
  await call("events", "GET", `/api/events?pageId=${a.id}&limit=4`); await call("events_project", "GET", `/api/events?projectId=${project.id}&kinds=relation.*,task.*&limit=3`);
  const tm = await call("timemachine_page", "GET", `/api/timemachine?at=${encodeURIComponent(new Date().toISOString())}&pageId=${b.id}`); void tm;
  await call("timemachine_project", "GET", `/api/timemachine?at=${encodeURIComponent(new Date().toISOString())}&projectId=${project.id}`);
  await call("graph_local", "GET", `/api/graph?view=local&pageId=${a.id}&depth=1`); await call("graph_timeline", "GET", `/api/graph?view=timeline&from=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`).then(() => { const g = (out.graph_timeline as any).body; (out.graph_timeline as any).body = { view: g.view, nodes: `[… ${g.nodes.length} nodes …]`, edges: `[… ${g.edges.length} edges …]`, center: g.center, range: g.range, buckets: g.buckets, stats: g.stats }; });
  await call("insights_run", "POST", "/api/graph/insights/run", { mode: "deterministic" }); await call("insights", "GET", "/api/graph/insights?limit=5");
  const ins = (out.insights as any).body.insights.find((i: any) => i.kind === "recurring_topic"); if (ins) await call("insight_patch", "PATCH", `/api/graph/insights/${ins.id}`, { status: "dismissed" });
  await call("health", "GET", "/api/health/knowledge"); await call("brief", "GET", "/api/brief?tz=America/Toronto");
  await call("query_tasks", "POST", "/api/query", { source: "tasks", filter: { parentId: a.id, status: "all" }, limit: 10 }); await call("query_database", "POST", "/api/query", { source: "database", databaseId: dbPage.id, limit: 10 }); await call("query_backlinks", "POST", "/api/query", { source: "backlinks", pageId: b.id });
  await call("zoom2", "GET", `/api/pages/${a.id}/zoom?level=2`); await call("zoom1", "GET", `/api/pages/${a.id}/zoom?level=1&cachedOnly=1`); // cachedOnly: recording the examples never calls a model
  await call("error_bad_id", "GET", "/api/pages/not-a-uuid"); await call("error_cycle", "PATCH", `/api/pages/${project.id}`, { parentId: a.id }); await call("tags", "GET", "/api/tags");
  await call("export_md", "GET", `/api/export?format=md&pageId=${a.id}`);
  const versions = (await call(null, "GET", `/api/pages/${a.id}/versions`)).json; void versions;
  out._catalogue = { entityKinds: ENTITY_KINDS, entityColumns: Object.fromEntries(ENTITY_KINDS.map((k) => [k, Object.keys(ENTITIES[k].cols)])), eventKinds: EVENT_KINDS, relTypes: REL_TYPES, features: FEATURES, nodeLimits: NEXT_LIMITS, canvasLimits: CANVAS_LIMITS, generatedAt: new Date().toISOString(), base: BASE };
} finally {
  const mine = await db.select({ id: schema.pages.id }).from(schema.pages).where(like(schema.pages.title, `${P}%`)); const ids = [...new Set([...made.pages, ...mine.map((m) => m.id)])];
  if (made.tasks.length) await db.delete(schema.tasks).where(inArray(schema.tasks.id, made.tasks)); if (made.concepts.length) await db.delete(schema.concepts).where(inArray(schema.concepts.id, made.concepts));
  if (ids.length) { await db.delete(schema.tasks).where(inArray(schema.tasks.pageId, ids)); await db.delete(schema.knowledgeEdges).where(inArray(schema.knowledgeEdges.fromId, ids)); await db.delete(schema.attachments).where(inArray(schema.attachments.pageId, ids)); await db.delete(schema.pages).where(inArray(schema.pages.id, ids)); await db.delete(schema.knowledgeEvents).where(inArray(schema.knowledgeEvents.pageId, ids)); await db.delete(schema.syncTombstones).where(inArray(schema.syncTombstones.id, ids)); }
  if (made.atts.length) await db.delete(schema.attachments).where(inArray(schema.attachments.id, made.atts)); if (made.refs.length) { await db.delete(schema.researchReferences).where(inArray(schema.researchReferences.id, made.refs)); await db.delete(schema.knowledgeEvents).where(inArray(schema.knowledgeEvents.entityId, made.refs)); }
  await db.delete(schema.knowledgeInsights).where(and(eq(schema.knowledgeInsights.origin, "system"), gte(schema.knowledgeInsights.createdAt, STARTED))); // only what this run produced await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id)); await db.delete(schema.tags).where(inArray(schema.tags.name, ["garch", "thèse"]));
  await db.delete(schema.syncTombstones).where(and(inArray(schema.syncTombstones.kind, ["task", "edge", "concept", "reference", "canvas", "database", "database_property", "database_view", "database_row", "attachment"]), gte(schema.syncTombstones.deletedAt, STARTED)));
  await sql.end();
}
// examples recorded by another workstream's scenario (e.g. `constellation`, which needs embedded pages) are kept as they are
try { const prev = JSON.parse(fs.readFileSync("docs/next/examples.json", "utf8")) as Record<string, unknown>; for (const [k, v] of Object.entries(prev)) if (!(k in out)) out[k] = v; } catch { /* first run */ }
fs.mkdirSync("docs/next", { recursive: true }); fs.writeFileSync("docs/next/examples.json", JSON.stringify(out, null, 2) + "\n"); console.log("docs/next/examples.json:", Object.keys(out).length, "entries");
