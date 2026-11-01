import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/login/, /^\/api\/auth\//, /^\/api\/health$/, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icons\//, /^\/_next\//, /^\/favicon/, /^\/offline/];
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-note_session" : "note_session";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  const hasCookie = Boolean(req.cookies.get(COOKIE)?.value);
  if (!hasCookie) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    const url = req.nextUrl.clone(); url.pathname = "/login"; url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
