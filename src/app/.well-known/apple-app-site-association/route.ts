import { NextResponse } from "next/server";
/**
 * Apple app-site association: lets the native app « SP Notes » (macOS: ai.spboucher.spnotes; iOS / iPadOS: ai.spboucher.spnotes.ios — team 3YM54G49SN) use the passkeys of this
 * domain through AuthenticationServices. Public by necessity (Apple fetches it without credentials and follows no redirect); it only
 * names application identifiers. APPLE_APP_IDS (comma-separated) overrides the default list. No applinks: every web address stays in
 * the browser.
 */
const DEFAULT_APPS = ["3YM54G49SN.ai.spboucher.spnotes", "3YM54G49SN.ai.spboucher.spnotes.ios"];
export const dynamic = "force-dynamic";
export function GET() {
  const apps = (process.env.APPLE_APP_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^[A-Z0-9]{10}\.[A-Za-z0-9.-]{1,155}$/.test(s));
  return NextResponse.json({ webcredentials: { apps: apps.length ? apps : DEFAULT_APPS } }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
