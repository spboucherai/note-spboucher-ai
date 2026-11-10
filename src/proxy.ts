import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, cookieOptions, accessToken, hasAccess, isAccessKey, safeNext, absolute } from "@/lib/access";

/** Reachable without the access cookie: health probe (mld), gate form + its POST, PWA assets, build assets. */
const PUBLIC = [/^\/api\/health$/, /^\/api\/gate$/, /^\/gate$/, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icons\//, /^\/_next\//, /^\/favicon/];
const ROBOTS = "User-agent: *\nDisallow: /\n";
const noindex = (res: NextResponse) => { res.headers.set("X-Robots-Tag", "noindex, nofollow"); return res; };

export async function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (pathname === "/robots.txt") return noindex(new NextResponse(ROBOTS, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } }));

  // Bookmark unlock: /unlock/<key> or ?k=<key> on any path.
  const fromPath = pathname.startsWith("/unlock/") ? decodeURIComponent(pathname.slice("/unlock/".length)) : null;
  const candidate = fromPath ?? searchParams.get("k");
  if (candidate !== null || pathname === "/unlock") {
    if (candidate && (await isAccessKey(candidate))) {
      const token = (await accessToken())!;
      let dest = "/";
      if (fromPath === null) { const u = new URL(req.nextUrl.toString()); u.searchParams.delete("k"); dest = safeNext(u.pathname + (u.search || "")); }
      const res = new NextResponse(null, { status: 303, headers: { Location: absolute(dest, req.url), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
      res.cookies.set(ACCESS_COOKIE, token, cookieOptions);
      return noindex(res);
    }
    return noindex(new NextResponse("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }));
  }

  const ok = await hasAccess(req.cookies.get(ACCESS_COOKIE)?.value);
  if (pathname === "/gate" && ok) return new NextResponse(null, { status: 303, headers: { Location: absolute(safeNext(searchParams.get("next")), req.url) } });
  if (PUBLIC.some((re) => re.test(pathname))) return noindex(NextResponse.next());
  if (ok) return noindex(NextResponse.next());
  if (pathname.startsWith("/api/")) return noindex(NextResponse.json({ error: "Locked" }, { status: 401, headers: { "cache-control": "no-store" } }));
  // Everything else: render the neutral gate in place (URL unchanged), then come back here after the password.
  const url = req.nextUrl.clone(); url.pathname = "/gate"; url.search = ""; url.searchParams.set("next", pathname + (req.nextUrl.search || ""));
  const res = NextResponse.rewrite(url); res.headers.set("cache-control", "no-store"); return noindex(res);
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
