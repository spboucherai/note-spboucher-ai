/**
 * Research workspace + contextual AI, pure and service level (slice next-p-ra): the batching citation resolver, the link between PDF
 * annotations and a reference's extracts (derived ids — nothing duplicated on re-save, checked against the real extracts service), the
 * `attachmentId` reference lookup, the project scaffold read by the real LaTeX export, the section templates, and the pure side of the
 * contextual AI menu (aiBlock attrs, `links` result reader, anchor search on a real ProseMirror document). Runs against a *_dev database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Schema } from "@tiptap/pm/model";
import { db, schema } from "../../src/db/index";
import { workspace, mk, made, cleanup } from "../helpers/next";
import { createReferenceResolver, referencesUrl, isRefId, labelFromServer, MAX_IDS_PER_REQUEST, type ResolvedRef } from "../../src/lib/editor/citations";
import { extractIdFor, extractOfAnnotation, planExtractSync, removedExtractIds, linkedAnnotationIds } from "../../src/lib/research/pdf-extracts";
import { extractsOf } from "../../src/lib/research/cite";
import { createReference, listReferences, addExtract, updateExtract, getReference, attachPdf } from "../../src/lib/research/references";
import { SECTION_TEMPLATES, researchProjectTemplate, workingPaperTemplate } from "../../src/lib/research/template";
import { exportProjectLatex } from "../../src/lib/research/latex";
import { assertDoc } from "../../src/lib/editor/validate";
import { createPage } from "../../src/lib/pages/service";
import { ANALYSIS_ACTIONS, isAnalysisAction, aiBlockAttrs, parseLinksResult, linkHref, findAnchor, sourcesOfRange, type DocLike } from "../../src/lib/editor/ai-context";
import { ACTION_IDS } from "../../src/lib/ai/chat";
import type { PMNode } from "../../src/lib/editor/text";

let ws: string; const PFX = "nx-pra-res ·";
before(async () => { ws = await workspace(); }); after(async () => { await cleanup(ws, PFX); });
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ref = (id: string, extra: Partial<ResolvedRef> = {}): ResolvedRef => ({ id, citeKey: `k${id.slice(-4)}`, title: `T ${id.slice(-4)}`, authors: ["Jane Doe"], year: 2021, label: "Doe (2021)", citation: "Doe, J. (2021). T.", ...extra });

/* ---------------------------------------------------------------- citations ---------------------------------------------------------------- */
test("citation resolver: the ids of a page go out as one request, are cached per id, and missing ids are remembered", async () => {
  const calls: string[][] = []; let fire: (() => void) | null = null;
  const r = createReferenceResolver(async (ids) => { calls.push(ids); return ids.filter((i) => i !== uid(3)).map((i) => ref(i)); }, { schedule: (fn) => { fire = fn; } });
  let told = 0; const off = r.subscribe(() => { told++; });
  assert.equal(r.peek(uid(1)), undefined);
  const p = [r.load(uid(1)), r.load(uid(2)), r.load(uid(3)), r.load(uid(1))]; assert.equal(calls.length, 0, "nothing is sent before the window closes");
  fire!(); const got = await Promise.all(p);
  assert.deepEqual(calls, [[uid(1), uid(2), uid(3)]], "one request, each id once"); assert.equal(got[0]?.id, uid(1)); assert.equal(got[3], got[0]); assert.equal(got[2], null, "an id the server does not return is missing");
  assert.equal(r.peek(uid(2))?.label, "Doe (2021)"); assert.equal(r.peek(uid(3)), null); assert.equal(told, 1, "subscribers are told once per batch");
  fire = null; assert.equal((await r.load(uid(1)))?.id, uid(1)); assert.equal(fire, null, "a cached id costs no request");
  const many = r.loadMany([uid(1), uid(4), uid(4)]); fire!(); const m = await many; assert.deepEqual(calls[1], [uid(4)], "only the unknown id is asked"); assert.equal(m.get(uid(4))?.id, uid(4)); assert.equal(m.size, 2);
  r.invalidate(uid(1)); assert.equal(r.peek(uid(1)), undefined); r.invalidate(); assert.equal(r.peek(uid(2)), undefined); off();
  assert.equal(await r.load("not-an-id"), null); assert.equal(r.peek("not-an-id"), null); assert.equal(calls.length, 2, "a malformed id never reaches the server");
});
test("citation resolver: chunks of 200, rows that were not asked are ignored, a failed request is retried on the next ask, entries expire", async () => {
  const calls: string[][] = []; let fail = false; let clock = 0; const fires: (() => void)[] = [];
  const r = createReferenceResolver(async (ids) => { calls.push(ids); if (fail) throw new Error("Network unreachable"); return [...ids.map((i) => ref(i)), ref(uid(9999))]; }, { schedule: (fn) => { fires.push(fn); }, now: () => clock, ttlMs: 1000 });
  const ids = Array.from({ length: 450 }, (_, i) => uid(i + 1)); const all = r.loadMany(ids); fires.shift()!(); const m = await all;
  assert.deepEqual(calls.map((c) => c.length), [200, 200, 50]); assert.equal(MAX_IDS_PER_REQUEST, 200); assert.equal(m.size, 450); assert.equal(r.peek(uid(9999)), undefined, "the library is never cached from an answer that ignored `ids`");
  fail = true; const lost = r.load(uid(5000)); fires.shift()!(); assert.equal(await lost, undefined); assert.match(r.error()?.message ?? "", /unreachable/); assert.equal(r.peek(uid(5000)), undefined);
  fail = false; const again = r.load(uid(5000)); fires.shift()!(); assert.equal((await again)?.id, uid(5000)); assert.equal(r.error(), null);
  clock = 2000; assert.equal(r.peek(uid(1)), undefined, "expired"); const re = r.load(uid(1)); fires.shift()!(); assert.equal((await re)?.id, uid(1));
  assert.equal(referencesUrl([uid(2), uid(1), uid(2)]), `/api/research/references?ids=${uid(1)},${uid(2)}`); assert.equal(isRefId(uid(1)), true); assert.equal(isRefId(null), false); assert.equal(labelFromServer("Gorton & Metrick (2019)"), "Gorton & Metrick 2019");
});

/* ---------------------------------------------------------------- PDF annotations ↔ extracts ---------------------------------------------------------------- */
test("pdf annotations ↔ extracts: derived ids, plan (create / update / linked), removals — and no duplicate in the real extracts service", async () => {
  const att = randomUUID(); const a1 = { id: "aB3xK9pQ2z", page: 3, kind: "highlight", text: "  The term premium is counter-cyclical. ", note: "" }, a2 = { id: "note000002", page: 7, kind: "note", text: "", note: "Check the sample period" }, ink = { id: "ink0000003", page: 1, kind: "ink", text: "", note: "" }, empty = { id: "empty00004", page: 1, kind: "highlight", text: " ", note: "" };
  const id1 = extractIdFor(att, a1.id); assert.equal(id1, extractIdFor(att.toUpperCase(), a1.id), "stable"); assert.notEqual(id1, extractIdFor(att, a2.id)); assert.notEqual(id1, extractIdFor(randomUUID(), a1.id), "the same annotation id in another file is another extract");
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); assert.equal(z.string().uuid().safeParse(id1).success, true, "accepted by the API's uuid validator");
  assert.deepEqual(extractOfAnnotation(a1), { quote: "The term premium is counter-cyclical.", page: "3", note: null }); assert.deepEqual(extractOfAnnotation(a2), { quote: "Check the sample period", page: "7", note: null }); assert.equal(extractOfAnnotation(ink), null); assert.equal(extractOfAnnotation(empty), null);
  let plan = planExtractSync(att, [a1, a2, ink, empty, a1], []); assert.deepEqual(plan.create.map((c) => c.annotationId), [a1.id, a2.id]); assert.deepEqual([plan.update.length, plan.linked.length], [0, 0]);

  // against the real service: the PDF is attached to a reference, the annotation is saved, saved again, edited, saved again
  const page = await mk(ws, `${PFX} paper`); const [file] = await db.insert(schema.attachments).values({ id: att, workspaceId: ws, pageId: page.id, filename: "paper.pdf", mime: "application/pdf", size: 10, sha256: "0".repeat(64), storagePath: "nx-pra/none.pdf" }).returning(); made.attachments.push(file.id);
  const r = await createReference(ws, { title: `${PFX} Term premia`, authors: ["Jane Doe"], year: 2021, pageId: page.id }); made.references.push(r.id); await attachPdf(ws, r.id, att);
  assert.deepEqual((await listReferences(ws, { attachmentId: att })).map((x) => x.id), [r.id], "the block finds its reference by attachment"); assert.deepEqual(await listReferences(ws, { attachmentId: randomUUID() }), []);
  for (let i = 0; i < 2; i++) for (const c of planExtractSync(att, [a1, a2], extractsOf((await getReference(ws, r.id)).fields)).create) await addExtract(ws, r.id, { id: c.id, ...c.body });
  for (const c of plan.create) await addExtract(ws, r.id, { id: c.id, ...c.body }); // a blind retry of the first plan
  let stored = extractsOf((await getReference(ws, r.id)).fields); assert.equal(stored.length, 2, "saving again never adds a second extract"); assert.deepEqual(stored.map((e) => [e.quote, e.page]), [["The term premium is counter-cyclical.", "3"], ["Check the sample period", "7"]]);
  plan = planExtractSync(att, [a1, a2], stored); assert.deepEqual([plan.create.length, plan.update.length, plan.linked], [0, 0, [a1.id, a2.id]]); assert.deepEqual([...linkedAnnotationIds(att, [a1, a2, ink], stored)], [a1.id, a2.id]);
  const edited = { ...a1, note: "Key result for H1" }; plan = planExtractSync(att, [edited, a2], stored); assert.deepEqual(plan.update.map((u) => [u.annotationId, u.body.note]), [[a1.id, "Key result for H1"]]); assert.equal(plan.create.length, 0);
  for (const u of plan.update) await updateExtract(ws, r.id, u.id, u.body);
  stored = extractsOf((await getReference(ws, r.id)).fields); assert.equal(stored.length, 2); assert.equal(stored.find((e) => e.id === id1)?.note, "Key result for H1");
  assert.deepEqual(removedExtractIds(att, [edited, a2, ink], [a2]), [id1], "a removed annotation names its extract; ink never had one"); assert.deepEqual(removedExtractIds(att, [a2], [a2, edited]), []);
});

/* ---------------------------------------------------------------- templates and project scaffold ---------------------------------------------------------------- */
test("research templates: valid documents built from existing nodes; the project scaffold is what the LaTeX export reads", async () => {
  const types = (n: PMNode, out = new Set<string>()) => { out.add(n.type); for (const c of n.content ?? []) types(c, out); return out; };
  for (const t of SECTION_TEMPLATES) { const nodes = t.nodes(); assert.ok(nodes.length > 0, t.id); assertDoc({ type: "doc", content: nodes }); assert.notEqual(t.nodes()[0], nodes[0], "fresh nodes on every insert"); }
  assert.deepEqual(SECTION_TEMPLATES.map((t) => t.id), ["hypothesis", "question", "method", "equation", "result", "figure", "decision", "bibliography"]);
  const kindOf = (id: string) => SECTION_TEMPLATES.find((t) => t.id === id)!.nodes().find((n) => n.type === "callout")?.attrs?.kind; assert.deepEqual([kindOf("hypothesis"), kindOf("question"), kindOf("decision")], ["hypothesis", "question", "decision"]);
  const all = types({ type: "doc", content: SECTION_TEMPLATES.flatMap((t) => t.nodes()) }); for (const t of ["callout", "blockMath", "chart", "table", "taskList", "bibliography", "heading"]) assert.ok(all.has(t), t);
  assert.equal(workingPaperTemplate("X").content?.[0].type, "callout", "the single-page template is unchanged");

  const s = researchProjectTemplate(`${PFX} project`); assertDoc(s.root); assert.deepEqual(s.children.map((c) => c.key), ["hypotheses", "methods", "equations", "results", "figures"]); for (const c of s.children) assertDoc(c.content);
  // same calls as POST /api/research/papers {kind: "project"}
  const root = await createPage(ws, { title: `${PFX} project`, section: "research", type: "research", content: s.root }); made.pages.push(root.id);
  for (const c of s.children) { const p = await createPage(ws, { title: c.title, parentId: root.id, section: "research", icon: c.icon, content: c.content }); made.pages.push(p.id); }
  const tex = await exportProjectLatex(ws, root.id);
  assert.equal(tex.sections, 5); assert.ok(tex.hypotheses >= 1, "the hypothesis callout is collected"); assert.deepEqual(tex.unknownNodes, []);
  for (const title of ["Hypotheses", "Methods notes", "Equations", "Results", "Figures"]) assert.ok(tex.tex.includes(`\\section{${title}}`), title);
  assert.ok(tex.tex.includes("\\begin{abstract}")); assert.ok(tex.tex.includes("\\begin{equation}")); assert.ok(tex.tex.includes("\\varepsilon_{it}"), "equations are exported verbatim");
});

/* ---------------------------------------------------------------- contextual AI (pure side) ---------------------------------------------------------------- */
test("contextual AI: the five 3.0 actions exist on the server, aiBlock attrs carry action + sources, the links result is validated", () => {
  assert.deepEqual(ANALYSIS_ACTIONS.map((a) => a.id), ["coherence", "questions", "synthesis", "structure", "links"]); for (const a of ANALYSIS_ACTIONS) assert.ok((ACTION_IDS as readonly string[]).includes(a.id), `${a.id} is a server action id`);
  assert.equal(isAnalysisAction("coherence"), true); assert.equal(isAnalysisAction("rewrite"), false); assert.equal(isAnalysisAction(null), false);
  const page = uid(1);
  assert.deepEqual(aiBlockAttrs({ model: "m-1", action: "coherence", label: "Check coherence", sources: [{ pageId: page, blockId: "b1", title: "x".repeat(200) }, { pageId: "", blockId: null, title: "dropped" }], at: "2026-11-19T00:00:00.000Z" }),
    { model: "m-1", prompt: "Check coherence", at: "2026-11-19T00:00:00.000Z", action: "coherence", sources: [{ pageId: page, blockId: "b1", title: "x".repeat(120) }] });
  const bare = aiBlockAttrs({ action: "custom", label: "Custom instruction", instruction: "shorter" }); assert.equal(bare.sources, null, "no empty array in the document"); assert.equal(bare.prompt, "Custom instruction: shorter"); assert.equal(bare.model, null); assert.match(bare.at, /^\d{4}-/);
  const r = parseLinksResult({ ai: true, model: "claude-haiku-5-5", candidates: 4, links: [{ pageId: uid(2), title: "Offre de la banque", icon: null, blockId: "RttMYFvegP", excerpt: "Le taux…", score: 0.016, anchorText: "pénalité", reason: "Conditions." }, { pageId: uid(2), title: "duplicate" }, { pageId: "nope", title: "bad id" }, null, { pageId: uid(3), title: " ", anchorText: " " }] });
  assert.deepEqual(r.links.map((l) => [l.pageId, l.title, l.anchorText, l.blockId]), [[uid(2), "Offre de la banque", "pénalité", "RttMYFvegP"], [uid(3), "Untitled", null, null]]); assert.equal(r.candidates, 4); assert.equal(r.model, "claude-haiku-5-5");
  assert.deepEqual(parseLinksResult({ ai: true, links: [], candidates: 0 }), { links: [], candidates: 0, model: null }); assert.deepEqual(parseLinksResult(null).links, []);
  assert.equal(linkHref(r.links[0]), `/p/${uid(2)}#block-RttMYFvegP`); assert.equal(linkHref(r.links[1]), `/p/${uid(3)}`);
});
test("contextual AI: a suggested anchor is found inside the selection only, never on an existing link; sources are the blocks of the selection", () => {
  const sch = new Schema({ nodes: { doc: { content: "block+" }, paragraph: { group: "block", content: "inline*", attrs: { id: { default: null } } }, text: { group: "inline" }, mention: { group: "inline", inline: true, atom: true, attrs: { id: { default: null } } } }, marks: { link: { attrs: { href: {} } } } });
  const doc = sch.nodeFromJSON({ type: "doc", content: [
    { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "Avant de signer, " }, { type: "mention", attrs: { id: "x" } }, { type: "text", text: " vérifier la pénalité et le taux fixe." }] },
    { type: "paragraph", attrs: { id: "p2" }, content: [{ type: "text", text: "Le " }, { type: "text", text: "taux fixe", marks: [{ type: "link", attrs: { href: "/p/x" } }] }, { type: "text", text: " puis le taux fixe encore." }] },
    { type: "paragraph", attrs: { id: "p3" }, content: [{ type: "text", text: "Hors sélection : pénalité." }] },
  ] }) as unknown as DocLike & { textBetween: (a: number, b: number) => string; content: { size: number }; child: (i: number) => { nodeSize: number } };
  const whole = { from: 0, to: doc.content.size }; const text = (r: { from: number; to: number } | null) => (r ? doc.textBetween(r.from, r.to) : null);
  const a = findAnchor(doc, whole, "pénalité"); assert.equal(text(a), "pénalité"); assert.ok(a!.from < doc.child(0).nodeSize, "first occurrence, after the inline atom (positions stay exact)");
  const b = findAnchor(doc, whole, "taux fixe"); assert.equal(text(b), "taux fixe"); assert.ok(b!.to <= doc.child(0).nodeSize);
  const second = { from: doc.child(0).nodeSize, to: doc.child(0).nodeSize + doc.child(1).nodeSize }; const c = findAnchor(doc, second, "taux fixe"); assert.equal(text(c), "taux fixe"); assert.ok(c!.from > second.from + 12, "the occurrence that is already a link is skipped");
  assert.equal(findAnchor(doc, second, "pénalité"), null, "outside the selection"); assert.equal(findAnchor(doc, whole, "absent"), null); assert.equal(findAnchor(doc, whole, null), null); assert.equal(findAnchor(doc, whole, "signer, ￼ vérifier"), null);
  assert.deepEqual(sourcesOfRange(doc, { from: 3, to: second.from + 4 }, uid(1)).map((s) => [s.blockId, s.pageId]), [["p1", uid(1)], ["p2", uid(1)]]); assert.equal(sourcesOfRange(doc, { from: 3, to: 6 }, uid(1))[0].title.startsWith("Avant de signer"), true);
  assert.deepEqual(sourcesOfRange(doc, null, uid(1)), []); assert.deepEqual(sourcesOfRange(doc, whole, null), []); assert.equal(sourcesOfRange(doc, whole, uid(1), 2).length, 2);
});
