/**
 * file: tests/unit/next-p-offline.test.ts
 * description: pure rules of the web offline-first layer — mutation journal (request mapping with client ids, coalescing, de-duplication,
 *   error classification, labels), offline image bounds, and the canonical JSON behind the integrity hash.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canQueueImage, classify, describe, mergeIntoQueue, requestOf, IMAGE_MAX, BLOBS_MAX, type JournalEntry } from "../../src/lib/client/journal-core";
import { stableJson, INTEGRITY_ALGORITHM } from "../../src/lib/stable-json";

let n = 0;
const E = (kind: JournalEntry["kind"], entityId: string, body: Record<string, unknown> = {}, extra: Partial<JournalEntry> = {}): JournalEntry => ({ seq: ++n, id: `k${n}`, kind, entityId, body, createdAt: n, attempts: 0, state: "pending", ...extra });
const P = "11111111-1111-4111-8111-111111111111", Q = "22222222-2222-4222-8222-222222222222";

test("journal: every entry maps to one request, creates carry the client id", () => {
  assert.deepEqual(requestOf(E("page.create", P, { title: "A", section: "notes" })), { method: "POST", url: "/api/pages", json: { title: "A", section: "notes", id: P } });
  assert.deepEqual(requestOf(E("page.update", P, { pinned: true })), { method: "PATCH", url: `/api/pages/${P}`, json: { pinned: true } });
  assert.deepEqual(requestOf(E("page.trash", P)), { method: "DELETE", url: `/api/pages/${P}` });
  assert.deepEqual(requestOf(E("page.restore", P)), { method: "POST", url: `/api/pages/${P}?action=restore` });
  assert.deepEqual(requestOf(E("page.tags", P, { tags: ["a", "b"] })), { method: "PUT", url: `/api/pages/${P}/tags`, json: { tags: ["a", "b"] } });
  assert.deepEqual(requestOf(E("task.create", Q, { title: "T", pageId: P })), { method: "POST", url: "/api/tasks", json: { title: "T", pageId: P, id: Q } });
  assert.deepEqual(requestOf(E("task.update", Q, { status: "done" })), { method: "PATCH", url: `/api/tasks/${Q}`, json: { status: "done" } });
  assert.deepEqual(requestOf(E("task.delete", Q)), { method: "DELETE", url: `/api/tasks/${Q}` });
  assert.equal(requestOf(E("upload", Q)).upload, true);
  // a body can never smuggle another id into a create
  assert.equal((requestOf(E("page.create", P, { id: Q })).json as any).id, P);
});
test("journal: a create already queued is not queued twice (de-duplication)", () => {
  const q = [E("page.create", P, { title: "A" })];
  assert.deepEqual(mergeIntoQueue(q, E("page.create", P, { title: "A" })), { skip: true });
  assert.deepEqual(mergeIntoQueue([E("task.create", Q, { title: "T" }, { state: "failed" })], E("task.create", Q, { title: "T" })), { skip: true }, "even when the first attempt was refused");
  assert.ok("put" in mergeIntoQueue(q, E("page.create", Q, { title: "B" })));
});
test("journal: consecutive updates of one entity are one entry; the order of effects is never changed", () => {
  const u1 = E("page.update", P, { pinned: true, title: "A" }); const m = mergeIntoQueue([u1], E("page.update", P, { title: "B", archived: true }));
  assert.ok("put" in m); assert.equal(m.put.seq, u1.seq); assert.equal(m.put.id, u1.id, "same idempotency key"); assert.deepEqual(m.put.body, { pinned: true, title: "B", archived: true });
  // an update separated from the previous one by a trash is NOT merged backwards
  const q = [E("page.update", P, { pinned: true }), E("page.trash", P)]; const next = E("page.update", P, { pinned: false }); const r = mergeIntoQueue(q, next); assert.ok("put" in r); assert.equal(r.put, next);
  // another entity in between does not prevent the merge (per-entity order is what matters)
  const a = E("page.update", P, { pinned: true }); const r2 = mergeIntoQueue([a, E("page.update", Q, { pinned: true })], E("page.update", P, { pinned: false })); assert.ok("put" in r2); assert.equal(r2.put.seq, a.seq); assert.deepEqual(r2.put.body, { pinned: false });
  const t = mergeIntoQueue([E("page.tags", P, { tags: ["a"] })], E("page.tags", P, { tags: ["a", "b"] })); assert.ok("put" in t); assert.deepEqual(t.put.body, { tags: ["a", "b"] });
  const tk = mergeIntoQueue([E("task.update", Q, { title: "x" })], E("task.update", Q, { status: "done" })); assert.ok("put" in tk); assert.deepEqual(tk.put.body, { title: "x", status: "done" });
});
test("journal: an update folds into a create that was never sent, only with keys the create route accepts", () => {
  const c = E("page.create", P, { title: "" }); const m = mergeIntoQueue([c], E("page.update", P, { title: "Named", section: "projects" }));
  assert.ok("put" in m); assert.equal(m.put.kind, "page.create"); assert.deepEqual(m.put.body, { title: "Named", section: "projects" });
  const pin = E("page.update", P, { pinned: true }); const m2 = mergeIntoQueue([c], pin); assert.ok("put" in m2); assert.equal(m2.put, pin, "pinned is not a create field: appended");
  const sent = E("page.create", P, { title: "" }, { attempts: 1 }); const up = E("page.update", P, { title: "Late" }); const m3 = mergeIntoQueue([sent], up); assert.ok("put" in m3); assert.equal(m3.put, up, "a create already attempted may have reached the server: never rewritten");
  const tc = E("task.create", Q, { title: "T" }); const m4 = mergeIntoQueue([tc], E("task.update", Q, { status: "done" })); assert.ok("put" in m4); assert.equal(m4.put.kind, "task.create"); assert.deepEqual(m4.put.body, { title: "T", status: "done" });
  // a failed entry never absorbs anything
  const failed = E("page.update", P, { title: "bad" }, { state: "failed" }); const nx = E("page.update", P, { pinned: true }); const m5 = mergeIntoQueue([failed], nx); assert.ok("put" in m5); assert.equal(m5.put, nx);
});
test("journal: classification — transient errors stop the replay, refusals are parked, a deletion of something gone is done", () => {
  for (const s of [0, 500, 502, 503, 401, 408, 425, 429]) assert.equal(classify("page.update", s), "retry", String(s));
  for (const s of [200, 201, 204]) assert.equal(classify("page.create", s), "done");
  for (const s of [400, 403, 404, 409, 413, 422]) assert.equal(classify("page.update", s), "failed", String(s));
  assert.equal(classify("page.trash", 404), "done"); assert.equal(classify("task.delete", 404), "done"); assert.equal(classify("task.update", 404), "failed"); assert.equal(classify("page.create", 409), "failed");
});
test("journal: labels shown in the inspector", () => {
  assert.equal(describe(E("page.create", P, { title: "Plan" })), "New note “Plan”"); assert.equal(describe(E("page.create", P, { title: "" })), "New note");
  assert.equal(describe(E("page.update", P, { pinned: true })), "Pin"); assert.equal(describe(E("page.update", P, { archived: true })), "Archive"); assert.equal(describe(E("page.update", P, { parentId: Q, position: 3 })), "Move");
  assert.equal(describe(E("page.update", P, { title: "New name" })), "Rename “New name”");
  assert.equal(describe(E("task.update", Q, { status: "done" })), "Complete task"); assert.equal(describe(E("task.create", Q, { title: "Call" })), "New task “Call”");
  assert.equal(describe(E("page.tags", P, { tags: ["a", "b"] })), "Tags: #a #b"); assert.equal(describe(E("upload", Q, { name: "x.png" })), "Image upload x.png"); assert.equal(describe(E("page.trash", P)), "Move to trash");
});
test("offline images: only images, 10 MB each, 100 MB queued in total", () => {
  assert.equal(IMAGE_MAX, 10 * 1024 * 1024); assert.equal(BLOBS_MAX, 100 * 1024 * 1024);
  assert.deepEqual(canQueueImage({ type: "image/png", size: 5_000 }, 0), { ok: true });
  assert.deepEqual(canQueueImage({ type: "image/jpeg", size: IMAGE_MAX }, 0), { ok: true });
  const big = canQueueImage({ type: "image/png", size: IMAGE_MAX + 1 }, 0); assert.equal(big.ok, false); assert.match((big as any).reason, /limit 10 MB/);
  const pdf = canQueueImage({ type: "application/pdf", size: 10 }, 0); assert.equal(pdf.ok, false); assert.match((pdf as any).reason, /Only images/);
  const full = canQueueImage({ type: "image/png", size: 2 }, BLOBS_MAX - 1); assert.equal(full.ok, false); assert.match((full as any).reason, /queue is full/);
});
test("integrity: canonical JSON ignores key order and undefined, keeps array order; the hash is stable across a jsonb round trip", () => {
  assert.equal(INTEGRITY_ALGORITHM, "sha256-stable-json-1");
  const a = { type: "doc", content: [{ type: "paragraph", attrs: { id: "x", textAlign: null }, content: [{ type: "text", text: "é\"\n", marks: [{ type: "bold" }] }] }] };
  const b = { content: [{ content: [{ marks: [{ type: "bold" }], text: "é\"\n", type: "text" }], attrs: { textAlign: null, id: "x", gone: undefined }, type: "paragraph" }], type: "doc" };
  assert.equal(stableJson(a), stableJson(b)); assert.equal(stableJson(a), '{"content":[{"attrs":{"id":"x","textAlign":null},"content":[{"marks":[{"type":"bold"}],"text":"é\\"\\n","type":"text"}],"type":"paragraph"}],"type":"doc"}');
  assert.notEqual(stableJson({ a: [1, 2] }), stableJson({ a: [2, 1] })); assert.equal(stableJson(null), "null"); assert.equal(stableJson([undefined, 1]), "[null,1]"); assert.equal(stableJson({ n: 1.5, t: true, s: "" }), '{"n":1.5,"s":"","t":true}');
  const h = (v: unknown) => createHash("sha256").update(stableJson(v)).digest("hex"); assert.equal(h(a), h(b)); assert.equal(h(a).length, 64);
});
