import { and, eq, gt, count, sql as dsql } from "drizzle-orm";
import { verify } from "@node-rs/argon2";
import { db, schema } from "@/db";
import { ACCESS_COOKIE, cookieOptions, accessToken, safeNext, clientIp, absolute } from "@/lib/access";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const PER_IP = 5, GLOBAL = 30, WINDOW_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const go = (req: Request, loc: string, cookie?: string) => {
  const h = new Headers({ Location: absolute(loc, req.url), "cache-control": "no-store", "X-Robots-Tag": "noindex" });
  if (cookie) h.append("set-cookie", `${ACCESS_COOKIE}=${cookie}; Path=/; Max-Age=${cookieOptions.maxAge}; HttpOnly; SameSite=Lax${cookieOptions.secure ? "; Secure" : ""}`);
  return new Response(null, { status: 303, headers: h });
};
/** The hash is stored base64url-encoded so `$` signs never meet dotenv/bash expansion. */
function passwordHash(): string | null {
  const raw = process.env.ACCESS_PASSWORD_HASH ?? ""; if (!raw) return null;
  const s = raw.startsWith("b64:") ? Buffer.from(raw.slice(4), "base64url").toString("utf8") : raw;
  return s.startsWith("$argon2") ? s : null;
}

/** POST /api/gate (form): shared password → access cookie. 5 failures/min per IP, 30/min globally, delay on failure, failures logged. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const next = safeNext(String(form?.get("next") ?? "/")); const pw = String(form?.get("password") ?? "").slice(0, 128);
  const ip = clientIp(req.headers); const back = (e: number) => `/gate?next=${encodeURIComponent(next)}&e=${e}`;
  const since = new Date(Date.now() - WINDOW_MS);
  const [mine] = await db.select({ n: count() }).from(schema.loginAttempts).where(and(eq(schema.loginAttempts.ip, ip), eq(schema.loginAttempts.success, false), gt(schema.loginAttempts.createdAt, since)));
  const [all] = await db.select({ n: count() }).from(schema.loginAttempts).where(and(eq(schema.loginAttempts.success, false), gt(schema.loginAttempts.createdAt, since)));
  if (mine.n >= PER_IP || all.n >= GLOBAL) { console.warn(`[gate] rate-limited ip=${ip} ipFailures=${mine.n} globalFailures=${all.n}`); await sleep(800); return go(req, back(2)); }
  const hash = passwordHash(); const token = await accessToken();
  const ok = Boolean(hash && token && pw && (await verify(hash, pw).catch(() => false)));
  await db.insert(schema.loginAttempts).values({ ip, username: "gate", success: ok });
  if (Math.random() < 0.05) await db.delete(schema.loginAttempts).where(dsql`created_at < now() - interval '30 days'`);
  if (!ok) {
    console.warn(`[gate] failed attempt ip=${ip} ua=${(req.headers.get("user-agent") ?? "").slice(0, 80)}`);
    await audit(null, "access.gate_failed", undefined, { ua: req.headers.get("user-agent")?.slice(0, 200) ?? null }, ip);
    await sleep(400 + Math.floor(Math.random() * 400));
    return go(req, back(1));
  }
  await audit(null, "access.gate_unlocked", undefined, { ua: req.headers.get("user-agent")?.slice(0, 200) ?? null }, ip);
  return go(req, next, token!);
}
