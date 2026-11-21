/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/research-latex.test.ts
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

/**
 * Research (SPEC §4.14): LaTeX export of a project (sections from its pages, hypotheses, methods notes, equations kept as LaTeX, figure
 * placeholders named after the attachments, \cite keys + the .bib companion from the existing BibTeX export), project-scoped reference
 * listing. Pure conversion tests first, then a real project in the scratch database. No AI is involved anywhere in this export.
 */
import "../helpers/testdb";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema, sql } from "../../src/db/index";
import { createPage } from "../../src/lib/pages/service";
import { createReference, listReferences } from "../../src/lib/research/references";
import { createExperiment } from "../../src/lib/research/experiments";
import { parseBibtex } from "../../src/lib/research/bibtex";
import { escapeLatex, textToLatex, figureName, docToLatex, newCtx, sectionCmd, buildArticle, projectPages, projectReferences, exportProjectLatex } from "../../src/lib/research/latex";
import type { PMNode } from "../../src/lib/editor/text";

const TAG = `tex${Date.now().toString(36)}`; let ws: string; const made: string[] = []; const refs: string[] = []; const atts: string[] = [];
const text = (t: string, marks?: any[]): PMNode => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (...c: (PMNode | string)[]): PMNode => ({ type: "paragraph", content: c.map((x) => (typeof x === "string" ? text(x) : x)) });
const h = (level: number, t: string): PMNode => ({ type: "heading", attrs: { level }, content: [text(t)] });
before(async () => { const [w] = await db.select().from(schema.workspaces).limit(1); assert.ok(w, "workspace missing"); ws = w.id; });
after(async () => {
  if (refs.length) await db.delete(schema.researchReferences).where(inArray(schema.researchReferences.id, refs));
  if (made.length) { await db.delete(schema.experiments).where(inArray(schema.experiments.pageId, made)); await db.delete(schema.pages).where(inArray(schema.pages.id, made)); await db.delete(schema.syncTombstones).where(inArray(schema.syncTombstones.id, made)); }
  if (atts.length) await db.delete(schema.attachments).where(inArray(schema.attachments.id, atts));
  await sql.end();
});

test("latex: text is escaped, but math, citation commands and \\ref typed on purpose are preserved and their keys collected", () => {
  assert.equal(escapeLatex("50% de R&D_2 #1 {x} ~ ^ \\ $5"), "50\\% de R\\&D\\_2 \\#1 \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{} \\$5");
  const keys = new Set<string>();
  assert.equal(textToLatex("Rendement de 5% selon \\cite{gorton2019} et \\citep[p.~3]{fama1993, french2015}, voir $\\beta_i = 0.5$ et \\eqref{eq:capm} & co.", keys), "Rendement de 5\\% selon \\cite{gorton2019} et \\citep[p.~3]{fama1993, french2015}, voir $\\beta_i = 0.5$ et \\eqref{eq:capm} \\& co.");
  assert.deepEqual([...keys].sort(), ["fama1993", "french2015", "gorton2019"]);
  assert.equal(textToLatex("Prix: 5 $ et 10 $ au total"), "Prix: 5 \\$ et 10 \\$ au total", "two dollar amounts are not an equation");
  assert.equal(textToLatex("$$E = mc^2$$"), "$$E = mc^2$$");
  assert.equal(figureName("Résultats 2026 (final).PNG", "f"), "Resultats-2026-final.png"); assert.equal(figureName("", "figure-1"), "figure-1"); assert.equal(figureName("graph", "f"), "graph");
  assert.deepEqual([sectionCmd(0), sectionCmd(1), sectionCmd(2), sectionCmd(3), sectionCmd(9)], ["section", "subsection", "subsubsection", "paragraph", "subparagraph"]);
});
test("latex: every block type converts — marks, lists, tasks, table, code, equations, figures, callouts, footnotes; unknown nodes are kept as marked text", () => {
  const c = newCtx([{ id: "r1", citeKey: "sharpe1964" }], new Map([["11111111-1111-4111-8111-111111111111", "Figure 1 — rendements.png"]]));
  const tex = docToLatex({ type: "doc", content: [
    h(1, "Méthode & données"),
    para("Texte ", text("gras", [{ type: "bold" }]), ", ", text("italique", [{ type: "italic" }]), ", ", text("x_i", [{ type: "code" }]), " et ", text("lien", [{ type: "link", attrs: { href: "https://example.org/a_b?x=1#y" } }]), "."),
    para("Selon ", { type: "citation", attrs: { refId: "r1", locator: "p. 12", label: "Sharpe 1964" } }, " et ", { type: "citation", attrs: { refId: "gone", label: "Disparu 2020" } }, "; inline ", { type: "inlineMath", attrs: { latex: "\\sigma^2" } }, "."),
    { type: "blockMath", attrs: { latex: "R_i = \\alpha + \\beta R_m + \\varepsilon_i" } },
    { type: "bulletList", content: [{ type: "listItem", content: [para("un")] }, { type: "listItem", content: [para("deux & trois")] }] },
    { type: "orderedList", content: [{ type: "listItem", content: [para("premier")] }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [para("fait")] }, { type: "taskItem", attrs: { checked: false }, content: [para("à faire")] }] },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [para("Var")] }, { type: "tableHeader", content: [para("Coef")] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [para("beta")] }, { type: "tableCell", content: [para("0,5")] }] }] },
    { type: "codeBlock", attrs: { language: "r" }, content: [text("lm(y ~ x, data = d) # 100%")] },
    { type: "image", attrs: { src: "/api/files/11111111-1111-4111-8111-111111111111", alt: "Rendements cumulés" } },
    { type: "callout", attrs: { kind: "hypothesis" }, content: [para("H1 : le bêta est stable.")] }, { type: "callout", attrs: { kind: "decision" }, content: [para("On garde l'échantillon 2010–2025.")] },
    { type: "blockquote", content: [para("Citation.")] }, para("Note", { type: "footnoteRef", attrs: { id: "1" } }), { type: "footnote", attrs: { id: "1" }, content: [text("Détail.")] },
    { type: "aiBlock", attrs: { model: "claude-haiku-5-5" }, content: [para("Passage généré.")] }, { type: "horizontalRule" },
    { type: "mermaid", attrs: { code: "graph TD; A-->B", preview: null } }, { type: "chart", attrs: { title: "Série", columns: ["an", "val"], rows: [[2025, 1.5], [2026, null]] } }, { type: "queryView", attrs: { title: "Tâches" } },
    { type: "futurNoeud", attrs: { x: 1 } }, { type: "futurTexte", content: [text("contenu inconnu 5%")] },
  ] }, c);
  for (const want of ["\\section{Méthode \\& données}", "\\textbf{gras}", "\\emph{italique}", "\\texttt{x\\_i}", "\\href{https://example.org/a_b?x=1\\#y}{lien}", "\\cite[p. 12]{sharpe1964}", "[?]% missing reference: Disparu 2020", "$\\sigma^2$",
    "\\begin{equation}\nR_i = \\alpha + \\beta R_m + \\varepsilon_i\n\\end{equation}", "\\begin{itemize}\n  \\item un\n  \\item deux \\& trois\n\\end{itemize}", "\\begin{enumerate}\n  \\item premier\n\\end{enumerate}", "\\item[$\\boxtimes$] fait", "\\item[$\\square$] à faire",
    "\\begin{tabular}{ll}", "  Var & Coef \\\\\n  \\hline", "  beta & 0,5 \\\\", "\\begin{verbatim}\nlm(y ~ x, data = d) # 100%\n\\end{verbatim}", "\\includegraphics[width=0.8\\linewidth]{figures/Figure-1-rendements.png}", "% placeholder: attachment \"Figure 1 — rendements.png\" (id 11111111-1111-4111-8111-111111111111)", "\\caption{Rendements cumulés}",
    "\\paragraph{Hypothesis}\nH1 : le bêta est stable.", "\\textbf{Decision.} On garde l'échantillon 2010–2025.", "\\begin{quote}\nCitation.\n\\end{quote}", "\\footnotemark[1]", "\\footnotetext[1]{Détail.}", "% --- AI-generated passage (claude-haiku-5-5) — review before submission ---", "Passage généré.",
    "% [mermaid diagram — source kept below]\n\\begin{verbatim}\ngraph TD; A-->B", "\\caption{Série}", "  2026 &  \\\\", "% [queryView: Tâches — live block, not exported]", "% [futurNoeud]", "% [futurTexte]\ncontenu inconnu 5\\%"]) assert.ok(tex.includes(want), `missing: ${want}\n---\n${tex}`);
  assert.deepEqual([...c.citeKeys], ["sharpe1964"]); assert.deepEqual(c.missingRefs, ["gone"]); assert.deepEqual(c.hypotheses, ["H1 : le bêta est stable."]); assert.deepEqual([...c.unknownNodes], ["futurNoeud", "futurTexte"]);
  assert.deepEqual([...c.figures.values()], [{ attachmentId: "11111111-1111-4111-8111-111111111111", name: "Figure 1 — rendements.png", file: "Figure-1-rendements.png", caption: "Rendements cumulés" }]);
});
test("latex: the article skeleton has title, abstract, one section per page nested by depth, hypotheses, methods notes and the bibliography", () => {
  const ref = { id: "r1", citeKey: "sharpe1964", entryType: "article", title: "Capital Asset Prices", authors: ["William F. Sharpe"], year: 1964, journal: "The Journal of Finance", doi: null, url: null, bibtex: null, fields: {} };
  const out = buildArticle({ title: "Bêta & stabilité", author: "S.-P. Boucher", date: "2026-11-19", refs: [ref], attachments: new Map(),
    pages: [
      { id: "p0", title: "Bêta & stabilité", depth: 0, content: { type: "doc", content: [h(2, "Abstract"), para("Nous testons la stabilité du bêta \\cite{sharpe1964}."), h(2, "Introduction"), para("Contexte \\cite{inconnu2020}.")] } },
      { id: "p1", title: "Données", depth: 1, content: { type: "doc", content: [para("Échantillon CRSP."), h(2, "Filtres"), para("Prix > 5 $."), { type: "callout", attrs: { kind: "hypothesis" }, content: [para("H1 : stabilité.")] }] } },
      { id: "p2", title: "Sous-échantillon", depth: 2, content: { type: "doc", content: [para("Détail.")] } },
      { id: "p3", title: "Résultats", depth: 1, content: { type: "doc", content: [] } },
    ],
    experiments: [{ name: "Fenêtre 60 mois", status: "done", params: { fenetre: 60 }, metrics: { r2: 0.31 }, datasetRef: "CRSP 2010–2025", repoUrl: "https://git.example.org/beta_test", notes: "Voir \\cite{sharpe1964}." }] });
  const t = out.tex;
  assert.ok(t.startsWith("% Generated by SP Note")); assert.match(t, /\\documentclass\[11pt\]\{article\}/); assert.ok(t.includes("\\title{Bêta \\& stabilité}")); assert.ok(t.includes("\\author{S.-P. Boucher}")); assert.ok(t.includes("\\date{2026-11-19}"));
  assert.ok(t.includes("\\begin{abstract}\nNous testons la stabilité du bêta \\cite{sharpe1964}.\n\\end{abstract}"), "the Abstract heading of the root page becomes the abstract");
  const order = ["\\maketitle", "\\begin{abstract}", "\\section{Introduction}", "\\section{Données}", "\\subsection{Filtres}", "\\subsection{Sous-échantillon}", "\\section{Résultats}", "\\section{Hypotheses}", "\\section{Methods notes}", "\\bibliographystyle{plain}", "\\bibliography{references}", "\\end{document}"];
  let at = -1; for (const o of order) { const i = t.indexOf(o); assert.ok(i > at, `"${o}" is present and in order`); at = i; }
  assert.ok(!/section\{Abstract\}/.test(t), "the abstract is not repeated as a section");
  assert.ok(t.includes("  \\item H1 : stabilité.")); assert.ok(t.includes("\\item[Fenêtre 60 mois] (done) Parameters: fenetre = 60. Metrics: r2 = 0.31. Data: CRSP 2010–2025. Code: \\url{https://git.example.org/beta_test}. Voir \\cite{sharpe1964}."));
  assert.ok(t.includes("% WARNING — cited but absent from the library (not in references.bib): inconnu2020")); assert.ok(t.includes("Prix > 5 \\$."));
  assert.deepEqual(out.citeKeys, ["inconnu2020", "sharpe1964"]); assert.deepEqual(out.missingKeys, ["inconnu2020"]); assert.equal(out.sections, 3); assert.equal(out.hypotheses, 1); assert.equal(out.experiments, 1);
  const parsed = parseBibtex(out.bib); assert.equal(parsed.length, 1); assert.equal(parsed[0].citeKey, "sharpe1964"); assert.equal(parsed[0].year, 1964, "the .bib companion is valid BibTeX (parsed back by the importer)");
  const empty = buildArticle({ title: "Vide", pages: [{ id: "p", title: "Vide", depth: 0, content: { type: "doc", content: [] } }], experiments: [], refs: [] }); assert.ok(empty.tex.includes("% no reference in this project")); assert.ok(empty.tex.includes("\\date{\\today}")); assert.equal(empty.bib, "");
});
test("research: project pages in tree order, project-scoped references (attached or cited), export and reference lookup by ids", async () => {
  const mk = async (title: string, content: PMNode[], parentId?: string, type = "page") => { const p = await createPage(ws, { title, parentId: parentId ?? null, section: "research", type, content: { type: "doc", content } }); made.push(p.id); return p; };
  const [att] = await db.insert(schema.attachments).values({ workspaceId: ws, filename: `courbe ${TAG}.png`, mime: "image/png", size: 10, sha256: "0".repeat(64), storagePath: `zz/zz/${TAG}.png` }).returning(); atts.push(att.id);
  const root = await mk(`Papier ${TAG}`, [h(2, "Résumé"), para("Résumé du papier."), h(2, "Introduction"), para(`Voir \\cite{lib${TAG}}.`)], undefined, "research");
  const a = await mk("Données", [para("Données."), { type: "image", attrs: { src: `/api/files/${att.id}`, alt: "Courbe" } }, { type: "blockMath", attrs: { latex: "y = x^2" } }], root.id);
  const b = await mk("Résultats", [{ type: "callout", attrs: { kind: "hypothesis" }, content: [para("H1.")] }], root.id);
  const a1 = await mk("Nettoyage", [para("Étapes.")], a.id);
  const trashed = await mk("Brouillon supprimé", [para("x")], root.id); await db.update(schema.pages).set({ deletedAt: new Date() }).where(eq(schema.pages.id, trashed.id));
  const outside = await mk(`Hors projet ${TAG}`, [para("Ailleurs.")]);
  const attached = await createReference(ws, { title: "Attached paper", authors: ["Ada Lovelace"], year: 1843, citeKey: `att${TAG}`, pageId: a.id }); refs.push(attached.id);
  const cited = await createReference(ws, { title: "Library paper", authors: ["Alan Turing"], year: 1950, citeKey: `lib${TAG}`, pageId: null }); refs.push(cited.id);
  const other = await createReference(ws, { title: "Unrelated", authors: ["X Y"], year: 2000, citeKey: `other${TAG}`, pageId: outside.id }); refs.push(other.id);
  await createExperiment(ws, { pageId: a.id, name: "Essai 1", status: "running", params: { n: 100 } });
  const pages = await projectPages(ws, root.id);
  assert.deepEqual(pages.map((p) => [p.title, p.depth]), [[`Papier ${TAG}`, 0], ["Données", 1], ["Nettoyage", 2], ["Résultats", 1]], "tree order, children before the next sibling, trashed pages left out");
  assert.deepEqual((await projectReferences(ws, pages)).map((r) => r.citeKey), [`att${TAG}`, `lib${TAG}`], "attached to a page of the project, or cited in its text — not the unrelated one");
  const x = await exportProjectLatex(ws, root.id, { author: "Auteur" });
  assert.equal(x.title, `Papier ${TAG}`); assert.deepEqual(x.pageIds, [root.id, a.id, a1.id, b.id]); assert.deepEqual(x.citeKeys, [`lib${TAG}`]); assert.deepEqual(x.missingKeys, []);
  assert.deepEqual(x.figures, [{ attachmentId: att.id, name: `courbe ${TAG}.png`, file: `courbe-${TAG}.png` }]); assert.equal(x.hypotheses, 1); assert.equal(x.experiments, 1); assert.equal(x.sections, 3);
  for (const want of ["\\begin{abstract}\nRésumé du papier.\n\\end{abstract}", "\\section{Données}", "\\subsection{Nettoyage}", "\\section{Résultats}", "\\begin{equation}\ny = x^2\n\\end{equation}", `\\includegraphics[width=0.8\\linewidth]{figures/courbe-${TAG}.png}`, `\\cite{lib${TAG}}`, "\\item[Essai 1] (running) Parameters: n = 100.", "\\bibliography{references}"]) assert.ok(x.tex.includes(want), `missing ${want}`);
  assert.ok(!x.tex.includes("Brouillon supprimé")); assert.ok(!x.tex.includes("Ailleurs."));
  const bib = parseBibtex(x.bib); assert.deepEqual(bib.map((e) => e.citeKey).sort(), [`att${TAG}`, `lib${TAG}`]);
  assert.equal((await exportProjectLatex(ws, a.id)).pageIds.length, 2, "any page can be exported as a (sub)project");
  await assert.rejects(exportProjectLatex(ws, "00000000-0000-4000-8000-000000000000"), (e: any) => e.status === 404 && e.code === "not_found");
  const byIds = await listReferences(ws, { ids: [cited.id, attached.id, "00000000-0000-4000-8000-000000000000"] }); assert.deepEqual(byIds.map((r) => r.id).sort(), [attached.id, cited.id].sort());
  // a `citation` node pulls its reference into the project even when nothing else links it
  const withNode = await mk(`Avec noeud ${TAG}`, [para("Voir ", { type: "citation", attrs: { refId: other.id, locator: "", label: "X 2000" } }, ".")]);
  const y = await exportProjectLatex(ws, withNode.id); assert.deepEqual(y.citeKeys, [`other${TAG}`]); assert.ok(y.tex.includes(`\\cite{other${TAG}}`)); assert.ok(y.bib.includes(`other${TAG}`));
  assert.equal((await db.select().from(schema.researchReferences).where(and(eq(schema.researchReferences.workspaceId, ws), inArray(schema.researchReferences.id, refs)))).length, 3, "an export never modifies the library");
});
