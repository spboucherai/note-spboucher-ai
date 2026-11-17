/*
 * Note SPBoucher AI — service worker (v2).
 * What is cached: ONLY public, non-personal files — hashed build assets (/_next/static), icons, the manifest and the static "Offline" page
 * with the assets it needs. What is never cached, read or stored here: API responses, page HTML, React Server Component payloads,
 * uploaded files (/api/files) — everything personal always comes from the network with the session cookie, so nothing private can be
 * served from a cache to another session or survive a sign-out. Unsent text lives in IndexedDB (see src/lib/client/offline.ts), not here.
 * Updates: a new worker waits until the page says SKIP_WAITING (the app shows "A new version is ready"), so an edit is never interrupted.
 */
const VERSION = "note-static-v3";
const SHELL = ["/offline", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon.svg", "/icons/apple-touch-icon.png"];
const isStatic = (url) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })));
    // Pre-cache the CSS/JS the offline page references, so it renders without a network.
    try { const html = await (await cache.match("/offline")).text(); const assets = [...html.matchAll(/["'(](\/_next\/static\/[^"'()\s\\]+)/g)].map((m) => m[1]); await Promise.all([...new Set(assets)].map((a) => cache.add(a).catch(() => {}))); } catch (_) { /* best effort */ }
  })());
});
self.addEventListener("activate", (e) => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k); await self.clients.claim(); })()); });
self.addEventListener("message", (e) => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  if (isStatic(url)) { // immutable, content-hashed, public
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })));
    return;
  }
  if (req.mode === "navigate") { // personal HTML: network only; offline → the generic page
    e.respondWith(fetch(req).catch(async () => (await caches.match("/offline")) || new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } })));
  }
  // everything else (API, RSC, files): untouched, straight to the network
});
