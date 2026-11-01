import { generateSecret, generateURI, verifySync } from "otplib";
const totpOk = (token: string, secret: string) => { try { const r: any = verifySync({ secret, token, epochTolerance: 30 }); return typeof r === "boolean" ? r : Boolean(r?.valid); } catch { return false; } };
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, markMfaPassed, clientIp } from "@/lib/auth/session";
import { assertSameOrigin, jsonError, HttpError } from "@/lib/auth/guard";
import { rateLimit } from "@/lib/auth/ratelimit";
import { audit } from "@/lib/audit";
import { headers } from "next/headers";
import QRCode from "qrcode";

/** POST { code } → verify TOTP for the pending session.  PUT { action: "setup" | "enable" | "disable", code? } → manage 2FA. */
export async function POST(req: Request) {
  try {
    await assertSameOrigin();
    const s = await getSession(); if (!s) throw new HttpError(401, "Unauthenticated");
    const ip = clientIp(await headers());
    if (!rateLimit(`totp:${ip}`, 8, 10 * 60_000)) throw new HttpError(429, "Too many attempts");
    const { code } = await req.json();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.id));
    if (!u.totpSecret || !totpOk(String(code ?? ""), u.totpSecret)) { await audit(s.id, "auth.totp_failed", undefined, {}, ip); throw new HttpError(401, "Invalid code"); }
    await markMfaPassed(s.sessionId); await audit(s.id, "auth.totp_ok");
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
export async function PUT(req: Request) {
  try {
    await assertSameOrigin();
    const s = await getSession(); if (!s) throw new HttpError(401, "Unauthenticated");
    if (s.totpEnabled && !s.mfaPassed) throw new HttpError(403, "MFA required");
    const { action, code } = await req.json();
    if (action === "setup") {
      const secret = generateSecret();
      await db.update(schema.users).set({ totpSecret: secret, totpEnabled: false }).where(eq(schema.users.id, s.id));
      const uri = generateURI({ issuer: "Note SPBoucher AI", label: s.username, secret });
      return Response.json({ secret, qr: await QRCode.toDataURL(uri) });
    }
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.id));
    if (action === "enable") {
      if (!u.totpSecret || !totpOk(String(code ?? ""), u.totpSecret)) throw new HttpError(400, "Invalid code");
      await db.update(schema.users).set({ totpEnabled: true }).where(eq(schema.users.id, s.id)); await markMfaPassed(s.sessionId); await audit(s.id, "auth.totp_enabled");
      return Response.json({ ok: true });
    }
    if (action === "disable") {
      if (!u.totpSecret || !totpOk(String(code ?? ""), u.totpSecret)) throw new HttpError(400, "Invalid code");
      await db.update(schema.users).set({ totpEnabled: false, totpSecret: null }).where(eq(schema.users.id, s.id)); await audit(s.id, "auth.totp_disabled");
      return Response.json({ ok: true });
    }
    throw new HttpError(400, "Unknown action");
  } catch (e) { return jsonError(e); }
}
