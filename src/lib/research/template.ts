/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/research/template.ts
 * Description      : starter documents of the research workspace (ProseMirror
 *                    JSON, existing nodes only): the single-page working paper,
 *                    the research project scaffold (a root page + one child
 *                    page per kind of material: hypotheses, methods notes,
 *                    equations, results, figures — the layout `GET
 *                    /api/research/export.tex` turns into sections) and the
 *                    insertable section templates of the panel. Placeholder
 *                    text is written as guidance in italics; nothing here
 *                    pretends to be a result.
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
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

import type { PMNode } from "@/lib/editor/text";
const h = (level: number, text: string): PMNode => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const p = (text: string, italic = false): PMNode => ({ type: "paragraph", content: text ? [{ type: "text", text, ...(italic ? { marks: [{ type: "italic" }] } : {}) }] : undefined });
const math = (latex: string): PMNode => ({ type: "blockMath", attrs: { latex } });
export function workingPaperTemplate(title: string): PMNode {
  return { type: "doc", content: [
    { type: "callout", attrs: { kind: "info", icon: "🔬" }, content: [p(`Working paper — ${title}. Track status, venue, references, experiments and tasks in the research panel above. Use $…$ for inline math and $$…$$ blocks for displayed equations; the LaTeX palette inserts common templates.`)] },
    h(2, "Abstract"), p("One paragraph: question, approach, data, main result, contribution.", true),
    h(2, "1. Introduction"), p("Motivation and research question. What is known, what is missing, what this paper does.", true), p(""),
    h(2, "2. Model"), p("Set-up, assumptions and notation. Example of a displayed equation:", true),
    math("y_{it} = \\alpha_i + \\beta' x_{it} + \\gamma_t + \\varepsilon_{it}, \\qquad \\mathbb{E}[\\varepsilon_{it} \\mid x_{it}, \\alpha_i] = 0"),
    p("Hypotheses H1–H3 and the predictions tested below.", true),
    h(2, "3. Data"), p("Sources, sample period, filters, summary statistics (link datasets in the panel header).", true),
    h(2, "4. Empirical strategy"), p("Identification, estimation, inference; robustness plan.", true),
    h(2, "5. Results"), p("Main tables and figures; economic magnitudes; heterogeneity.", true),
    h(2, "6. Conclusion"), p("What was learned, limits, next steps.", true),
    h(2, "References"), p("Managed in the References tab — export the .bib file for LaTeX and cite with \\cite{key}.", true),
  ] };
}

/* ------------------------------------------------- insertable section templates ------------------------------------------------- */
const callout = (kind: string, icon: string, ...content: PMNode[]): PMNode => ({ type: "callout", attrs: { kind, icon }, content });
const cell = (type: "tableHeader" | "tableCell", text: string): PMNode => ({ type, content: [p(text)] });
const table = (head: string[], rows: string[][]): PMNode => ({ type: "table", content: [{ type: "tableRow", content: head.map((t) => cell("tableHeader", t)) }, ...rows.map((r) => ({ type: "tableRow", content: r.map((t) => cell("tableCell", t)) }))] });
const chart = (title: string): PMNode => ({ type: "chart", attrs: { kind: "bar", title, columns: [], rows: [], x: null, y: [], source: null } });
const todo = (...items: string[]): PMNode => ({ type: "taskList", content: items.map((t) => ({ type: "taskItem", attrs: { checked: false }, content: [p(t)] })) });
export interface SectionTemplate { id: string; label: string; hint: string; nodes: () => PMNode[] }
/** Sections a researcher adds while working. Each returns fresh nodes (block ids are assigned by the editor). */
export const SECTION_TEMPLATES: SectionTemplate[] = [
  { id: "hypothesis", label: "Hypothesis", hint: "Statement, prediction, how it is tested", nodes: () => [h(3, "Hypothesis"), callout("hypothesis", "🧪", p("H — state the hypothesis in one falsifiable sentence.", true)), p("Prediction: what should be observed if it holds, and what would contradict it.", true), p("Test: data, specification, statistic.", true)] },
  { id: "question", label: "Research question", hint: "An open question to answer", nodes: () => [callout("question", "❓", p("Question — what exactly is unknown, and why does it matter?", true))] },
  { id: "method", label: "Methods note", hint: "Procedure, assumptions, checks", nodes: () => [h(3, "Methods note"), p("Objective of this step.", true), p("Procedure: data, sample, estimation, software.", true), p("Assumptions and their checks.", true), todo("Write the procedure", "Record parameters in the Experiments tab", "Robustness check")] },
  { id: "equation", label: "Equation", hint: "Displayed equation with its notation", nodes: () => [h(3, "Equation"), math("y_{it} = \\alpha_i + \\beta' x_{it} + \\varepsilon_{it}"), p("where — define every symbol the first time it appears.", true)] },
  { id: "result", label: "Result", hint: "Finding, table, interpretation", nodes: () => [h(3, "Result"), p("Finding in one sentence, with its magnitude and uncertainty.", true), table(["Specification", "Estimate", "Std. error", "N"], [["(1)", "", "", ""], ["(2)", "", "", ""]]), p("Interpretation and limits.", true)] },
  { id: "figure", label: "Figure", hint: "Chart with a caption", nodes: () => [h(3, "Figure"), chart(""), p("Figure — caption: what is plotted, units, sample, source.", true)] },
  { id: "decision", label: "Decision", hint: "A choice made, and why", nodes: () => [callout("decision", "⚖️", p("Decision — what was chosen, the alternatives considered and the reason.", true))] },
  { id: "bibliography", label: "Bibliography", hint: "References cited in the page", nodes: () => [{ type: "bibliography", attrs: { style: "apa", title: "References" } }] },
];
export const sectionTemplate = (id: string) => SECTION_TEMPLATES.find((t) => t.id === id);

/* ------------------------------------------------- research project scaffold ------------------------------------------------- */
export interface ProjectScaffold { root: PMNode; children: { key: string; title: string; icon: string; content: PMNode }[] }
const nodesOf = (id: string) => sectionTemplate(id)!.nodes();
/** A project = a root research page and five child pages. The LaTeX export reads exactly this tree (root body, then one section per child page). */
export function researchProjectTemplate(title: string): ProjectScaffold {
  return {
    root: { type: "doc", content: [
      callout("info", "🔬", p(`Research project — ${title}. The pages below hold the hypotheses, methods notes, equations, results and figures; references, files, experiments and tasks live in the research panel above. “Export” in the panel builds the LaTeX skeleton of the whole project.`)),
      h(2, "Abstract"), p("One paragraph: question, approach, data, main result, contribution.", true),
      h(2, "Research question"), ...nodesOf("question"),
      h(2, "Status"), p("Where the project stands, what is next.", true),
    ] },
    children: [
      { key: "hypotheses", title: "Hypotheses", icon: "🧪", content: { type: "doc", content: [p("One callout per hypothesis: the LaTeX export collects them in a “Hypotheses” section.", true), ...nodesOf("hypothesis")] } },
      { key: "methods", title: "Methods notes", icon: "🧭", content: { type: "doc", content: nodesOf("method") } },
      { key: "equations", title: "Equations", icon: "∑", content: { type: "doc", content: nodesOf("equation") } },
      { key: "results", title: "Results", icon: "📊", content: { type: "doc", content: nodesOf("result") } },
      { key: "figures", title: "Figures", icon: "🖼️", content: { type: "doc", content: nodesOf("figure") } },
    ],
  };
}
