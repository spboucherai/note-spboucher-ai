/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/client/sandbox.ts
 * Module           : lib
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

"use client";
/**
 * file: src/lib/client/sandbox.ts
 * description: executor of the `runCode` block (SPEC §2). The user's JavaScript never runs in the app: each run creates a hidden
 *   `<iframe sandbox="allow-scripts">` (opaque origin: no access to the app's DOM, cookies, localStorage or IndexedDB) whose document
 *   carries its own CSP (`default-src 'none'`: no fetch / XHR / WebSocket / EventSource / images / forms / remote scripts). Inside the
 *   frame the code runs in a Web Worker built from a blob, so an infinite loop cannot freeze the app; the frame itself is the fallback
 *   when a Worker cannot be created. Parent and frame talk through `postMessage` only; the parent accepts messages solely from that
 *   frame's window and carrying the per-run random token. User code is never interpolated into HTML: it is posted once the frame
 *   says it is ready. The promise never rejects because of user code.
 *   The runtime that executes in the frame/worker is kept as source text (it must be self-contained); `formatConsoleArgs` evaluates
 *   that same text lazily so the unit tests exercise exactly what ships. Nothing here does any work at import time.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */

export interface SandboxResult { text: string; error: boolean; ms: number; timedOut: boolean }
export interface SandboxOptions { /** default 5000 */ timeoutMs?: number; /** default 20000 characters */ maxOutput?: number; /** aborting stops the run (the result resolves with error:true) */ signal?: AbortSignal }

export const SANDBOX_DEFAULT_TIMEOUT_MS = 5000;
export const SANDBOX_DEFAULT_MAX_OUTPUT = 20000;
/** The only token of the iframe `sandbox` attribute. Never add allow-same-origin / allow-top-navigation / allow-popups / allow-forms / allow-modals. */
export const SANDBOX_ATTRIBUTE = "allow-scripts";
export const TRUNCATION_MARKER = "… (truncated)";
/** Time the frame has to load and say "ready" before the run is declared failed (not counted in the user's timeout). */
const BOOT_TIMEOUT_MS = 4000;

/** CSP of the frame document. The inline bootstrap is allowed by nonce; 'unsafe-eval' lets the runtime compile the user's code; workers only from blob:. */
export const sandboxCsp = (nonce: string) => `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval'; worker-src blob:; base-uri 'none'; form-action 'none'`;

/**
 * Value formatter shared by console capture and the "last value" line. Plain JavaScript source: it runs inside the worker.
 * spnFormatArgs(args, quoteStrings) → one line of text. Never throws.
 */
const FORMAT_SOURCE = String.raw`
function spnFormatArgs(args, quoteTop) {
  var MAX_DEPTH = 4, MAX_ITEMS = 100, MAX_STRING = 10000;
  function str(s, quote) { if (s.length > MAX_STRING) s = s.slice(0, MAX_STRING) + "…"; return quote ? JSON.stringify(s) : s; }
  function errText(e) {
    var name = "Error", message = "";
    try { name = String(e.name || "Error"); } catch (_) {}
    try { message = String(e.message == null ? "" : e.message); } catch (_) {}
    var out = message ? name + ": " + message : name;
    try { if (e.cause !== undefined) out += " [cause: " + fmt(e.cause, 1, [], true) + "]"; } catch (_) {}
    return out;
  }
  function tagOf(v) { try { return Object.prototype.toString.call(v).slice(8, -1); } catch (_) { return "Object"; } }
  function key(k) { return /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k); }
  function fmt(v, depth, seen, quote) {
    var t = typeof v;
    if (v === null) return "null";
    if (t === "undefined") return "undefined";
    if (t === "string") return str(v, quote);
    if (t === "number") return Object.is(v, -0) ? "-0" : String(v);
    if (t === "boolean") return String(v);
    if (t === "bigint") return String(v) + "n";
    if (t === "symbol") { try { return v.toString(); } catch (_) { return "Symbol()"; } }
    if (t === "function") { var fname = ""; try { fname = String(v.name || ""); } catch (_) {} return fname ? "[Function: " + fname + "]" : "[Function (anonymous)]"; }
    if (seen.indexOf(v) >= 0) return "[Circular]";
    var tag = tagOf(v);
    if (tag === "Error" || v instanceof Error) return errText(v);
    if (tag === "Date") { try { return isNaN(v.getTime()) ? "Invalid Date" : v.toISOString(); } catch (_) { return "Invalid Date"; } }
    if (tag === "RegExp") { try { return String(v); } catch (_) { return "/(?:)/"; } }
    if (tag === "Promise") return "Promise {}";
    if (tag === "WeakMap" || tag === "WeakSet" || tag === "WeakRef") return tag + " {}";
    if (tag === "ArrayBuffer" || tag === "SharedArrayBuffer") { try { return tag + "(" + v.byteLength + ")"; } catch (_) { return tag; } }
    if (depth >= MAX_DEPTH) return Array.isArray(v) ? "[Array]" : "[Object]";
    var next = seen.concat([v]), parts = [], n = 0, more = 0, i;
    if (Array.isArray(v) || (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(v) && tag !== "DataView")) {
      var len = v.length >>> 0;
      for (i = 0; i < len; i++) { if (n >= MAX_ITEMS) { more = len - n; break; } var item; try { item = fmt(v[i], depth + 1, next, true); } catch (_) { item = "[Throws]"; } parts.push(item); n++; }
      if (more) parts.push("… " + more + " more");
      return (Array.isArray(v) ? "" : tag + "(" + len + ") ") + "[" + parts.join(", ") + "]";
    }
    if (tag === "Map") {
      try { v.forEach(function (val, k) { if (n >= MAX_ITEMS) { more++; return; } parts.push(fmt(k, depth + 1, next, true) + " => " + fmt(val, depth + 1, next, true)); n++; }); } catch (_) { parts.push("[Throws]"); }
      if (more) parts.push("… " + more + " more");
      return "Map(" + (n + more) + ") {" + parts.join(", ") + "}";
    }
    if (tag === "Set") {
      try { v.forEach(function (val) { if (n >= MAX_ITEMS) { more++; return; } parts.push(fmt(val, depth + 1, next, true)); n++; }); } catch (_) { parts.push("[Throws]"); }
      if (more) parts.push("… " + more + " more");
      return "Set(" + (n + more) + ") {" + parts.join(", ") + "}";
    }
    var keys = []; try { keys = Object.keys(v); } catch (_) {}
    for (i = 0; i < keys.length; i++) {
      if (n >= MAX_ITEMS) { more = keys.length - n; break; }
      var val; try { val = fmt(v[keys[i]], depth + 1, next, true); } catch (_) { val = "[Throws]"; }
      parts.push(key(keys[i]) + ": " + val); n++;
    }
    if (more) parts.push("… " + more + " more");
    var cls = ""; try { var proto = Object.getPrototypeOf(v); if (proto === null) cls = "[Object: null prototype] "; else { var c = proto.constructor; if (c && typeof c.name === "string" && c.name && c.name !== "Object") cls = c.name + " "; } } catch (_) {}
    return cls + "{" + parts.join(", ") + "}";
  }
  var out = [];
  for (var a = 0; a < args.length; a++) { var piece; try { piece = fmt(args[a], 0, [], !!quoteTop); } catch (_) { piece = "[Unprintable]"; } out.push(piece); }
  return out.join(" ");
}`;

/**
 * Runs the user's code in `scope` (a worker global, or the frame's window in fallback mode) and reports through `post`:
 * {type:"out", text} chunks (rate-limited, capped) then exactly one {type:"done", error}. Plain JavaScript source.
 */
const RUNTIME_SOURCE = String.raw`
function spnRuntime(scope, post, code, maxOutput) {
  var cap = (typeof maxOutput === "number" && maxOutput > 0 ? maxOutput : 20000) + 64;
  var buf = "", sent = 0, lastFlush = 0, capped = false, errored = false, pending = 0, mainDone = false, finished = false, live = {};
  var nativeSetTimeout = scope.setTimeout, nativeSetInterval = scope.setInterval, nativeClear = scope.clearTimeout;
  function flush(force) { if (!buf) return; var now = Date.now(); if (!force && now - lastFlush < 50) return; lastFlush = now; var chunk = buf; buf = ""; post({ type: "out", text: chunk }); }
  function emit(line) { if (capped || finished) return; line = String(line); var room = cap - sent; if (line.length + 1 > room) { line = line.slice(0, Math.max(0, room)); capped = true; } sent += line.length + 1; buf += line + "\n"; flush(capped); }
  function describe(e) { try { return spnFormatArgs([e], false); } catch (_) { return "Error"; } }
  function fail(prefix, e) { errored = true; emit(prefix + describe(e)); }
  function finish() { if (finished) return; flush(true); finished = true; post({ type: "done", error: errored }); }
  function check() {
    if (finished || !mainDone || pending > 0) return;
    nativeSetTimeout.call(scope, function () { if (finished || pending > 0) return; nativeSetTimeout.call(scope, function () { if (pending > 0) return; finish(); }, 0); }, 0);
  }
  function guard(fn, args) { try { fn.apply(scope, args); } catch (e) { fail("Uncaught ", e); } }
  scope.setTimeout = function (fn, ms) {
    if (typeof fn !== "function") { fail("", new TypeError("setTimeout needs a function in the sandbox")); return 0; }
    var args = Array.prototype.slice.call(arguments, 2); pending++;
    var id = nativeSetTimeout.call(scope, function () { if (!live[id]) return; delete live[id]; guard(fn, args); pending--; check(); }, ms);
    live[id] = 1; return id;
  };
  scope.setInterval = function (fn, ms) {
    if (typeof fn !== "function") { fail("", new TypeError("setInterval needs a function in the sandbox")); return 0; }
    var args = Array.prototype.slice.call(arguments, 2); pending++;
    var id = nativeSetInterval.call(scope, function () { if (!live[id]) return; guard(fn, args); }, ms);
    live[id] = 1; return id;
  };
  scope.clearTimeout = scope.clearInterval = function (id) { if (live[id]) { delete live[id]; pending--; nativeClear.call(scope, id); check(); } };
  function printer(quote) { return function () { var s; try { s = spnFormatArgs(arguments, quote); } catch (_) { s = "[Unprintable]"; } emit(s); }; }
  var con = scope.console || {}, names = ["log", "info", "debug", "warn", "error", "trace", "table"];
  for (var i = 0; i < names.length; i++) { try { con[names[i]] = printer(false); } catch (_) {} }
  try { con.dir = printer(true); } catch (_) {}
  try { con.assert = function (ok) { if (!ok) { var rest = Array.prototype.slice.call(arguments, 1); emit("Assertion failed" + (rest.length ? ": " + spnFormatArgs(rest, false) : "")); } }; } catch (_) {}
  try { con.clear = function () {}; } catch (_) {}
  try { scope.console = con; } catch (_) {}
  if (scope.addEventListener) {
    scope.addEventListener("error", function (ev) { fail("Uncaught ", ev && (ev.error !== undefined && ev.error !== null ? ev.error : ev.message)); if (ev && ev.preventDefault) ev.preventDefault(); });
    scope.addEventListener("unhandledrejection", function (ev) { fail("Unhandled rejection: ", ev ? ev.reason : undefined); if (ev && ev.preventDefault) ev.preventDefault(); });
  }
  var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  function compile(src) {
    try { return new AsyncFunction("return (" + src + "\n)"); } catch (_) {}
    var trimmed = src.replace(/[\s;]+$/, ""), cut = Math.max(trimmed.lastIndexOf("\n"), trimmed.lastIndexOf(";"));
    if (cut >= 0) {
      var head = trimmed.slice(0, cut + 1), tail = trimmed.slice(cut + 1);
      if (/\S/.test(tail) && !/^\s*(return|throw|var|let|const|if|else|for|while|do|switch|case|default|try|catch|finally|function|async\s+function|class|break|continue|import|export|debugger)\b/.test(tail) && !/^\s*(\}|\/\/|\/\*)/.test(tail)) {
        try { return new AsyncFunction(head + "\nreturn (" + tail + "\n)"); } catch (_) {}
      }
    }
    return new AsyncFunction(src);
  }
  var fn;
  try { fn = compile(String(code == null ? "" : code)); } catch (e) { fail("", e); mainDone = true; check(); return; }
  var run;
  try { run = fn.call(undefined); } catch (e) { fail("Uncaught ", e); mainDone = true; check(); return; }
  run.then(function (v) { if (v !== undefined) emit("→ " + spnFormatArgs([v], true)); }, function (e) { fail("Uncaught ", e); }).then(function () { mainDone = true; check(); });
}`;

/** Worker script: the runtime in a closure; it announces itself, then runs the single job it receives. */
const WORKER_SOURCE = `(function () {${FORMAT_SOURCE}\n${RUNTIME_SOURCE}
  var send = self.postMessage.bind(self);
  self.onmessage = function (e) { self.onmessage = null; var d = e.data || {}; spnRuntime(self, function (m) { send(m); }, d.code, d.maxOutput); };
  send({ type: "started" });
})();`;

/** Bootstrap of the frame document. `__TOKEN__` and `__WORKER__` are replaced by buildSandboxHtml. */
const FRAME_SOURCE = String.raw`(function () {
  var TOKEN = "__TOKEN__", WORKER = __WORKER__, host = window.parent, ran = false;
  function send(m) { try { host.postMessage({ spn: TOKEN, type: String(m.type), text: typeof m.text === "string" ? m.text : "", error: !!m.error }, "*"); } catch (_) {} }
  function start(d) {
    if (ran) return; ran = true;
    var worker = null, started = false, fellBack = false, url = null;
    function inFrame() { if (fellBack || started) return; fellBack = true; try { if (worker) worker.terminate(); } catch (_) {} send({ type: "mode", text: "frame" }); spnRuntime(window, send, d.code, d.maxOutput); }
    try {
      url = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = function (e) {
        var m = e.data; if (!m || typeof m !== "object" || fellBack) return;
        if (m.type === "started") { if (started) return; started = true; try { URL.revokeObjectURL(url); } catch (_) {} send({ type: "mode", text: "worker" }); worker.postMessage({ code: d.code, maxOutput: d.maxOutput }); return; }
        if (!started) return;
        if (m.type === "out" || m.type === "done") send(m);
      };
      worker.onerror = function (e) { if (!started) inFrame(); else if (e && e.preventDefault) e.preventDefault(); };
    } catch (_) { inFrame(); }
  }
  window.addEventListener("message", function (e) { if (e.source !== host) return; var d = e.data; if (!d || typeof d !== "object" || d.spn !== TOKEN) return; if (d.type === "run" && typeof d.code === "string") start(d); });
  send({ type: "ready" });
})();`;

const NONCE_RE = /^[A-Za-z0-9]{16,64}$/;
/** 128 random bits as hex: the per-run token (message authentication) and the CSP nonce of the frame's bootstrap script. */
export function newSandboxToken(): string {
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Makes a JavaScript string literal that cannot close the surrounding <script> element or open an HTML comment. */
const inlineLiteral = (source: string) => JSON.stringify(source).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => (c.charCodeAt(0) === 0x2028 ? "\\u2028" : "\\u2029"));

/**
 * The frame document. Static apart from the token: it never contains user code. The CSP <meta> is the first element of <head>,
 * before any script, so the policy applies to everything the document (and the worker it creates) does.
 */
export function buildSandboxHtml(nonce: string = newSandboxToken()): string {
  if (!NONCE_RE.test(nonce)) throw new Error("Invalid sandbox token");
  const boot = FRAME_SOURCE.replace("__TOKEN__", nonce).replace("__WORKER__", () => inlineLiteral(WORKER_SOURCE));
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${sandboxCsp(nonce)}"><meta charset="utf-8"><title>sandbox</title></head><body><script nonce="${nonce}">${FORMAT_SOURCE}\n${RUNTIME_SOURCE}\n${boot}</script></body></html>`;
}

let formatter: ((args: unknown[], quote: boolean) => string) | null = null;
/**
 * `console.log`-style formatting of a list of values (strings raw, objects inspected, cycles and errors safe), exactly as the sandbox
 * does it: the shipped formatter source is evaluated on first call. Used by the unit tests; the app itself never needs to call it.
 */
export function formatConsoleArgs(args: unknown[], quoteStrings = false): string {
  formatter ??= new Function(`${FORMAT_SOURCE}\nreturn spnFormatArgs;`)() as (args: unknown[], quote: boolean) => string;
  return formatter(args, quoteStrings);
}
/** Source of the runtime (`spnFormatArgs` + `spnRuntime`) exactly as shipped to the frame and its worker: the tests evaluate it in an isolated realm. */
export const sandboxRuntimeSource = (): string => `${FORMAT_SOURCE}\n${RUNTIME_SOURCE}`;

/** Limits `text` to `max` characters; a marker line says so when something was cut. */
export function clampOutput(text: string, max: number = SANDBOX_DEFAULT_MAX_OUTPUT): string {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : SANDBOX_DEFAULT_MAX_OUTPUT;
  const s = typeof text === "string" ? text : String(text ?? "");
  if (s.length <= limit) return s;
  return `${s.slice(0, limit).replace(/\n$/, "")}\n${TRUNCATION_MARKER}`;
}
const seconds = (ms: number) => { const s = ms / 1000; return Number.isInteger(s) ? String(s) : s.toFixed(1); };

/**
 * Runs `code` (JavaScript) in a throw-away sandboxed frame and resolves with what it printed. Must be called from an explicit user
 * action. Resolves — never rejects — for syntax errors, exceptions, timeouts and sandbox start failures (`error: true`).
 */
export function runSandboxed(code: string, opts: SandboxOptions = {}): Promise<SandboxResult> {
  const timeoutMs = Number.isFinite(opts.timeoutMs) && (opts.timeoutMs as number) > 0 ? (opts.timeoutMs as number) : SANDBOX_DEFAULT_TIMEOUT_MS;
  const maxOutput = Number.isFinite(opts.maxOutput) && (opts.maxOutput as number) > 0 ? Math.floor(opts.maxOutput as number) : SANDBOX_DEFAULT_MAX_OUTPUT;
  return new Promise<SandboxResult>((resolve) => {
    if (typeof document === "undefined" || typeof window === "undefined") return resolve({ text: "Code can only run in a browser", error: true, ms: 0, timedOut: false });
    if (opts.signal?.aborted) return resolve({ text: "Stopped", error: true, ms: 0, timedOut: false });
    const token = newSandboxToken();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", SANDBOX_ATTRIBUTE);
    iframe.setAttribute("aria-hidden", "true"); iframe.setAttribute("tabindex", "-1"); iframe.setAttribute("title", "Code sandbox");
    iframe.setAttribute("referrerpolicy", "no-referrer"); iframe.setAttribute("allow", "");
    iframe.setAttribute("data-spn-sandbox", "");
    iframe.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;visibility:hidden";
    let text = ""; let settled = false; let startedAt = 0; let bootTimer: ReturnType<typeof setTimeout> | null = null; let runTimer: ReturnType<typeof setTimeout> | null = null;
    const elapsed = () => (startedAt ? Math.max(0, Math.round(performance.now() - startedAt)) : 0);
    const withLine = (line: string) => { const body = clampOutput(text.replace(/\n+$/, ""), maxOutput); return body ? `${body}\n${line}` : line; };
    const finish = (r: SandboxResult) => {
      if (settled) return; settled = true;
      if (bootTimer) clearTimeout(bootTimer); if (runTimer) clearTimeout(runTimer);
      window.removeEventListener("message", onMessage); opts.signal?.removeEventListener("abort", onAbort);
      // Removing the frame destroys its document and terminates the worker it owns, even one stuck in an infinite loop.
      iframe.remove();
      resolve(r);
    };
    const onAbort = () => finish({ text: withLine("Stopped"), error: true, ms: elapsed(), timedOut: false });
    function onMessage(e: MessageEvent) {
      if (settled || e.source !== iframe.contentWindow || e.source === null) return;
      const d = e.data as { spn?: unknown; type?: unknown; text?: unknown; error?: unknown } | null;
      if (!d || typeof d !== "object" || d.spn !== token) return;
      if (d.type === "ready") {
        if (startedAt) return;
        if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
        startedAt = performance.now();
        runTimer = setTimeout(() => finish({ text: withLine(`Timed out after ${seconds(timeoutMs)} s`), error: true, ms: elapsed(), timedOut: true }), timeoutMs);
        // The frame's origin is opaque ("null"), so the target origin cannot be named; the recipient is this very window object.
        iframe.contentWindow?.postMessage({ spn: token, type: "run", code: String(code ?? ""), maxOutput }, "*");
      } else if (d.type === "out") {
        if (startedAt && typeof d.text === "string" && text.length <= maxOutput) text += d.text.slice(0, maxOutput + 1 - text.length);
      } else if (d.type === "done") {
        if (startedAt) finish({ text: clampOutput(text.replace(/\n+$/, ""), maxOutput), error: d.error === true, ms: elapsed(), timedOut: false });
      }
    }
    window.addEventListener("message", onMessage);
    opts.signal?.addEventListener("abort", onAbort);
    bootTimer = setTimeout(() => finish({ text: "The sandbox could not start", error: true, ms: 0, timedOut: false }), BOOT_TIMEOUT_MS);
    try { iframe.srcdoc = buildSandboxHtml(token); (document.body ?? document.documentElement).appendChild(iframe); }
    catch { finish({ text: "The sandbox could not start", error: true, ms: 0, timedOut: false }); }
  });
}
