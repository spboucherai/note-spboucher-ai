import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { resolveSession } from "@/lib/auth/sessions";

/**
 * Network boundary (Next.js 16 proxy, Node.js runtime). Nothing private is rendered or returned without a valid server-side session:
 * the session token is checked against the database HERE, before any page or route handler runs, and again next to the data
 * (requireUser / requireUserPage). Reachable without a session: health probe, the sign-in and enrollment ceremonies, PWA shell assets.
 * The pre-v2 entry points (/gate, /unlock/<key>, ?k=, /api/gate, /api/lock) no longer exist and answer 404.
 */
const PUBLIC = [/^\/api\/health$/, /^\/api\/auth\/login\/(options|verify)$/, /^\/api\/auth\/enroll\/(options|verify)$/, /^\/api\/auth\/logout$/, /^\/login$/, /^\/enroll$/, /^\/offline$/, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icons\//, /^\/_next\//, /^\/favicon/];
const GONE = [/^\/gate(\/|$)/, /^\/unlock(\/|$)/, /^\/api\/gate$/, /^\/api\/lock$/];
const ROBOTS = "User-agent: *\nDisallow: /\n";
const noindex = (res: NextResponse) => { res.headers.set("X-Robots-Tag", "noindex, nofollow"); return res; };
const safeNext = (p: string) => (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/login") || p.startsWith("/enroll") || p.startsWith("/api/") ? "/" : p);

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/robots.txt") return noindex(new NextResponse(ROBOTS, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } }));
  if (GONE.some((re) => re.test(pathname))) return noindex(new NextResponse("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }));
  if (PUBLIC.some((re) => re.test(pathname))) {
    // Already signed in → no point showing the sign-in page.
    if (pathname === "/login" && (await session(req))) return NextResponse.redirect(new URL(safeNext(req.nextUrl.searchParams.get("next") ?? "/"), origin(req)), 303);
    return noindex(NextResponse.next());
  }
  if (await session(req)) { const res = NextResponse.next(); if (!pathname.startsWith("/_next/")) res.headers.set("cache-control", "private, no-store"); return noindex(res); }
  if (pathname.startsWith("/api/")) return noindex(NextResponse.json({ error: "Sign-in required", code: "unauthenticated" }, { status: 401, headers: { "cache-control": "no-store" } }));
  const to = new URL("/login", origin(req)); const next = safeNext(pathname + (search || "")); if (next !== "/") to.searchParams.set("next", next);
  const res = NextResponse.redirect(to, 303); res.headers.set("cache-control", "no-store"); return noindex(res);
}
async function session(req: NextRequest) { try { return await resolveSession(req.cookies.get(SESSION_COOKIE)?.value); } catch { return null; /* database down → fail closed */ } }
/** Absolute base for redirects: APP_URL wins over the internal request URL (the app sits behind Caddy + WireGuard). */
const origin = (req: NextRequest) => process.env.APP_URL || req.url;
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
