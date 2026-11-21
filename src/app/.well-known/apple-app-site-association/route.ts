/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/app/.well-known/apple-app-site-association/route.ts
 * Module           : app
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-18
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

import { NextResponse } from "next/server";
/**
 * Apple app-site association: lets the native app « SP Notes » (macOS: ai.spboucher.spnotes; iOS / iPadOS: ai.spboucher.spnotes.ios — team 3YM54G49SN) use the passkeys of this
 * domain through AuthenticationServices. Public by necessity (Apple fetches it without credentials and follows no redirect); it only
 * names application identifiers. APPLE_APP_IDS (comma-separated) overrides the `webcredentials` list.
 * Universal links (3.0): `applinks` hands `/p/<id>` (a page, with an optional `#<blockId>` fragment) to the iOS / iPadOS app when it is
 * installed; every other address stays in the browser. APPLE_APPLINK_IDS (comma-separated) overrides its application list.
 */
const DEFAULT_LINK_APPS = ["3YM54G49SN.ai.spboucher.spnotes.ios"];
const ids = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter((s) => /^[A-Z0-9]{10}\.[A-Za-z0-9.-]{1,155}$/.test(s));
const DEFAULT_APPS = ["3YM54G49SN.ai.spboucher.spnotes", "3YM54G49SN.ai.spboucher.spnotes.ios"];
export const dynamic = "force-dynamic";
export function GET() {
  const apps = (process.env.APPLE_APP_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^[A-Z0-9]{10}\.[A-Za-z0-9.-]{1,155}$/.test(s));
  const link = ids(process.env.APPLE_APPLINK_IDS);
  return NextResponse.json({ webcredentials: { apps: apps.length ? apps : DEFAULT_APPS }, applinks: { details: [{ appIDs: link.length ? link : DEFAULT_LINK_APPS, components: [{ "/": "/p/*", comment: "a page, optional #blockId" }] }] } }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
