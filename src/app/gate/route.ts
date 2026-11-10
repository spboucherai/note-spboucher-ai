import { gatePageHtml } from "@/lib/gate-page";
import { safeNext } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Access-code page (self-contained HTML, on-screen keypad with its own Enter key). POSTs to /api/gate. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams; const e = sp.get("e");
  const html = gatePageHtml({ brand: "spb.note", lang: "en", next: safeNext(sp.get("next") ?? "/"), error: e === "1" ? "bad" : e === "2" ? "limited" : null, accent: ["#f59e0b", "#ef4444"] });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "X-Robots-Tag": "noindex, nofollow", "referrer-policy": "no-referrer" } });
}
