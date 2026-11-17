import { execFileSync } from "node:child_process";
import fs from "node:fs";
import postgres from "postgres";
import type { BrowserContext, Page, CDPSession } from "@playwright/test";
import "../helpers/testdb";

export const AUTH_DIR = "test-results/.auth"; export const STATE = `${AUTH_DIR}/state.json`; export const CRED = `${AUTH_DIR}/credential.json`;
export const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
/** Run the passkey admin CLI exactly as the operator would on the node. */
export function cli(...args: string[]): string { return execFileSync("node", ["node_modules/tsx/dist/cli.mjs", "src/cli/auth.ts", ...args], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] }); }
export function enrollmentToken(out: string): string { const m = out.match(/\/enroll#([A-Za-z0-9_-]{40,64})/); if (!m) throw new Error("no enrollment link in CLI output"); return m[1]; }
/** Chrome DevTools virtual authenticator: platform (internal), resident keys, user verification simulated as successful unless told otherwise. */
export async function virtualAuthenticator(page: Page, opts: { userVerified?: boolean } = {}): Promise<{ cdp: CDPSession; id: string }> {
  const cdp = await page.context().newCDPSession(page); await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: opts.userVerified ?? true, automaticPresenceSimulation: true } });
  return { cdp, id: authenticatorId };
}
export async function saveCredential(cdp: CDPSession, id: string) { const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId: id }); fs.mkdirSync(AUTH_DIR, { recursive: true }); fs.writeFileSync(CRED, JSON.stringify(credentials[0]), { mode: 0o600 }); return credentials[0]; }
/** Give a fresh page the passkey enrolled by global setup (so it can sign in or step up). */
export async function withSavedPasskey(page: Page) { const a = await virtualAuthenticator(page); const credential = JSON.parse(fs.readFileSync(CRED, "utf8"));
  // A real authenticator never rewinds its signature counter (the server refuses that as a clone). Each import therefore starts above every earlier use.
  credential.signCount = Math.floor((Date.now() - 1_794_000_000_000) / 10);
  await a.cdp.send("WebAuthn.addCredential", { authenticatorId: a.id, credential }); return a; }
export async function saveState(ctx: BrowserContext) { fs.mkdirSync(AUTH_DIR, { recursive: true }); await ctx.storageState({ path: STATE }); }
/** No element may be wider than the viewport, and the document must not scroll sideways. */
export async function expectNoHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => { const w = document.documentElement.clientWidth; const bad: string[] = []; if (document.documentElement.scrollWidth > w + 1) bad.push(`document scrollWidth ${document.documentElement.scrollWidth} > ${w}`); const main = document.getElementById("main-scroll"); if (main && main.scrollWidth > main.clientWidth + 1) bad.push(`main scrollWidth ${main.scrollWidth} > ${main.clientWidth}`); return bad; });
  if (r.length) throw new Error(`Horizontal overflow: ${r.join("; ")}`);
}
