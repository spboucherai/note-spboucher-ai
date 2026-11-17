/** Pure client-side logic that must not depend on a browser. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sameJson } from "../../src/lib/same-json";
import { safeNext, deviceLabel, sha256, newToken } from "../../src/lib/auth/tokens";

test("sameJson ignores key order (jsonb round trip) but not content", () => {
  assert.ok(sameJson({ type: "text", text: "a" }, { text: "a", type: "text" }));
  assert.ok(sameJson({ a: [1, { b: 2, c: 3 }], d: undefined }, { a: [1, { c: 3, b: 2 }] }));
  assert.ok(!sameJson({ a: [1, 2] }, { a: [2, 1] })); assert.ok(!sameJson({ a: 1 }, { a: 1, b: 2 })); assert.ok(!sameJson({ a: null }, { a: {} })); assert.ok(!sameJson([], {}));
});
test("post-login destinations are same-site relative paths only", () => {
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)", "/login", "/enroll#x", "/api/export", "", null, undefined]) assert.equal(safeNext(bad as any), "/", String(bad));
  assert.equal(safeNext("/p/abc?x=1#block-2"), "/p/abc?x=1#block-2");
});
test("device labels are readable and tokens are 256-bit", () => {
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1"), "Safari · iPhone");
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36"), "Chrome · Android"); assert.equal(deviceLabel(null), "Unknown device");
  const t = newToken(); assert.equal(Buffer.from(t, "base64url").length, 32); assert.notEqual(t, newToken()); assert.equal(sha256(t).length, 64);
});

import { ensureBlockIds } from "../../src/lib/editor/text";
test("block ids are added once, kept when present, and duplicates are repaired", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", attrs: { id: "keepme0001" }, content: [{ type: "text", text: "a" }] }, { type: "paragraph", content: [{ type: "text", text: "b" }] }, { type: "paragraph", attrs: { id: "keepme0001" } }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }] };
  const r = ensureBlockIds(doc as any); assert.equal(r.changed, true); const c = (r.doc as any).content;
  assert.equal(c[0].attrs.id, "keepme0001"); assert.match(c[1].attrs.id, /^[\w-]{10}$/); assert.notEqual(c[2].attrs.id, "keepme0001"); assert.ok(c[3].attrs.id); assert.ok(c[3].content[0].content[0].attrs.id); assert.equal(c[3].content[0].attrs?.id, undefined, "list items carry no id");
  assert.equal(doc.content[1].attrs, undefined, "the input is not mutated");
  const again = ensureBlockIds(r.doc); assert.equal(again.changed, false); assert.equal(again.doc, r.doc);
});
