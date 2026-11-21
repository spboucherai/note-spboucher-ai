/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/import-zip-plan.test.ts
 * Module           : tests
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-17
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

/**
 * Pure-logic tests of the ZIP planner, the preview helpers and the job state helpers. No database is opened: the modules under test are
 * imported, but nothing here runs a query (the pg client connects lazily). Run: npx tsx --test tests/unit/import-zip-plan.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { openZip, pageEntries, findOther, readText, readEntry, noExt } from "../../src/lib/import/zip";
import { previewText, relativeRefs, readMarkdown } from "../../src/lib/import/markdown";
import { csvPlan } from "../../src/lib/import/csv";
import { bibDuplicates, parseBibtexSafe } from "../../src/lib/import/bibtex";
import { contentKey, ImportError } from "../../src/lib/import/validate";
import { isStalled, publicJob } from "../../src/lib/import/job";

const ID = (n: number) => String(n).repeat(32).slice(0, 32);
async function notionZip() {
  const z = new JSZip(); const root = `Export/Projects ${ID(1)}`;
  z.file(`${root}.md`, `# Projects\n\nSee [[Alpha]] and ![fig](Projects%20${ID(1)}/fig.png) ![gone](missing.png)`);
  z.file(`${root}/Alpha ${ID(2)}.md`, "# Alpha\n\nStatus: open\n\nBody *text*.");
  z.file(`${root}/fig.png`, Buffer.from([1, 2, 3]));
  z.file(`${root}/unused.pdf`, Buffer.from("%PDF-1.4"));
  z.file(`${root}/Tasks ${ID(3)}.csv`, "Name,Done\nA,Yes\nB,No\n");
  z.file(`${root}/Tasks ${ID(3)}/A ${ID(4)}.md`, "# A\n\nrow body");
  z.file("Export/.obsidian/app.json", "{}");
  z.file("Export/workspace.json", "{}");
  z.file("Export/refs.bib", "@article{a, title={T}, year={2020}, doi={10.1000/x}}\n@article{b, title={U}}\n@article{a, title={again}}");
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

test("a Notion-style archive is classified: ids stripped, top folder removed, CSV → database, row files apart, settings ignored", async () => {
  const plan = await openZip(await notionZip());
  assert.equal(plan.notion, true); assert.equal(plan.obsidian, true); assert.equal(plan.ownExport, true); assert.equal(plan.strip, "Export/");
  assert.deepEqual(pageEntries(plan).map((e) => noExt(e.norm)), ["Projects", "Projects/Alpha"]);
  assert.deepEqual([...plan.csvKeys.keys()], ["Projects/Tasks"]);
  assert.deepEqual(plan.md.map((e) => e.norm).filter((n) => n.startsWith("Projects/Tasks/")), ["Projects/Tasks/A.md"]);
  assert.deepEqual(plan.bibs.map((b) => b.norm), ["refs.bib"]);
  assert.deepEqual(plan.others.map((o) => o.norm).sort(), ["Projects/fig.png", "Projects/unused.pdf"]);
  assert.ok(plan.ignored.some((i) => i.includes(".obsidian")) && plan.ignored.includes("workspace.json"));
});

test("relative images are resolved inside the archive only; text for duplicate detection ignores images and link syntax", async () => {
  const plan = await openZip(await notionZip()); const first = pageEntries(plan)[0];
  const r = readMarkdown(await readText(first), "Projects.md"); const rel = relativeRefs(r.body);
  assert.equal(r.title, "Projects"); assert.equal(rel.images.length, 2);
  assert.deepEqual(rel.images.map((i) => findOther(plan, noExt(first.norm), i)?.norm ?? null), ["Projects/fig.png", null]);
  assert.equal(findOther(plan, "Projects/Alpha", "../../../etc/passwd"), null);
  assert.equal(contentKey("Projects", previewText(r.body)), contentKey(" projects ", "See Alpha and"));
  assert.notEqual(contentKey("Projects", previewText(r.body)), contentKey("Projects", "See Beta and"));
});

test("a member that inflates beyond its declared size is refused while reading", async () => {
  const plan = await openZip(await notionZip()); const e = plan.others.find((o) => o.norm === "Projects/unused.pdf")!;
  assert.equal((await readEntry(e)).toString(), "%PDF-1.4");
  await assert.rejects(() => readEntry({ ...e, size: -2000 }), (err) => err instanceof ImportError && err.code === "zip_bomb");
});

test("CSV plan and BibTeX duplicates (DOI first, then cite key, then repeats inside the file)", async () => {
  assert.deepEqual(csvPlan("Name,Done,N\nA,Yes,1\nB,No,2\n").columns, [{ name: "Done", type: "checkbox" }, { name: "N", type: "number" }]);
  const plan = await openZip(await notionZip());
  const d = bibDuplicates(parseBibtexSafe(await readText(plan.bibs[0])), [{ citeKey: "stored2020", doi: "10.1000/x" }, { citeKey: "B", doi: null }]);
  assert.deepEqual(d.fresh.map((f) => f.citeKey), []);
  assert.deepEqual(d.duplicates.map((x) => [x.citeKey, x.inFile, x.existingKey ?? null]), [["a", false, "stored2020"], ["b", false, "B"], ["a", true, null]]);
  assert.throws(() => parseBibtexSafe("@article{x, title = {unterminated"), (e) => e instanceof ImportError && e.code === "bibtex_parse");
});

test("job state: stalled after 10 minutes without progress; internal fields never reach the browser", () => {
  const now = new Date().toISOString(); const old = new Date(Date.now() - 11 * 60_000).toISOString();
  assert.equal(isStalled({ status: "running", progress: 0.2, createdAt: old, updatedAt: now, progressAt: old }), true);
  assert.equal(isStalled({ status: "running", progress: 0.2, createdAt: old, updatedAt: now, progressAt: now }), false);
  assert.equal(isStalled({ status: "queued", progress: 0, createdAt: old, updatedAt: old }), true);
  assert.equal(isStalled({ status: "done", progress: 1, createdAt: old, updatedAt: old }), false);
  const pub = publicJob("j", { status: "error", progress: 0, createdAt: now, updatedAt: now, staged: "j-file.zip", workspaceId: "w", userId: "u", runId: "r" }) as Record<string, unknown>;
  assert.equal(pub.canRetry, true); assert.equal(pub.stalled, false);
  for (const k of ["staged", "workspaceId", "userId", "runId"]) assert.ok(!(k in pub), k);
  assert.equal(publicJob("j", { status: "error", progress: 0, createdAt: now, updatedAt: now, staged: null }).canRetry, false);
});
