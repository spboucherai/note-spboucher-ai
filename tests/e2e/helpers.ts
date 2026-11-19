import { execFileSync } from "node:child_process";
import fs from "node:fs";
import postgres from "postgres";
import type { BrowserContext, Page, CDPSession } from "@playwright/test";
import "../helpers/testdb";

export const AUTH_DIR = "test-results/.auth"; export const STATE = `${AUTH_DIR}/state.json`; export const CRED = `${AUTH_DIR}/credential.json`;
export const sql = postgres(process.env.DATABASE_URL!, { max: Math.max(1, Math.min(2, Number(process.env.DB_POOL_MAX ?? 2) || 2)), onnotice: () => {} });
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

export const ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:8481";
/** Authenticated JSON call from the test process with the browser's cookies (adds the Origin header the CSRF check requires). */
export async function apiCall(page: Page, method: "POST" | "PATCH" | "PUT" | "DELETE" | "GET", url: string, data?: unknown, headers: Record<string, string> = {}) {
  const res = await page.request.fetch(url, { method, data: data as any, headers: { origin: ORIGIN, ...(data !== undefined ? { "content-type": "application/json" } : {}), ...headers } });
  let body: any = null; try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status(), body, headers: res.headers() };
}
export const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
export const docOf = (...nodes: unknown[]) => ({ type: "doc", content: nodes });
/** Bottom-docked UI must not cover the element (e.g. the caret line or the primary action). */
export async function expectNotCovered(page: Page, selector: string) {
  const r = await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return "missing"; const b = el.getBoundingClientRect(); const x = Math.min(window.innerWidth - 2, Math.max(2, b.left + b.width / 2)), y = b.top + b.height / 2; if (y < 0 || y > window.innerHeight) return `outside viewport (y=${Math.round(y)})`; const top = document.elementFromPoint(x, y); return top && (el === top || el.contains(top) || top.contains(el)) ? "ok" : `covered by <${top?.tagName.toLowerCase()} class="${(top as HTMLElement)?.className?.toString().slice(0, 60)}">`; }, selector);
  if (r !== "ok") throw new Error(`${selector}: ${r}`);
}
/** 1×1 PNG and a minimal one-page PDF for upload tests. */
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 20 100 Td (Hello note) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n0000000211 00000 n \n0000000300 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n362\n%%EOF\n");

/**
 * Remove the 20 000-row benchmark database seeded by scripts/db-seed-bench.ts, with its rows, its index entries and the tombstones
 * of this removal. Left in the workspace it slowed every other suite down (20 000 pages to index, a 6 MB global graph) and cut the
 * scans of the knowledge suites. Each database spec seeds it in beforeAll and removes it in afterAll.
 */
export async function removeBench(bench: { pageId: string; databaseId: string } | undefined) {
  if (!bench?.pageId) return;
  const ids = (await sql`select id from pages where id = ${bench.pageId} or database_id = ${bench.databaseId}`).map((r) => r.id as string);
  await sql`delete from chunks where page_id = any(${ids}::uuid[])`; await sql`delete from index_state where source_id = any(${ids}::uuid[])`; await sql`delete from knowledge_events where page_id = any(${ids}::uuid[])`;
  await sql`delete from pages where database_id = ${bench.databaseId}`; await sql`delete from pages where id = ${bench.pageId}`;
  await sql`delete from sync_tombstones where id = any(${ids}::uuid[]) or (kind like 'database%' and deleted_at > now() - interval '2 minutes')`;
}
