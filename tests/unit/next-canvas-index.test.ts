/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/next-canvas-index.test.ts
 * Description      : the text written on a canvas is searchable — `putCanvas`
 *                    copies the text of the cards (text, LaTeX, addresses, edge
 *                    labels) into the plain text of the canvas page (full-text
 *                    `tsv`, word count), keeps it in step with later saves, and
 *                    a rename of the page does not erase it. Runs against a
 *                    *_dev database.
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

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { workspace, mk, cleanup } from "../helpers/next";
import { putCanvas } from "../../src/lib/canvas/service";
import { EMPTY_CANVAS, type CanvasData } from "../../src/lib/canvas/format";
import { updatePage } from "../../src/lib/pages/service";
import http from "node:http";
import type { AddressInfo } from "node:net";

let ws: string; const PFX = "nx-canvas-index ·";
before(async () => { ws = await workspace(); }); after(() => cleanup(ws, PFX));
const plain = async (id: string) => { const [p] = await db.select({ plainText: schema.pages.plainText, wordCount: schema.pages.wordCount }).from(schema.pages).where(eq(schema.pages.id, id)); return p; };
const fts = async (q: string) => (await sql`select id from pages where workspace_id = ${ws} and deleted_at is null and tsv @@ plainto_tsquery('simple', ${q})`).map((r) => r.id as string);

test("saving a canvas indexes the text of its cards and edge labels into the page; later saves replace it; a rename keeps it", async () => {
  const p = await mk(ws, `${PFX} map`, undefined, { type: "canvas" });
  assert.equal((await plain(p.id)).plainText, "");
  const data: CanvasData = { ...EMPTY_CANVAS(), nodes: [
    { id: "a", kind: "text", x: 0, y: 0, w: 200, h: 80, z: 0, text: "Zygomorphic hypothesis about prices" },
    { id: "b", kind: "math", x: 300, y: 0, w: 200, h: 80, z: 1, latex: "\\sigma_t^2" },
    { id: "c", kind: "link", x: 600, y: 0, w: 200, h: 80, z: 2, url: "https://example.org/quokkapaper", text: "Quokka paper" },
    { id: "d", kind: "table", x: 0, y: 200, w: 200, h: 80, z: 3, text: "| Year | Rate |\n| --- | --- |\n| 2025 | wombatrate |" },
  ], edges: [{ id: "e1", from: "a", to: "b", label: "xylophonic link" }] };
  await putCanvas(ws, p.id, data, 1);
  const one = await plain(p.id);
  assert.equal(one.plainText, "Zygomorphic hypothesis about prices\n\\sigma_t^2\nQuokka paper\nhttps://example.org/quokkapaper\nYear Rate\n2025 wombatrate\nxylophonic link");
  assert.equal(one.wordCount > 8, true);
  for (const word of ["zygomorphic", "quokka", "wombatrate", "xylophonic"]) assert.ok((await fts(word)).includes(p.id), `full-text search finds the canvas by "${word}"`);
  await updatePage(ws, p.id, { title: `${PFX} map renamed` });
  assert.ok((await fts("zygomorphic")).includes(p.id), "renaming the page keeps the canvas text");
  await putCanvas(ws, p.id, { ...data, nodes: data.nodes.slice(1), edges: [] }, 2);
  assert.ok(!(await fts("zygomorphic")).includes(p.id), "text of a removed card is no longer found"); assert.ok(!(await fts("xylophonic")).includes(p.id)); assert.ok((await fts("quokka")).includes(p.id));
  await putCanvas(ws, p.id, EMPTY_CANVAS(), 3); assert.deepEqual(await plain(p.id), { plainText: "", wordCount: 0 });
});

test("the index worker reads a canvas page from its cards' text: passages are stored and the search finds the canvas (fake embeddings endpoint, no network)", async () => {
  // local stand-in for the embeddings API: same wire format, constant vectors — no key, no cost
  const seen: string[] = [];
  const server = http.createServer((req, res) => { let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { const input: string[] = JSON.parse(body).input; seen.push(...input); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ object: "list", model: "fake", data: input.map((_t, index) => ({ object: "embedding", index, embedding: Array.from({ length: 1536 }, (_v, i) => (i === 0 ? 1 : 0)) })), usage: { prompt_tokens: 1, total_tokens: 1 } })); }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const saved = { url: process.env.OPENAI_BASE_URL, key: process.env.OPENAI_API_KEY };
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`; process.env.OPENAI_API_KEY = "sk-fake-canvas-index";
  try {
    const { handleIndex } = await import("../../src/worker/handlers/index-source");
    const { hybridSearch } = await import("../../src/lib/search/index");
    const p = await mk(ws, `${PFX} indexed`, undefined, { type: "canvas" });
    await putCanvas(ws, p.id, { ...EMPTY_CANVAS(), nodes: [{ id: "a", kind: "text", x: 0, y: 0, w: 200, h: 80, z: 0, text: "Brachiosaurus liquidity premium" }], edges: [] }, 1);
    const r = (await handleIndex({ sourceType: "page", sourceId: p.id, workspaceId: ws })) as { skipped?: boolean; chunks?: number };
    assert.equal(r.skipped, false); assert.ok((r.chunks ?? 0) >= 1);
    const chunks = await db.select({ content: schema.chunks.content }).from(schema.chunks).where(eq(schema.chunks.sourceId, p.id));
    assert.ok(chunks.some((c) => c.content.includes("Brachiosaurus liquidity premium")), "the passage holds the card's text"); assert.ok(seen.some((t) => t.includes("Brachiosaurus")), "…and it was embedded");
    const hits = await hybridSearch(ws, "brachiosaurus", { semantic: false, limit: 5 }); assert.ok(hits.some((h) => h.pageId === p.id), "search finds the canvas by a word of a card");
    await db.delete(schema.chunks).where(eq(schema.chunks.sourceId, p.id)); await db.delete(schema.indexState).where(eq(schema.indexState.sourceId, p.id));
  } finally { if (saved.url === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = saved.url; if (saved.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.key; await new Promise((r) => server.close(r)); }
});
