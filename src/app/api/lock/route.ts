import { assertSameOrigin, jsonError } from "@/lib/auth/guard";
import { ACCESS_COOKIE } from "@/lib/access";
/** POST /api/lock → forget the access cookie on this device (the gate shows again). */
export async function POST() {
  try {
    await assertSameOrigin();
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": `${ACCESS_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}` } });
  } catch (e) { return jsonError(e); }
}
