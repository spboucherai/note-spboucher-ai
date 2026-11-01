/** LaTeX-ready starter document for a new working paper (ProseMirror JSON). */
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
