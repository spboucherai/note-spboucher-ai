/**
 * =============================================================================
 * SP BOUCHER | SOURCE FILE
 * =============================================================================
 * Project      : Note SPBoucher AI
 * File         : public/sw.js
 * Author       : Simon-Pierre Boucher | https://spboucher.ai
 * Contact      : contact@spboucher.ai
 * Copyright    : (c) 2026 Simon-Pierre Boucher
 * License      : None specified (no license file in this repository)
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

/*
 * Note SPBoucher AI — service worker (v3, offline-first).
 * What is cached (Cache Storage): ONLY public, non-personal files — hashed build assets (/_next/static), icons, the manifest and the static
 * app shell served at /offline with the assets it needs. What is never cached, read or stored in the HTTP cache: API responses, page
 * HTML, React Server Component payloads, uploaded files (/api/files) — everything personal always comes from the network with the
 * session cookie, so nothing private can be served from a cache to another session or survive a sign-out.
 * Offline, a navigation that cannot reach the server gets the app shell: a static page with no data in it, which then reads the
 * device replica (IndexedDB "note-local", see src/lib/client/offline.ts — erased by "Lock this device" / sign-out). The one thing this
 * worker reads from that database: an image added offline and not uploaded yet, served at its future address /api/files/<id> so the
 * note that references it shows it (network first; the device copy only when the server does not have the file yet).
 * Updates: a new worker waits until the page says SKIP_WAITING (the app shows "A new version is ready"), so an edit is never interrupted.
 */
const VERSION = "note-static-v4";
const SHELL_URL = "/offline";
const SHELL = [SHELL_URL, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon.svg", "/icons/apple-touch-icon.png"];
const NAV_TIMEOUT_MS = 12000;
const isStatic = (url) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");

/** (Re)cache the app shell and every build asset it references (scripts, styles, and the fonts the styles reference). */
async function cacheShell() {
  const cache = await caches.open(VERSION);
  await cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })));
  try {
    const html = await (await cache.match(SHELL_URL)).text();
    const assets = [...new Set([...html.matchAll(/["'(](\/_next\/static\/[^"'()\s\\]+)/g)].map((m) => m[1]))];
    const add = async (a) => { if (await cache.match(a)) return; const res = await fetch(a); if (res.ok && res.type === "basic") await cache.put(a, res.clone()); return res; };
    await Promise.all(assets.map(async (a) => {
      try {
        await add(a);
        if (a.endsWith(".css")) { const css = await (await cache.match(a)).text(); await Promise.all([...new Set([...css.matchAll(/url\(["']?(\/_next\/static\/[^"')\s]+)/g)].map((m) => m[1]))].map((f) => add(f).catch(() => {}))); }
      } catch (_) { /* best effort */ }
    }));
  } catch (_) { /* best effort */ }
}
self.addEventListener("install", (e) => { e.waitUntil(cacheShell()); });
self.addEventListener("activate", (e) => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k); await self.clients.claim(); })()); });
self.addEventListener("message", (e) => {
  if (!e.data) return;
  if (e.data.type === "SKIP_WAITING") self.skipWaiting();
  // The app asks for this at each online start, so the shell kept for offline use is the one of the running build.
  if (e.data.type === "REFRESH_SHELL") e.waitUntil(cacheShell().then(() => { if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true }); }).catch(() => { if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: false }); }));
});

/** An image queued on this device (IndexedDB store "blobs"), or null. */
function queuedBlob(id) {
  return new Promise((resolve) => {
    let req; try { req = indexedDB.open("note-local"); } catch (_) { return resolve(null); }
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => { try { req.transaction.abort(); } catch (_) { /* the database did not exist: do not create it here */ } };
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains("blobs")) { db.close(); return resolve(null); }
        const get = db.transaction("blobs", "readonly").objectStore("blobs").get(id);
        get.onsuccess = () => { const v = get.result; db.close(); resolve(v && v.file ? new Response(v.file, { status: 200, headers: { "content-type": v.mime || "application/octet-stream", "cache-control": "no-store", "x-note-local": "1" } }) : null); };
        get.onerror = () => { db.close(); resolve(null); };
      } catch (_) { try { db.close(); } catch (__) { /* ignore */ } resolve(null); }
    };
  });
}
async function navigate(req) {
  let timer;
  try {
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), NAV_TIMEOUT_MS); });
    return await Promise.race([fetch(req), late]);
  } catch (_) {
    return (await caches.match(SHELL_URL)) || new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
  } finally { clearTimeout(timer); }
}
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  if (isStatic(url)) { // immutable, content-hashed, public
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })));
    return;
  }
  if (req.mode === "navigate") { e.respondWith(navigate(req)); return; } // personal HTML: network only; unreachable → the static app shell
  const file = url.pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/i);
  if (file) { // never cached; the device copy of an image still waiting to be uploaded stands in when the server cannot answer with it
    e.respondWith(fetch(req).then(async (res) => (res.status === 404 ? (await queuedBlob(file[1].toLowerCase())) || res : res)).catch(async () => (await queuedBlob(file[1].toLowerCase())) || new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } })));
    return;
  }
  // everything else (API, RSC): untouched, straight to the network
});
