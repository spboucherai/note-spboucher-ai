/**
 * file: tests/unit/next-web-sandbox.test.ts
 * description: pure parts of the runCode sandbox (src/lib/client/sandbox.ts): the frame document (CSP first, no user code, no way to
 *   close the script element), console formatting, output clamping, and the shipped runtime executed against a fake global (capture,
 *   last value, errors, top-level await, timers, output cap). The isolation itself (opaque origin, CSP, kill on timeout) needs a
 *   browser and is asserted by the Playwright suite.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildSandboxHtml, clampOutput, formatConsoleArgs, newSandboxToken, runSandboxed, sandboxCsp, sandboxRuntimeSource, SANDBOX_ATTRIBUTE, TRUNCATION_MARKER } from "../../src/lib/client/sandbox";

test("sandbox html: the CSP meta comes before any script and denies everything but the nonce'd bootstrap and blob workers", () => {
  const token = "a1b2c3d4e5f60718293a4b5c6d7e8f90"; const html = buildSandboxHtml(token);
  const meta = html.indexOf('<meta http-equiv="Content-Security-Policy"'); const script = html.indexOf("<script");
  assert.ok(meta > 0 && script > meta, "CSP meta precedes the first script");
  assert.equal(html.indexOf("<meta"), meta, "the CSP is the first meta of the document");
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
  assert.equal(csp, sandboxCsp(token));
  assert.equal(csp, `default-src 'none'; script-src 'nonce-${token}' 'unsafe-eval'; worker-src blob:; base-uri 'none'; form-action 'none'`);
  for (const forbidden of ["connect-src", "img-src", "frame-src", "'unsafe-inline'", "http:", "https:", "'self'", "*"]) assert.ok(!csp.includes(forbidden), `CSP must not contain ${forbidden}`);
  assert.equal(html.match(/<script/g)!.length, 1, "one script element"); assert.equal(html.match(/<\/script/g)!.length, 1, "nothing inside the bootstrap can close the script element");
  assert.ok(html.includes(`<script nonce="${token}">`)); assert.ok(!html.includes("<!--"));
  assert.ok(!/\bsrc=|href=|<img|<link|<form|<iframe/i.test(html), "the frame document loads nothing");
});
test("sandbox html: static apart from the token — user code is never part of it", () => {
  const a = buildSandboxHtml("0000000000000000aaaaaaaaaaaaaaaa"), b = buildSandboxHtml("1111111111111111bbbbbbbbbbbbbbbb");
  assert.equal(a.replaceAll("0000000000000000aaaaaaaaaaaaaaaa", "T"), b.replaceAll("1111111111111111bbbbbbbbbbbbbbbb", "T"));
  assert.equal(buildSandboxHtml.length, 0, "no parameter for code (the token is optional)");
  assert.ok(!a.includes("__TOKEN__") && !a.includes("__WORKER__"));
  assert.ok(a.includes('d.type === "run"') && a.includes("e.source !== host"), "the code arrives by postMessage from the parent window only");
  assert.ok(a.includes('"*"'), "opaque origin: replies are addressed to window.parent");
  for (const bad of ["", "short", "abc\"><script>alert(1)</script>", "aaaaaaaaaaaaaaaa'bbbb", "aaaaaaaaaaaaaaaa bbbb", "é".repeat(20)]) assert.throws(() => buildSandboxHtml(bad), /Invalid sandbox token/);
  const t = newSandboxToken(); assert.match(t, /^[0-9a-f]{32}$/); assert.notEqual(t, newSandboxToken()); assert.ok(buildSandboxHtml().length > 1000);
});
test("the iframe sandbox attribute is allow-scripts alone", () => {
  assert.equal(SANDBOX_ATTRIBUTE, "allow-scripts");
});
test("runSandboxed outside a browser resolves with an error instead of throwing", async () => {
  const r = await runSandboxed("1 + 1"); assert.deepEqual(r, { text: "Code can only run in a browser", error: true, ms: 0, timedOut: false });
});

test("formatConsoleArgs: primitives", () => {
  assert.equal(formatConsoleArgs(["a", 1, true, null, undefined]), "a 1 true null undefined");
  assert.equal(formatConsoleArgs([]), ""); assert.equal(formatConsoleArgs([""]), "");
  assert.equal(formatConsoleArgs([10n, -0, NaN, Infinity]), "10n -0 NaN Infinity");
  assert.equal(formatConsoleArgs([12345678901234567890123n]), "12345678901234567890123n");
  assert.equal(formatConsoleArgs([Symbol("s")]), "Symbol(s)");
  assert.equal(formatConsoleArgs([function named() {}, () => {}]), "[Function: named] [Function (anonymous)]");
  assert.equal(formatConsoleArgs(["top"], true), '"top"', "the last-value line quotes strings");
});
test("formatConsoleArgs: objects, arrays, collections", () => {
  assert.equal(formatConsoleArgs([{ a: 1, b: "x", "c-d": [1, "2", null, undefined], e: { f: 2n } }]), '{a: 1, b: "x", "c-d": [1, "2", null, undefined], e: {f: 2n}}');
  assert.equal(formatConsoleArgs([[1, [2, [3]]]]), "[1, [2, [3]]]"); assert.equal(formatConsoleArgs([{}]), "{}"); assert.equal(formatConsoleArgs([[]]), "[]");
  assert.equal(formatConsoleArgs([new Map<unknown, unknown>([["k", 1], [2, { a: 1 }]])]), 'Map(2) {"k" => 1, 2 => {a: 1}}');
  assert.equal(formatConsoleArgs([new Set([1, "a"])]), 'Set(2) {1, "a"}');
  assert.equal(formatConsoleArgs([new Uint8Array([1, 2, 3])]), "Uint8Array(3) [1, 2, 3]");
  assert.equal(formatConsoleArgs([new Date(0)]), "1970-01-01T00:00:00.000Z"); assert.equal(formatConsoleArgs([new Date(NaN)]), "Invalid Date");
  assert.equal(formatConsoleArgs([/a+/gi]), "/a+/gi"); assert.equal(formatConsoleArgs([Promise.resolve(1)]), "Promise {}");
  class Point { x = 1; y = 2; } assert.equal(formatConsoleArgs([new Point()]), "Point {x: 1, y: 2}");
  assert.equal(formatConsoleArgs([Object.create(null)]), "[Object: null prototype] {}");
});
test("formatConsoleArgs: cycles, depth, size and hostile objects never throw", () => {
  const o: any = { name: "o" }; o.self = o; o.list = [o, { back: o }];
  assert.equal(formatConsoleArgs([o]), '{name: "o", self: [Circular], list: [[Circular], {back: [Circular]}]}');
  const shared = { v: 1 }; assert.equal(formatConsoleArgs([{ a: shared, b: shared }]), "{a: {v: 1}, b: {v: 1}}", "a repeated reference is not a cycle");
  assert.equal(formatConsoleArgs([{ a: { b: { c: { d: { e: 1 } } } } }]), "{a: {b: {c: {d: [Object]}}}}");
  assert.equal(formatConsoleArgs([[[[[[1]]]]]]), "[[[[[Array]]]]]");
  const big = formatConsoleArgs([Array.from({ length: 250 }, (_, i) => i)]); assert.ok(big.endsWith(", … 150 more]")); assert.ok(big.length < 600);
  assert.equal(formatConsoleArgs(["x".repeat(20000)]).length, 10001, "very long strings are cut");
  const hostile = { get boom() { throw new Error("no"); }, ok: 1 }; assert.equal(formatConsoleArgs([hostile]), "{boom: [Throws], ok: 1}");
  const proxy = new Proxy({}, { ownKeys() { throw new Error("trap"); }, getPrototypeOf() { throw new Error("trap"); } }); assert.doesNotThrow(() => formatConsoleArgs([proxy]));
  const liar = { toString() { throw new Error("x"); }, get name() { throw new Error("y"); } }; assert.doesNotThrow(() => formatConsoleArgs([liar]));
});
test("formatConsoleArgs: errors", () => {
  assert.equal(formatConsoleArgs([new TypeError("bad")]), "TypeError: bad"); assert.equal(formatConsoleArgs([new Error("")]), "Error");
  assert.equal(formatConsoleArgs([new Error("outer", { cause: new RangeError("inner") })]), "Error: outer [cause: RangeError: inner]");
  assert.equal(formatConsoleArgs([{ e: new Error("in") }]), "{e: Error: in}");
  class MyError extends Error { constructor(m: string) { super(m); this.name = "MyError"; } } assert.equal(formatConsoleArgs(["failed:", new MyError("why")]), "failed: MyError: why");
});

test("clampOutput", () => {
  assert.equal(clampOutput("short", 10), "short"); assert.equal(clampOutput("", 10), ""); assert.equal(clampOutput("0123456789", 10), "0123456789");
  assert.equal(clampOutput("0123456789A", 10), `0123456789\n${TRUNCATION_MARKER}`);
  assert.equal(clampOutput("abcd\nefgh", 5), `abcd\n${TRUNCATION_MARKER}`, "no blank line before the marker");
  assert.equal(TRUNCATION_MARKER, "… (truncated)");
  const long = "x".repeat(50000); assert.equal(clampOutput(long).length, 20000 + 1 + TRUNCATION_MARKER.length); assert.ok(clampOutput(long).endsWith("… (truncated)"));
  assert.equal(clampOutput("abc", 0).length, 3, "a nonsensical limit falls back to the default"); assert.equal(clampOutput("abc", NaN), "abc");
  assert.equal(clampOutput(undefined as unknown as string, 5), "");
});

/** Runs the shipped runtime in a separate realm standing in for the worker global (so `console`, timers and globals are the patched ones) and collects what it posts. */
function execute(code: string, maxOutput = 20000, waitMs = 1500): Promise<{ text: string; error: boolean; done: number }> {
  return new Promise((resolve, reject) => {
    let text = ""; let done = 0;
    const context = vm.createContext({
      setTimeout: (f: () => void, ms?: number) => Number(setTimeout(f, ms)), setInterval: (f: () => void, ms?: number) => Number(setInterval(f, ms)), clearTimeout: (id: number) => clearTimeout(id), clearInterval: (id: number) => clearInterval(id),
      console: {}, addEventListener: () => {},
    });
    const scope = vm.runInContext("globalThis", context); const runtime = vm.runInContext(`${sandboxRuntimeSource()}\nspnRuntime`, context);
    const guard = setTimeout(() => reject(new Error(`runtime did not finish: ${JSON.stringify(text)}`)), waitMs);
    runtime(scope, (m: { type: string; text?: string; error?: boolean }) => {
      if (m.type === "out") text += m.text; else if (m.type === "done") { done++; clearTimeout(guard); setTimeout(() => resolve({ text: text.replace(/\n$/, ""), error: !!m.error, done }), 20); }
    }, code, maxOutput);
  });
}
test("runtime: console capture and the value of the last expression", async () => {
  assert.deepEqual(await execute("1 + 1"), { text: "→ 2", error: false, done: 1 });
  assert.deepEqual(await execute('console.log("a", { b: [1] }); console.warn("w"); console.error(new Error("e")); "end"'), { text: 'a {b: [1]}\nw\nError: e\n→ "end"', error: false, done: 1 });
  assert.equal((await execute("const a = 2;\nconst b = 3;\na * b")).text, "→ 6");
  assert.equal((await execute("let s = 0; for (let i = 1; i <= 4; i++) s += i; s")).text, "→ 10");
  assert.equal((await execute("return 5")).text, "→ 5"); assert.equal((await execute("console.log(1)")).text, "1");
  assert.equal((await execute("const x = 1;")).text, ""); assert.equal((await execute("")).text, "");
  assert.equal((await execute("const o = {}; o.o = o; o")).text, "→ {o: [Circular]}");
  assert.equal((await execute("console.assert(1 === 2, 'math'); console.assert(true)")).text, "Assertion failed: math");
});
test("runtime: top-level await, promises and timers are awaited before the run is done", async () => {
  assert.deepEqual(await execute("const v = await Promise.resolve(41); v + 1"), { text: "→ 42", error: false, done: 1 });
  assert.equal((await execute("await new Promise((r) => setTimeout(r, 30)); console.log('after'); 7")).text, "after\n→ 7");
  assert.equal((await execute("setTimeout(() => console.log('late'), 40); console.log('first')")).text, "first\nlate");
  assert.equal((await execute("let n = 0; const id = setInterval(() => { console.log(++n); if (n === 3) clearInterval(id); }, 5); 'started'")).text, '→ "started"\n1\n2\n3');
  assert.equal((await execute("const id = setTimeout(() => console.log('never'), 20); clearTimeout(id); 'ok'")).text, '→ "ok"');
});
test("runtime: syntax errors, exceptions and rejections are reported with error:true and never thrown", async () => {
  const syntax = await execute("let = ;"); assert.equal(syntax.error, true); assert.match(syntax.text, /^SyntaxError: /);
  assert.deepEqual(await execute("console.log('before'); throw new TypeError('boom')"), { text: "before\nUncaught TypeError: boom", error: true, done: 1 });
  assert.deepEqual(await execute("null.x"), { text: (await execute("null.x")).text, error: true, done: 1 }); assert.match((await execute("null.x")).text, /^Uncaught TypeError: /);
  assert.deepEqual(await execute("await Promise.reject(new Error('nope'))"), { text: "Uncaught Error: nope", error: true, done: 1 });
  assert.deepEqual(await execute("throw 'plain'"), { text: "Uncaught plain", error: true, done: 1 });
  assert.deepEqual(await execute("setTimeout(() => { throw new Error('in timer') }, 5); 1"), { text: "→ 1\nUncaught Error: in timer", error: true, done: 1 });
  assert.equal((await execute("setTimeout('alert(1)', 0)")).error, true, "string timers are refused");
});
test("runtime: output is capped at the source and a flood cannot grow without bound", async () => {
  const r = await execute("for (let i = 0; i < 100000; i++) console.log('line ' + i); 'done'", 500);
  assert.equal(r.error, false); assert.ok(r.text.length <= 500 + 64, `capped (${r.text.length})`); assert.ok(r.text.startsWith("line 0\nline 1\n"));
  assert.ok(clampOutput(r.text, 500).endsWith(TRUNCATION_MARKER));
});

/**
 * Boots the frame document's script in a fake frame realm. `withWorker` gives it a Worker that evaluates the blob in its own realm
 * (as a browser would); without it Worker creation throws and the in-frame fallback must take over.
 */
function bootFrame(token: string, withWorker: boolean) {
  const html = buildSandboxHtml(token); const script = /<script nonce="[0-9a-f]+">([\s\S]*)<\/script>/.exec(html)![1];
  const toParent: any[] = []; const handlers: Record<string, ((e: any) => void)[]> = {}; const host = { postMessage: (m: any, origin: string) => { assert.equal(origin, "*"); toParent.push({ ...m }); /* copied into this realm, as structured clone would */ } };
  const timers = { setTimeout: (f: () => void, ms?: number) => Number(setTimeout(f, ms)), setInterval: (f: () => void, ms?: number) => Number(setInterval(f, ms)), clearTimeout: (id: number) => clearTimeout(id), clearInterval: (id: number) => clearInterval(id) };
  const blobs = new Map<string, string>(); let workers = 0;
  class FakeBlob { text: string; constructor(parts: string[]) { this.text = parts.join(""); } }
  class FakeWorker {
    onmessage: ((e: any) => void) | null = null; onerror: ((e: any) => void) | null = null; private self: any;
    constructor(url: string) {
      if (!withWorker) throw new Error("SecurityError"); workers++;
      const source = blobs.get(url)!; const ctx = vm.createContext({ ...timers, console: {}, addEventListener: () => {}, postMessage: (m: any) => setTimeout(() => this.onmessage?.({ data: m }), 0) });
      this.self = vm.runInContext("globalThis.self = globalThis", ctx); setTimeout(() => vm.runInContext(source, ctx), 0);
    }
    postMessage(m: any) { setTimeout(() => this.self.onmessage?.({ data: m }), 0); }
    terminate() {}
  }
  const context = vm.createContext({ ...timers, console: {}, parent: host, Blob: FakeBlob, Worker: FakeWorker, URL: { createObjectURL: (b: FakeBlob) => { const u = `blob:null/${blobs.size}`; blobs.set(u, b.text); return u; }, revokeObjectURL: () => {} },
    addEventListener: (name: string, fn: (e: any) => void) => { (handlers[name] ??= []).push(fn); } });
  vm.runInContext("globalThis.window = globalThis", context);
  new vm.Script(script); vm.runInContext(script, context);
  const deliver = (data: any, source: any = host) => handlers.message?.forEach((fn) => fn({ data, source }));
  const settle = async (ms = 150) => { await new Promise((r) => setTimeout(r, ms)); return toParent; };
  return { toParent, deliver, settle, host, workers: () => workers, workerSource: () => [...blobs.values()][0] };
}
const outputOf = (messages: any[]) => messages.filter((m) => m.type === "out").map((m) => m.text).join("");

test("frame bootstrap: valid script, announces ready with the token, accepts a run only from its parent and with the token", async () => {
  const token = "feedfacefeedfacefeedfacefeedface"; const f = bootFrame(token, false);
  assert.deepEqual(f.toParent, [{ spn: token, type: "ready", text: "", error: false }]);
  f.deliver({ spn: "wrongwrongwrongwrongwrongwrong00", type: "run", code: "console.log('bad token')" });
  f.deliver({ spn: token, type: "run", code: "console.log('wrong source')" }, { postMessage() {} });
  f.deliver({ spn: token, type: "run", code: 42 }); f.deliver(null); f.deliver("run");
  assert.equal((await f.settle(60)).length, 1, "nothing ran");
  f.deliver({ spn: token, type: "run", code: "console.log('ok'); 6 * 7", maxOutput: 1000 });
  f.deliver({ spn: token, type: "run", code: "console.log('second run refused')" });
  const messages = await f.settle();
  assert.ok(messages.every((m) => m.spn === token && typeof m.text === "string" && typeof m.error === "boolean"), "every message carries the token and plain fields only");
  assert.deepEqual(messages.map((m) => m.type).filter((t) => t !== "out"), ["ready", "mode", "done"]); assert.equal(messages.find((m) => m.type === "mode").text, "frame", "Worker refused → in-frame fallback");
  assert.equal(outputOf(messages), "ok\n→ 42\n"); assert.equal(messages.at(-1).error, false);
});
test("frame bootstrap: the code runs in a blob Worker when one can be created, and errors come back flagged", async () => {
  const token = "0123456789abcdef0123456789abcdef"; const f = bootFrame(token, true);
  f.deliver({ spn: token, type: "run", code: "console.log(typeof window, typeof self); await new Promise((r) => setTimeout(r, 10)); throw new RangeError('from worker')", maxOutput: 1000 });
  const messages = await f.settle(250);
  assert.equal(f.workers(), 1); assert.equal(messages.find((m) => m.type === "mode").text, "worker");
  assert.equal(outputOf(messages), "undefined object\nUncaught RangeError: from worker\n"); assert.deepEqual(messages.at(-1), { spn: token, type: "done", text: "", error: true });
  assert.doesNotThrow(() => new vm.Script(f.workerSource()), "the worker source is valid JavaScript"); assert.ok(!f.workerSource().includes("from worker"), "the worker blob is static: the code is posted to it");
});
