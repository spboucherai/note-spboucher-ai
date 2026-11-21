/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/e2e/next-p-cv-phones.spec.ts
 * Description      : capture, Smart Inbox and voice notes on phones (360×740,
 *                    375×667, 430×932, touch, iPhone user agent): the capture
 *                    sheet with its four kinds and a shared link fits the
 *                    screen, the AI checklist of the inbox is usable with a
 *                    finger and applies on the real server, a voice note with
 *                    transcript, AI summary and its actions never widens the
 *                    page. The model's answer is simulated (route); nothing
 *                    here calls a provider.
 * Module           : tests
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apiCall, docOf, para, expectNoHorizontalOverflow, sql, PDF } from "./helpers";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.homedir(), "dev/note-next-p-cv-data/shots"); const canShoot = fs.existsSync(SHOTS);
const shot = async (page: Page, name: string, t: { project: { name: string } }) => { if (canShoot) await page.screenshot({ path: path.join(SHOTS, `${name}-${t.project.name.replace("next-p-cv-", "")}.png`) }); };
const made: string[] = []; const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const find = (n: any, type: string): any[] => [...(n?.type === type ? [n] : []), ...((n?.content ?? []) as any[]).flatMap((c) => find(c, type))];
const server = async (page: Page, id: string) => (await apiCall(page, "GET", `/api/pages/${id}`)).body;
const waitFor = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("condition not met in time"); await new Promise((r) => setTimeout(r, 300)); } };
const tall = async (page: Page, loc: ReturnType<Page["locator"]>, min = 44) => { const b = await loc.boundingBox(); expect(b, "element is laid out").toBeTruthy(); expect(Math.round(b!.height)).toBeGreaterThanOrEqual(min); expect(b!.x).toBeGreaterThanOrEqual(0); expect(b!.x + b!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1); };
test.afterAll(async () => {
  const mine = await sql`select id from pages where title like '%E2E-pcvp%'`; const ids = [...new Set([...made, ...mine.map((r) => r.id)])];
  if (ids.length) { await sql`delete from inbox_actions where page_id = any(${ids}::uuid[])`; await sql`delete from attachments where page_id = any(${ids}::uuid[])`; await sql`delete from pages where id = any(${ids}::uuid[])`; }
  await sql`delete from tags where name like 'e2epcvp%'`;
});

test("capture sheet on a phone: four kinds, a shared link prefilled, a PDF attached — everything fits and the capture lands", async ({ page }, t) => {
  const tag = uid(); await page.goto(`/share?title=${encodeURIComponent(`E2E-pcvp a rather long shared title that has to wrap on a narrow phone ${tag}`)}&url=${encodeURIComponent(`https://example.org/e2e-pcvp-a-long-address-that-does-not-break-easily-${tag}`)}`);
  const s = page.getByRole("dialog", { name: "Quick capture" }); await expect(s).toBeVisible(); await expect(s.getByTestId("capture-origin")).toHaveText("Shared with SP Note"); await expect(s.getByRole("radio")).toHaveText(["Note", "Idea", "To-do", "Link"]);
  await expect(s.getByRole("radio", { name: "Link" })).toHaveAttribute("aria-checked", "true"); await page.waitForTimeout(350); // the sheet's entrance is over
  for (const r of await s.getByRole("radio").all()) { await expect(r).toBeInViewport({ ratio: 1 }); const b = await r.boundingBox(); expect(b!.height).toBeGreaterThanOrEqual(40); }
  await s.locator("input[type=file]").setInputFiles({ name: `E2E-pcvp piece jointe au nom vraiment tres long ${tag}.pdf`, mimeType: "application/pdf", buffer: PDF });
  await expect(s.getByRole("list", { name: "Attachments" })).toContainText("E2E-pcvp piece jointe"); await expectNoHorizontalOverflow(page);
  const w = page.viewportSize()!.width; const box = await s.boundingBox(); expect(box!.width).toBeLessThanOrEqual(w + 1); expect(await s.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(s.getByRole("button", { name: "Capture", exact: true })).toBeInViewport({ ratio: 1 }); await tall(page, s.getByRole("button", { name: "Capture", exact: true })); await tall(page, s.getByRole("button", { name: "Attach a file, PDF or scan" })); await shot(page, "phone-capture-share", t);
  await s.getByRole("button", { name: "Capture", exact: true }).tap(); await expect(s).toBeHidden(); await expect(page.getByText("Captured to inbox")).toBeVisible();
  const row = await waitFor(async () => (await sql`select id, capture_kind, content from pages where capture_kind = 'link' and content::text like ${`%e2e-pcvp-a-long-address-that-does-not-break-easily-${tag}%`}`)[0]); made.push(row.id);
  expect(find(row.content, "fileBlock").length + find(row.content, "pdf").length).toBe(1); await expect(page).toHaveURL(/\/inbox$/); await expectNoHorizontalOverflow(page);
});

test("smart inbox on a phone: filter chips scroll, the AI checklist is finger-sized, applies on the server and is undone", async ({ page }, t) => {
  await page.goto("/"); const tag = uid(); const rel = (await apiCall(page, "POST", "/api/pages", { title: `E2E-pcvp page liée avec un titre plutôt long pour un téléphone ${tag}` })).body; made.push(rel.id);
  const cap = (await apiCall(page, "POST", "/api/capture", { kind: "note", text: `E2E-pcvp capture ${tag}\nUne capture dont le texte est assez long pour remplir deux lignes sur un téléphone étroit.` })).body; made.push(cap.id);
  for (const k of ["tasks", "selection", "idea"]) made.push((await apiCall(page, "POST", "/api/capture", { kind: k, text: `E2E-pcvp ${k} ${tag}` })).body.id);
  await page.route("**/api/inbox/*/suggestions*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ pageId: cap.id, contentHash: "0".repeat(32), status: "ready", ai: true, model: "claude-haiku-5-5", provider: "anthropic", generatedAt: new Date().toISOString(), cached: false, costUsd: 0.0001,
    suggestions: { title: { value: `E2E-pcvp Un titre proposé par le modèle, volontairement long pour vérifier le retour à la ligne ${tag}`, current: cap.title }, tags: [{ name: `e2epcvp${tag}`, existing: false }, { name: `e2epcvp-une-etiquette-tres-longue-sans-espace-${tag}`.slice(0, 40), existing: true }], destination: { section: "research", parentId: null, parentTitle: null }, relations: [{ pageId: rel.id, title: rel.title, icon: "📎", reason: "Une raison détaillée qui explique longuement pourquoi les deux pages sont liées l'une à l'autre." }], summary: "Un résumé de deux phrases. Il doit rester lisible et modifiable sur un petit écran sans jamais élargir la page." } }) }));
  await page.goto("/inbox"); const filters = page.getByRole("group", { name: "Filter by kind of capture" }); await expect(filters).toBeVisible(); await expectNoHorizontalOverflow(page);
  await filters.getByRole("button", { name: /^Selections/ }).tap(); await expect(page.getByRole("listitem").filter({ hasText: `E2E-pcvp selection ${tag}` })).toBeVisible(); await expect(page.getByRole("listitem").filter({ hasText: cap.title })).toHaveCount(0); await filters.getByRole("button", { name: /^All/ }).tap();
  const card = page.getByRole("listitem").filter({ hasText: cap.title }); await card.scrollIntoViewIfNeeded(); for (const name of [/^File$/, /^Archive$/, /^More actions/, /^Suggest with AI/]) await tall(page, card.getByRole("button", { name }));
  await card.getByRole("button", { name: /^Suggest with AI/ }).tap(); const panel = card.getByTestId("inbox-suggestions"); await expect(panel.getByRole("checkbox")).toHaveCount(6); await expect(panel.locator(".ai-mark")).toHaveText("AI suggestions");
  await expectNoHorizontalOverflow(page); expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "the checklist does not scroll sideways").toBe(true);
  for (const li of await panel.getByRole("listitem").all()) { const b = await li.boundingBox(); expect(b!.height).toBeGreaterThanOrEqual(44); }
  await panel.scrollIntoViewIfNeeded(); await shot(page, "phone-inbox-suggestions", t);
  await panel.getByRole("checkbox", { name: `Tag: e2epcvp${tag}` }).tap(); await panel.getByRole("checkbox", { name: /^Summary/ }).tap(); const apply = panel.getByRole("button", { name: "Apply 2 selected" }); await apply.scrollIntoViewIfNeeded(); await tall(page, apply); await apply.tap();
  await expect(page.getByText("2 suggestions applied")).toBeVisible(); const after = await server(page, cap.id); expect(after.inboxAt).toBeTruthy(); expect(after.title).toBe(cap.title); expect(find(after.content, "aiBlock")[0].attrs.action).toBe("summary");
  expect((await sql`select t.name from page_tags pt join tags t on t.id = pt.tag_id where pt.page_id = ${cap.id}`).map((r) => r.name)).toEqual([`e2epcvp${tag}`]);
  await tall(page, page.getByRole("button", { name: "Undo" }), 40); /* the shared toast action is 40 px high */ await page.getByRole("button", { name: "Undo" }).tap(); await expect(page.getByText("Undone")).toBeVisible();
  const undone = await server(page, cap.id); expect(find(undone.content, "aiBlock").length).toBe(0); expect((await sql`select 1 from page_tags where page_id = ${cap.id}`).length).toBe(0); await expectNoHorizontalOverflow(page);
});

test("voice note on a phone: transcript, AI summary and its actions fit; lines and actions are finger-sized; insertion works", async ({ page }, t) => {
  await page.goto("/"); const tag = uid();
  const transcript = [{ t: 0, text: "Réunion du budget avec une première phrase suffisamment longue pour revenir à la ligne sur un téléphone étroit." }, { t: 65, text: "Unmottrèslongsansaucunespacequipourraitélargirlapagesilenétaitpascoupécorrectement." }, { t: 130, text: "Marie envoie le contrat lundi." }];
  const summary = { text: "Le budget est revu. Le taux fixe est retenu pour cinq ans et le contrat part lundi.", decisions: ["Retenir le taux fixe pour cinq ans, sans option de remboursement anticipé"], tasks: ["Marie : envoyer le contrat signé à la banque lundi matin", "Appeler le notaire"], model: "gpt-test-mini-with-a-long-model-name", at: "2026-11-19T10:00:00.000Z" };
  const node = { type: "audio", attrs: { attachmentId: null, duration: 140, title: "Réunion budget", recordedAt: null, transcript, transcriptStatus: "done", transcriptEngine: "openai:whisper-1", summary } };
  const p = (await apiCall(page, "POST", "/api/pages", { title: `E2E-pcvp voice ${tag}`, content: docOf(node, para("tail")) })).body; made.push(p.id);
  await page.goto(`/p/${p.id}?hl=contrat`); const block = page.locator(".nb[data-node='audio']"); await expect(block.getByRole("list", { name: "Transcript" }).getByRole("button")).toHaveCount(3);
  await expect(block.getByRole("note")).toHaveText("The original audio was deleted — the transcript is kept."); await expect(block.getByTestId("au-hits")).toHaveText("1 transcript line matches your search"); await expect(block.getByRole("region", { name: "AI summary" }).locator(".au-ai-mark")).toHaveText("AI summary");
  await expectNoHorizontalOverflow(page); expect(await block.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const line of await block.locator(".au-line").all()) { const b = await line.boundingBox(); expect(b!.height).toBeGreaterThanOrEqual(44); }
  const tasks = block.getByRole("button", { name: "Insert as tasks" }); await tasks.scrollIntoViewIfNeeded(); await tall(page, tasks); await tall(page, block.getByRole("button", { name: "Insert summary" })); await shot(page, "phone-voice-summary", t);
  await tasks.tap(); const doc = await waitFor(async () => { const d = (await server(page, p.id)).content; return find(d, "aiBlock").length === 1 ? d : null; }); expect(find(doc, "taskItem").length).toBe(2); expect(find(doc, "aiBlock")[0].attrs.action).toBe("tasks");
  await expectNoHorizontalOverflow(page);
});
