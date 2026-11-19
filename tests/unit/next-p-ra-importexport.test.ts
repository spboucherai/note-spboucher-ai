/**
 * file: tests/unit/next-p-ra-importexport.test.ts
 * description: Import / export defects of the Next P-RA pass (audit ids I1, I2, I5, I10, I11, I12, I13, I16, I17): each test states the
 *   defect it reproduces. Pure checks first, then imports that write to the SCRATCH database under one root page (everything created —
 *   pages, databases, rows, attachments and their files — is removed at the end).
 *   Run: node node_modules/tsx/dist/cli.mjs --test --test-force-exit --test-concurrency=1 tests/unit/next-p-ra-importexport.test.ts
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import "../helpers/testdb";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../../src/db/index";
import { workspace, mk, cleanup, made } from "../helpers/next";
import * as validate from "../../src/lib/import/validate";
import * as csvIn from "../../src/lib/import/csv";
import * as restore from "../../src/lib/import/restore";
import * as zipIn from "../../src/lib/import/zip";
import * as mdIn from "../../src/lib/import/markdown";
import * as exp from "../../src/lib/export/index";
import * as csvOut from "../../src/lib/export/csv";
import { runImport, previewImport } from "../../src/lib/import/index";
import { markdownToDoc } from "../../src/lib/editor/markdown-client";
import { toMarkdown, docText, type PMNode } from "../../src/lib/editor/text";
import { absPath } from "../../src/lib/files/storage";

const PFX = "pra-ie ·"; const ROOT = process.cwd();
const src = (rel: string) => fs.readFileSync(`${ROOT}/${rel}`, "utf8");
const V = validate as any, CI = csvIn as any, R = restore as any, Z = zipIn as any, E = exp as any, CO = csvOut as any;
const failure = async (p: Promise<unknown> | (() => unknown)) => { try { await (typeof p === "function" ? p() : p); return null; } catch (e: any) { return e; } };
const T = (text: string, ...marks: string[]): PMNode => ({ type: "text", text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const P = (...content: PMNode[]): PMNode => ({ type: "paragraph", content });
const D = (...content: PMNode[]): PMNode => ({ type: "doc", content });
const types = (nodes: PMNode[]): string[] => nodes.flatMap((n) => [n.type, ...types(n.content ?? [])]);
const find = (nodes: PMNode[], type: string): PMNode[] => nodes.flatMap((n) => [...(n.type === type ? [n] : []), ...find(n.content ?? [], type)]);
const maths = (md: string) => find(markdownToDoc(md), "inlineMath").map((n) => n.attrs?.latex);

/* ------------------------------------------------------------------ I1 / I17: route input ------------------------------------------------------------------ */
test("I1 — a malformed parentId (text, or a file sent under that name) is a 400 bad_parent, not a 500", async () => {
  assert.equal(typeof V.parentIdOf, "function", "parentIdOf is missing from src/lib/import/validate.ts");
  for (const bad of ["nope", "1234", "../../etc", { name: "x.md", size: 3 }, 42, "6f1c2a9e-0000-4000-8000-00000000000Z"]) { const e = await failure(() => V.parentIdOf(bad)); assert.ok(e instanceof validate.ImportError, `refused: ${JSON.stringify(bad)}`); assert.equal(e.status, 400); assert.equal(e.code, "bad_parent"); }
  for (const none of [null, undefined, ""]) assert.equal(V.parentIdOf(none), null);
  assert.equal(V.parentIdOf("6F1C2A9E-0000-4000-8000-000000000001"), "6f1c2a9e-0000-4000-8000-000000000001");
  const route = src("src/app/api/import/route.ts"); assert.ok(!route.includes("uuid.parse(parentId)"), "the route no longer lets a ZodError escape"); assert.ok(route.includes("parentIdOf(form.get(\"parentId\"))"));
});
test("I17 — the 400 for an unknown export format lists every accepted format, html included", () => {
  assert.equal(typeof E.badFormatMessage, "function", "badFormatMessage is missing from src/lib/export/index.ts");
  const msg: string = E.badFormatMessage(); for (const f of ["md", "zip", "json", "csv", "pdf", "html", "bib"]) { assert.ok(E.EXPORT_FORMATS.includes(f)); assert.ok(new RegExp(`\\b${f}\\b`).test(msg), `${f} in “${msg}”`); }
  const route = src("src/app/api/export/route.ts"); assert.ok(route.includes("badFormatMessage()")); assert.ok(!route.includes("format must be one of md, zip, json, csv, pdf, bib\""));
});

/* ------------------------------------------------------------------ I5: manifest vs backup ------------------------------------------------------------------ */
const now = new Date("2026-01-02T03:04:05.000Z");
const fakePage = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, workspaceId: "w", title, type: "page", section: "notes", parentId: null, databaseId: null, icon: null, properties: {}, content: D(P(T("hello"))), position: 1, createdAt: now, updatedAt: now, ...extra });
const fakeSet = (over: Record<string, unknown> = {}) => ({ workspace: { id: "w", name: "W", slug: "w" }, rootId: null, pages: [fakePage("11111111-1111-4111-8111-111111111111", "Alpha")], databases: [], properties: [], rows: [], views: [], attachments: [], references: [], experiments: [], tags: [], pageTags: [], tasks: [], ...over });
test("I5 — the workspace.json manifest of a ZIP export is refused as a backup with a clear 400 (its format string is unchanged)", async () => {
  const { manifest } = exp.buildZip(fakeSet() as any); const data = JSON.parse(JSON.stringify(manifest));
  assert.equal(data.format, exp.JSON_FORMAT, "the manifest keeps its format string (other readers rely on it)");
  const e = await failure(() => R.checkBackupFormat(data)); assert.ok(e instanceof validate.ImportError, "the manifest is refused"); assert.equal(e.status, 400); assert.equal(e.code, "zip_manifest"); assert.match(e.message, /ZIP/);
  const empty = JSON.parse(JSON.stringify(exp.buildZip(fakeSet({ pages: [] }) as any).manifest)); assert.equal((await failure(() => R.checkBackupFormat(empty)))?.code, "zip_manifest", "a manifest without pages is recognised too");
  // real backups (shape of src/lib/export/json.ts) still pass, with or without rows
  const backup = { format: exp.JSON_FORMAT, exportedAt: now.toISOString(), app: "Note SPBoucher AI", workspace: { id: "w" }, counts: { pages: 1 }, pages: [fakePage("11111111-1111-4111-8111-111111111111", "Alpha")], pageVersions: [], databases: [], databaseProperties: [], databaseRows: [], databaseViews: [], relations: [], attachments: [], tags: [], pageTags: [], tasks: [], links: [], knowledgeEdges: [], references: [], experiments: [] };
  assert.equal(await failure(() => R.checkBackupFormat(JSON.parse(JSON.stringify(backup)))), null); assert.equal(await failure(() => R.checkBackupFormat({ ...backup, pages: [] })), null);
  assert.equal(await failure(() => R.checkBackupFormat({ format: exp.JSON_FORMAT, pages: [{ id: "x", workspaceId: "w", title: "t", content: {} }] })), null, "a minimal hand-made backup passes");
  assert.equal((await failure(() => R.checkBackupFormat({ format: "other/1" })))?.code, "bad_backup");
});

/* ------------------------------------------------------------------ I10: CSV numbers, headers, parser errors ------------------------------------------------------------------ */
test("I10 — number columns: decimal comma, thousands separators, and digit strings that must stay text (rule of src/lib/import/csv.ts)", () => {
  assert.equal(typeof CI.numberStyle, "function", "numberStyle is missing from src/lib/import/csv.ts");
  const read = (col: string[]) => { const s = CI.numberStyle(col); return s ? col.map((c) => Number(CI.normaliseNumber(c, s))) : null; };
  assert.deepEqual(read(["1,5", "2,25", "10"]), [1.5, 2.25, 10], "decimal comma (was stored as 15 and 225)");
  assert.deepEqual(read(["1 234,5", "0,5", "-3,75"]), [1234.5, 0.5, -3.75], "space-grouped thousands + decimal comma");
  assert.deepEqual(read(["1.234,56", "12,5"]), [1234.56, 12.5], "dot-grouped thousands + decimal comma");
  assert.deepEqual(read(["1,234", "2,500,000", "12"]), [1234, 2500000, 12], "comma = thousands separator when every cell reads that way");
  assert.deepEqual(read(["1,234"]), [1234], "an ambiguous cell alone keeps the dot-style reading (unchanged behaviour)");
  assert.deepEqual(read(["1,234", "2,5"]), [1.234, 2.5], "…but a column with an unambiguous decimal comma is comma-style as a whole");
  assert.equal(read(["1,234.5", "12,50 $"]), null, "a column mixing both conventions is not a number column");
  assert.deepEqual(read(["1,234.5", "1 000.25", ".5", "-$12.50", "45%", "€3"]), [1234.5, 1000.25, 0.5, -12.5, 45, 3]);
  assert.deepEqual(read(["12,50 $", "3,00 $"]), [12.5, 3], "fr-CA currency");
  assert.equal(read(["1,5", "2.5"]), null, "mixed decimal signs: nothing is guessed, the column stays text");
  assert.equal(read(["12,34", "5"]) && CI.numberStyle(["12,34", "5"]), "comma", "`12,34` is never read as 1234");
  // lossy digit strings
  assert.equal(CI.numberStyle(["1234567890123456", "12"]), null, "more than 15 significant digits");
  assert.equal(CI.numberStyle(["007", "12"]), null, "leading zero"); assert.equal(CI.numberStyle(["0.5", "0.25"]), "dot", "0.5 is not a leading-zero id"); assert.equal(CI.numberStyle(["0,5"]), "comma");
  assert.equal(CI.numberStyle(["123456789012345"]), "dot", "15 digits are exact"); assert.equal(CI.numberStyle(["+15145551234"]), null, "a phone number with + is text");
  assert.equal(csvIn.inferType(["1,5", "2,25"]), "number"); assert.equal(csvIn.inferType(["4111111111111111", "5500000000000004"]), "text"); assert.equal(csvIn.inferType(["01234", "09876"]), "text");
  const plan: any = csvIn.csvPlan("Name,Prix,Id\na,\"1,5\",00123\nb,\"2,75\",00456\n"); assert.deepEqual(plan.columns, [{ name: "Prix", type: "number" }, { name: "Id", type: "text" }]); assert.deepEqual(plan.numberStyles, { Prix: "comma" });
});
test("I10 — duplicate headers are made unique, and parser problems are reported as warnings", () => {
  assert.equal(typeof CI.uniqueHeaders, "function", "uniqueHeaders is missing");
  assert.deepEqual(CI.uniqueHeaders(["Name", "Name", "name", "", "Name 2", "Column 4"]).header, ["Name", "Name 2", "name 3", "Column 4", "Name 2 2", "Column 4 2"]);
  const long = "x".repeat(250); const u = CI.uniqueHeaders([long, long]); assert.equal(u.header[0].length, 200); assert.equal(u.header[1].length, 200); assert.notEqual(u.header[0], u.header[1]);
  const p: any = csvIn.parseCsv("Name,Tag,Tag\na,1,2\n"); assert.deepEqual(p.header, ["Name", "Tag", "Tag 2"]); assert.deepEqual(p.rows, [["a", "1", "2"]]); assert.equal(p.warnings.length, 1); assert.match(p.warnings[0], /renamed/);
  const bad: any = csvIn.parseCsv("Name,Note\na,\"unterminated\nb,2\n"); assert.ok(bad.warnings.some((w: string) => /could not be read cleanly/.test(w)), `papaparse errors surface: ${JSON.stringify(bad.warnings)}`);
  assert.deepEqual((csvIn.parseCsv("Name\na\nb\n") as any).warnings, [], "a one-column file raises no delimiter warning");
});

/* ------------------------------------------------------------------ I11: inline math ------------------------------------------------------------------ */
test("I11 — dollars in prose are not inline math; real formulas still are (pandoc rule)", () => {
  for (const prose of ["costs $5 and $10", "it costs $5, or $6.", "between $ 5 and $ 10", "price: $5 and$10", "escaped \\$x\\$ stays", "US$ and CA$ differ", "a $ alone"]) assert.deepEqual(maths(prose), [], `no math in “${prose}”`);
  assert.equal(docText(D(...markdownToDoc("costs $5 and $10"))), "costs $5 and $10"); assert.equal(docText(D(...markdownToDoc("escaped \\$x\\$ stays"))), "escaped $x$ stays");
  assert.deepEqual(maths("$x^2$"), ["x^2"]); assert.deepEqual(maths("so $\\alpha + \\beta$ holds"), ["\\alpha + \\beta"]);
  assert.deepEqual(maths("with $a_1 + b_2$ and $c_1 * d_1 * e$"), ["a_1 + b_2", "c_1 * d_1 * e"], "LaTeX with _ and * is not eaten by emphasis");
  assert.deepEqual(maths("set $\\{x \\mid x > 0\\}$ and cost \\$5"), ["\\{x \\mid x > 0\\}"]); assert.deepEqual(maths("- item $E = mc^2$\n- **bold $k$**"), ["E = mc^2", "k"]);
  assert.deepEqual(maths("`$x$` in code style"), ["x"], "the `$…$` code-span form keeps working");
  assert.deepEqual(markdownToDoc("$$\na^2 + b^2 = c^2\n$$").map((n) => [n.type, n.attrs?.latex]), [["blockMath", "a^2 + b^2 = c^2"]]);
  const md = toMarkdown(D(P(T("Euler: "), { type: "inlineMath", attrs: { latex: "e^{i\\pi}_n + 1 = 0" } }, T(" costs $5")), { type: "blockMath", attrs: { latex: "\\sum_{i=1}^n x_i\n\n= S" } }));
  const back = markdownToDoc(md); assert.deepEqual(find(back, "inlineMath").map((n) => n.attrs?.latex), ["e^{i\\pi}_n + 1 = 0"]); assert.deepEqual(find(back, "blockMath").map((n) => n.attrs?.latex), ["\\sum_{i=1}^n x_i\n\n= S"]); assert.equal(toMarkdown(D(...back)), md, "math round-trips byte for byte");
});

/* ------------------------------------------------------------------ I12: Markdown round-trip ------------------------------------------------------------------ */
test("I12 — what toMarkdown writes is parsed back: highlight, underline / sub / sup, callout, AI block, details, footnotes", () => {
  const doc = D(
    P(T("plain "), T("lit", "highlight"), T(" "), T("under", "underline"), T(" H"), T("2", "subscript"), T("O x"), T("2", "superscript"), T(" note"), { type: "footnoteRef", attrs: { id: "1" } }),
    { type: "callout", attrs: { kind: "decision", icon: "⚖️" }, content: [P(T("We ship on "), T("Friday", "bold"))] },
    { type: "callout", attrs: { kind: "ai", icon: "✨" }, content: [P(T("callout of kind ai"))] },
    { type: "aiBlock", attrs: { model: "claude-fable-5" }, content: [P(T("generated text")), { type: "bulletList", content: [{ type: "listItem", content: [P(T("point"))] }] }] },
    { type: "details", content: [{ type: "detailsSummary", content: [T("More "), T("info", "italic")] }, { type: "detailsContent", content: [P(T("hidden one")), P(T("hidden two"))] }] },
    { type: "footnote", attrs: { id: "1" }, content: [T("the source")] }, // one text run: toMarkdown joins the runs of a footnote with a space (existing bytes, not changed here)
  );
  const md = toMarkdown(doc); const back = markdownToDoc(md); const ts = types(back);
  assert.deepEqual(back.map((n) => n.type), ["paragraph", "callout", "callout", "aiBlock", "details", "footnote"], md);
  const marksOf = (text: string) => (find(back, "text").find((n) => n.text === text)?.marks ?? []).map((m) => m.type).sort();
  assert.deepEqual(marksOf("lit"), ["highlight"]); assert.deepEqual(marksOf("under"), ["underline"]);
  assert.deepEqual(find(back, "text").filter((n) => n.text === "2").map((n) => n.marks?.[0]?.type), ["subscript", "superscript"]);
  assert.deepEqual(back[1].attrs, { kind: "decision", icon: "⚖️" }); assert.deepEqual(back[2].attrs, { kind: "ai", icon: "✨" }); assert.equal(back[3].attrs?.model, "claude-fable-5"); assert.ok(types(back[3].content ?? []).includes("bulletList"));
  assert.deepEqual(back[4].content?.map((c) => c.type), ["detailsSummary", "detailsContent"]); assert.equal(docText(D(back[4].content![0])), "More info"); assert.equal(back[4].content![1].content?.length, 2);
  assert.deepEqual(find(back, "footnoteRef").map((n) => n.attrs?.id), ["1"]); assert.equal(back[5].attrs?.id, "1"); assert.equal(docText(D(back[5])), "the source");
  assert.ok(!ts.includes("blockquote"), "no callout is left as a quote"); assert.ok(!docText(D(...back)).includes("[!"), "no literal [!KIND] line"); assert.ok(!/<\/?(u|sub|sup|details|summary)>/.test(docText(D(...back))), "no literal HTML tag");
  assert.equal(toMarkdown(D(...back)), md, "export → import → export is stable, byte for byte");
});
test("I12 — exported bytes of the three marks that used to be dropped (the only change of toMarkdown), and what is unchanged", () => {
  assert.equal(toMarkdown(D(P(T("a"), T("u", "underline"), T("b", "subscript"), T("c", "superscript")))), "a<u>u</u><sub>b</sub><sup>c</sup>\n");
  assert.equal(toMarkdown(D(P(T("x", "bold"), T("y", "italic"), T("z", "highlight"), T("w", "strike"), T("c", "code")))), "**x***y*==z==~~w~~`c`\n", "the other marks are written exactly as before");
  const both = find(markdownToDoc(toMarkdown(D(P(T("both", "bold", "underline"), T(" and "), T("m", "highlight", "italic"))))), "text"); assert.deepEqual(both.map((n) => [n.text, (n.marks ?? []).map((m) => m.type).sort()]), [["both", ["bold", "underline"]], [" and ", []], ["m", ["highlight", "italic"]]], "combined marks survive");
  assert.equal(toMarkdown(D(P(T("2 * 3 _ [x] <b> # not escaped")))), "2 * 3 _ [x] <b> # not escaped\n", "no Markdown escaping was added on export");
});
test("I12 — import details: other tools' callouts, text that is not a highlight, heading levels, unpaired tags, front-matter keys", () => {
  const obs = markdownToDoc("> [!warning] Careful here\n> body line\n\n> [!TIP]\n> short\n\n> [!AI]\n> answer\n\n> plain quote");
  assert.deepEqual(obs.map((n) => [n.type, n.attrs?.kind ?? null]), [["callout", "warning"], ["callout", "info"], ["aiBlock", null], ["blockquote", null]]);
  assert.equal(obs[0].attrs?.icon, "⚠️"); assert.equal(docText(D(obs[0])), "Careful here\nbody line", "an Obsidian title is kept as the first paragraph");
  for (const prose of ["if a==b and c==d then", "x == y == z", "== spaced ==", "a ===b=== c"]) assert.ok(!find(markdownToDoc(prose), "text").some((n) => n.marks?.some((m) => m.type === "highlight")), `no highlight in “${prose}”`);
  assert.deepEqual(markdownToDoc("#### four\n\n###### six\n\n## two").map((n) => n.attrs?.level), [3, 3, 2], "the editor schema has levels 1–3 only: deeper headings are clamped to 3");
  assert.equal(docText(D(...markdownToDoc("a <u>open only and 2 < 3"))), "a <u>open only and 2 < 3", "an unpaired tag stays literal");
  assert.equal(docText(D(...markdownToDoc("see <details> in prose"))), "see <details> in prose");
  assert.deepEqual(markdownToDoc("<details><summary>S</summary>\ninline body\n</details>").map((n) => n.type), ["details"], "the compact form of other tools");
  const fm = mdIn.parseFrontMatter("---\ntitle: T\nCoût: 12\nPrix (CAD): 3.5\nproperties:\n  Année: 2026\n  N° client: \"A-1\"\n---\nbody");
  assert.deepEqual(fm.data, { title: "T", "Coût": 12, "Prix (CAD)": 3.5, properties: { "Année": 2026, "N° client": "A-1" } }); assert.equal(fm.body, "body");
});

/* ------------------------------------------------------------------ I16: CSV export ------------------------------------------------------------------ */
test("I16 — CSV export neutralises formula cells and leaves numbers alone", () => {
  assert.equal(typeof CO.csvSafe, "function", "csvSafe is missing from src/lib/export/csv.ts");
  for (const [cell, out] of [["=SUM(A1:A2)", "'=SUM(A1:A2)"], ["+1+1", "'+1+1"], ["-1+cmd|' /C calc'!A0", "'-1+cmd|' /C calc'!A0"], ["@SUM(1)", "'@SUM(1)"], ["\tx", "'\tx"], ["\rx", "'\rx"], ["-", "'-"], ["- not a number", "'- not a number"], ["+A1", "'+A1"]]) assert.equal(CO.csvSafe(cell), out);
  for (const same of ["-5", "+3.2", "-1,234.5", "-$5.00", "-12 %", "-.5", "-1e-7", "plain", "a=b", "", "2026-01-02", "x@y.z"]) assert.equal(CO.csvSafe(same), same, `unchanged: ${same}`);
  const dbId = "d"; const prop = (id: string, name: string, type: string, position: number) => ({ id, databaseId: dbId, name, type, config: {}, position, width: 100 });
  const set = fakeSet({ databases: [{ id: dbId, pageId: "dbp", name: "DB" }], properties: [prop("t", "Name", "title", 0), prop("n", "Amount", "number", 1), prop("x", "Note", "text", 2), prop("f", "=Evil", "text", 3)],
    pages: [fakePage("r1", "=HYPERLINK(\"http://x\")"), fakePage("r2", "Plain")], rows: [{ databaseId: dbId, pageId: "r1", values: { n: -5, x: "+1+1", f: "@a" }, position: 1, createdAt: now, updatedAt: now }, { databaseId: dbId, pageId: "r2", values: { n: -2.5, x: "-5", f: "ok" }, position: 2, createdAt: now, updatedAt: now }] });
  const { csv } = csvOut.databaseCsv(set as any, dbId); const p = csvIn.parseCsv(csv);
  assert.deepEqual(p.header, ["Title", "Amount", "Note", "'=Evil", "Created", "Updated"]);
  assert.deepEqual(p.rows.map((r) => r.slice(0, 4)), [["'=HYPERLINK(\"http://x\")", "-5", "'+1+1", "'@a"], ["Plain", "-2.5", "-5", "ok"]], "negative numbers are intact; the apostrophe stays on re-import (documented)");
  assert.equal(csvIn.inferType(p.rows.map((r) => r[1])), "number", "the number column still imports as numbers");
});

/* ------------------------------------------------------------------ I13: pure parts ------------------------------------------------------------------ */
test("I13 — destinations with spaces / parentheses / <…> are read as archive files; the export bytes are unchanged", () => {
  const att = exp.attachmentFile({ id: "1a2b3c4d-0000-4000-8000-000000000000", filename: "my file (1).png" }); assert.equal(att, "attachments/1a2b3c4d-my file (1).png", "the export keeps the name as it is");
  const md = toMarkdown(exp.rewriteDoc(D({ type: "image", attrs: { src: "/api/files/1a2b3c4d-0000-4000-8000-000000000000", alt: "fig" } }, { type: "fileBlock", attrs: { src: "/api/files/1a2b3c4d-0000-4000-8000-000000000000", name: "my notes.txt" } }), { file: () => `./${att}` }));
  assert.equal(md, "![fig](./attachments/1a2b3c4d-my file (1).png)\n\n[📎 my notes.txt](./attachments/1a2b3c4d-my file (1).png)\n");
  const rel = mdIn.relativeRefs(md + "\n![enc](a%20b.png) ![w](<c d.png>) ![t](e.png \"title\") [doc](<f g.pdf>) [see](the docs) [web](https://x.y/a b) [page](Other%20Page.md)");
  assert.deepEqual(rel.images, ["./attachments/1a2b3c4d-my file (1).png", "a b.png", "c d.png", "e.png"]); assert.deepEqual(rel.links, ["./attachments/1a2b3c4d-my file (1).png", "f g.pdf", "Other Page.md"]);
  assert.equal(typeof Z.rowFileOrder, "function", "rowFileOrder is missing from src/lib/import/zip.ts");
  const e = (norm: string) => ({ norm }); assert.deepEqual(["db/row-10.md", "db/row-2.md", "db/row.md", "db/row-3.md"].map(e).sort(Z.rowFileOrder).map((x: any) => x.norm), ["db/row.md", "db/row-2.md", "db/row-3.md", "db/row-10.md"]);
});

/* ------------------------------------------------------------------ database-backed imports ------------------------------------------------------------------ */
let ws = ""; let rootId = "";
const root = async () => { if (!rootId) { ws = await workspace(); rootId = (await mk(ws, `${PFX} root`)).id; } return rootId; };
const descendants = async (id: string): Promise<string[]> => { const out: string[] = []; let level = [id]; while (level.length) { const kids = await db.select({ id: schema.pages.id }).from(schema.pages).where(inArray(schema.pages.parentId, level)); level = kids.map((k) => k.id); out.push(...level); } return out; };
after(async () => {
  if (!rootId) return;
  const ids = await descendants(rootId); made.pages.push(...ids);
  const atts = await db.select().from(schema.attachments).where(inArray(schema.attachments.pageId, [rootId, ...ids]));
  for (const a of atts) { try { fs.rmSync(absPath(a.storagePath), { force: true }); } catch { /* already gone */ } }
  await cleanup(ws, PFX);
});
const fm = (title: string, extra = "") => `---\ntitle: ${JSON.stringify(title)}\n${extra}---\n\n# ${title}\n\n`;

test("I2 — an empty CSV is a 400 empty_csv (not a retryable 500)", async () => {
  const parentId = await root();
  for (const text of ["\n\n", ",,,\n , \n"]) {
    const e = await failure(runImport({ workspaceId: ws, kind: "csv", buffer: Buffer.from(text), filename: `${PFX} empty.csv`, parentId, duplicates: "import" }));
    assert.ok(e instanceof validate.ImportError, `an ImportError, got ${e?.constructor?.name}: ${e?.message}`); assert.equal(e.status, 400); assert.equal(e.code, "empty_csv");
  }
  assert.equal((await descendants(parentId)).length, 0, "nothing was created");
});
test("I10 — a CSV import stores 1,5 as 1.5, keeps both columns of a repeated header and keeps long digit strings as text", async () => {
  const parentId = await root();
  const text = `Name,Prix,Prix,Total,Carte,Code\n${PFX} r1,"1,5","2,25","1 234,5",4111111111111111,007\n${PFX} r2,"10","0,5","12,25",5500000000000004,042\n`;
  const r = await runImport({ workspaceId: ws, kind: "csv", buffer: Buffer.from(text), filename: `${PFX} prices.csv`, parentId, duplicates: "import" });
  const [d] = await db.select().from(schema.databases).where(eq(schema.databases.pageId, r.pageId!)); assert.ok(d);
  const props = (await db.select().from(schema.databaseProperties).where(eq(schema.databaseProperties.databaseId, d.id))).sort((a, b) => a.position - b.position);
  assert.deepEqual(props.map((p) => [p.name, p.type]), [["Name", "title"], ["Prix", "number"], ["Prix 2", "number"], ["Total", "number"], ["Carte", "text"], ["Code", "text"]]);
  const rows = (await db.select().from(schema.databaseRows).where(eq(schema.databaseRows.databaseId, d.id))).sort((a, b) => a.position - b.position);
  const cell = (i: number, name: string) => (rows[i].values as Record<string, unknown>)[props.find((p) => p.name === name)!.id];
  assert.deepEqual([cell(0, "Prix"), cell(0, "Prix 2"), cell(0, "Total"), cell(0, "Carte"), cell(0, "Code")], [1.5, 2.25, 1234.5, "4111111111111111", "007"]);
  assert.deepEqual([cell(1, "Prix"), cell(1, "Prix 2"), cell(1, "Total"), cell(1, "Carte"), cell(1, "Code")], [10, 0.5, 12.25, "5500000000000004", "042"]);
  assert.ok(r.stats.skipped.some((s) => /renamed/.test(s)), "the renamed header is reported in the import report");
});
test("I2 + I13 — ZIP in the layout of our export: empty CSV skipped, created dates kept, same-title rows keep their own body, spaced file names matched", async () => {
  const parentId = await root(); const z = new JSZip(); const png = randomBytes(64); const txt = Buffer.from(`notes ${randomBytes(8).toString("hex")}`);
  z.file(`${PFX} page.md`, fm(`${PFX} page`, "created: 2019-05-06T07:08:09.000Z\nupdated: 2021-02-03T04:05:06.000Z\n") + "Intro\n\n![fig](./attachments/1a2b3c4d-my file (1).png)\n\n[📎 my notes.txt](./attachments/9f8e7d6c-my notes.txt)\n");
  z.file("attachments/1a2b3c4d-my file (1).png", png); z.file("attachments/9f8e7d6c-my notes.txt", txt);
  z.file(`${PFX} db.md`, fm(`${PFX} db`)); z.file(`${PFX} db.csv`, `Title,Val\n${PFX} same,1\n${PFX} same,2\n${PFX} same,3\n${PFX} other,4\n`);
  const row = (n: string, body: string, created: string) => z.file(`${PFX} db/${n}.md`, fm(n.startsWith("other") ? `${PFX} other` : `${PFX} same`, `created: ${created}\n`) + `${body}\n`);
  row("same", "body one", "2018-01-01T00:00:00.000Z"); row("same-2", "body two", "2018-01-02T00:00:00.000Z"); row("same-3", "body three", "2018-01-03T00:00:00.000Z"); row("other", "body other", "2018-01-04T00:00:00.000Z");
  z.file(`${PFX} blank.csv`, "\n,,\n"); z.file(`${PFX} blank/${PFX} orphan.md`, fm(`${PFX} orphan`, "created: 2017-07-07T07:07:07.000Z\n") + "orphan body\n");
  z.file("workspace.json", JSON.stringify({ format: exp.JSON_FORMAT, kind: "workspace" }));
  const buffer = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const pre = await previewImport({ workspaceId: ws, kind: "zip", buffer, filename: "export.zip" });
  assert.ok(pre.warnings.some((w) => /blank\.csv” is empty and will be skipped/.test(w)), JSON.stringify(pre.warnings)); assert.equal(pre.countsAll.databases, 1); assert.ok(pre.tree.some((n) => n.title === `${PFX} orphan`), "the preview lists the page of the empty CSV's folder");
  assert.equal(pre.countsAll.attachments, 2, "the preview finds both spaced file names");
  const r = await runImport({ workspaceId: ws, kind: "zip", buffer, filename: "export.zip", parentId, duplicates: "import" });
  assert.ok(r.stats.skipped.some((s) => /blank\.csv” is empty — skipped/.test(s)), `the empty CSV is skipped, the archive is imported: ${JSON.stringify(r.stats.skipped)}`);
  const all = await db.select().from(schema.pages).where(inArray(schema.pages.id, await descendants(parentId))); const byTitle = (t: string) => all.filter((p) => p.title === t);
  const page = byTitle(`${PFX} page`)[0]; assert.ok(page); assert.equal(page.createdAt.toISOString(), "2019-05-06T07:08:09.000Z", "created date of a page inside a ZIP"); assert.equal(page.updatedAt.toISOString(), "2021-02-03T04:05:06.000Z");
  const orphan = byTitle(`${PFX} orphan`)[0]; assert.ok(orphan, "the Markdown file next to the empty CSV is an ordinary page"); assert.equal(orphan.createdAt.toISOString(), "2017-07-07T07:07:07.000Z"); assert.match(orphan.plainText, /orphan body/);
  // attachments with a space / parentheses in their name
  const atts = await db.select().from(schema.attachments).where(eq(schema.attachments.pageId, page.id)); assert.deepEqual(atts.map((a) => a.filename).sort(), ["1a2b3c4d-my file (1).png", "9f8e7d6c-my notes.txt"]);
  const content = page.content as PMNode; const img = find([content], "image")[0]; assert.equal(img?.attrs?.src, `/api/files/${atts.find((a) => a.filename.endsWith(".png"))!.id}`);
  const link = find([content], "text").find((n) => n.marks?.some((m) => m.type === "link")); assert.equal(link?.marks?.find((m) => m.type === "link")?.attrs?.href, `/api/files/${atts.find((a) => a.filename.endsWith(".txt"))!.id}`);
  assert.ok(!r.stats.skipped.some((s) => /not referenced by any page/.test(s)), "no attachment was left out");
  // rows with the same title
  const dbPage = byTitle(`${PFX} db`).find((p) => p.type === "database")!; assert.ok(dbPage); const [d] = await db.select().from(schema.databases).where(eq(schema.databases.pageId, dbPage.id));
  const rows = (await db.select().from(schema.databaseRows).where(eq(schema.databaseRows.databaseId, d.id))).sort((a, b) => a.position - b.position); const rowPage = (i: number) => all.find((p) => p.id === rows[i].pageId)!;
  assert.deepEqual(rows.map((_r, i) => [rowPage(i).title, rowPage(i).plainText.trim()]), [[`${PFX} same`, "body one"], [`${PFX} same`, "body two"], [`${PFX} same`, "body three"], [`${PFX} other`, "body other"]], "each row keeps its own body, in order");
  assert.deepEqual(rows.map((_r, i) => rowPage(i).createdAt.toISOString().slice(0, 10)), ["2018-01-01", "2018-01-02", "2018-01-03", "2018-01-04"], "row pages keep their created date");
  assert.equal(all.filter((p) => p.parentId === dbPage.id && !rows.some((x) => x.pageId === p.id)).length, 0, "no row file was left over as a stray page");
});
